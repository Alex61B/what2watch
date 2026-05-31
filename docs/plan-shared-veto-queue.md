# Plan: Shared Real-Time Veto Queue

**Goal:** Every active member of a room sees the same current movie at all times. Any NO vote ("veto") atomically advances the queue for everyone within ≤2s p95. YES votes accumulate silently; an all-YES on the current movie records a `Match` and advances the queue the same way.

**Architecture:** Server-authoritative `Room.currentPosition` indexes the shared `RoomQueue`. The vote handler advances the queue via Postgres compare-and-swap (`UPDATE ... WHERE currentPosition = $expected`) inside the same transaction as the `Vote` upsert / `Match` write. Clients poll `/api/rooms/[code]/poll` every 1.5s with `If-None-Match: "<queueVersion>"`; the handler short-circuits with 304 when the version is unchanged. Per-member queues (`MemberQueue`) stay in the schema for this PR but are no longer read by the voting screen — they will be retired in a follow-up.

**Tech Stack:** Prisma + Postgres CAS; existing Next.js 15 App Router; existing NextAuth session helpers; Jest for tests; no new dependencies.

**Discoveries from RESEARCH that re-shape the plan:**

- The existing `Vote` model already has `tmdbMovieId` and `@@unique([roomId, memberId, tmdbMovieId])`. Staleness check and YES idempotency cost nothing.
- The existing `/api/rooms/[code]/votes` handler already accepts `{ tmdbMovieId, vote }` and calls `checkForMatch`. The change is additive: after the existing logic, advance the queue atomically.
- The existing `/api/rooms/[code]/poll` handler already returns `status`, `memberCount`, `matchedMovie`, `rejectedMovieIds`. The change is additive: add `currentPosition`, `queueVersion`, `currentMovie` and support `If-None-Match`.
- **No new endpoints needed.** `votes` and `poll` extend; no `/state` route.

---

## Schema changes (`prisma/schema.prisma`)

```prisma
model Room {
  // existing fields…
  currentPosition Int       @default(0)
  queueVersion    Int       @default(0)
  // (no skippedMovieIds column — derivable from Vote WHERE vote = false; already used by /poll)
}

enum RoomStatus {
  LOBBY
  VOTING
  MATCHED
  DRAINED   // NEW — queue exhausted with no further matches
  DONE
}
```

**Migration:**

1. User runs: `npx prisma migrate dev --name add_shared_veto_queue` (requires explicit user approval per the project's Prisma migration rule).
2. The generated migration path `prisma/migrations/<timestamp>_add_shared_veto_queue/migration.sql` is added to `.workflow_plan_files` as the very first IMPLEMENT step (writing to `.workflow_plan_files` is always permitted by the pre-tool-use hook).
3. Schema additions are non-blocking defaults — safe on live Supabase data.

---

## API changes

### `POST /api/rooms/[code]/votes` (MODIFY)

**Request body (unchanged shape, semantics tightened):**
```json
{ "tmdbMovieId": "string", "vote": true }
```

**New behavior layered onto the existing handler:**

1. After session/member/room checks (existing).
2. Load `room.currentPosition` and `roomQueue[currentPosition]` in a single query.
3. **Staleness check:** if `roomQueue[currentPosition].tmdbMovieId !== body.tmdbMovieId` → return `409 Conflict` with the current state payload (same shape as `/poll`). No vote written, no advance.
4. Run the existing `Vote` upsert (idempotent on retry).
5. **Branch on vote value:**
   - `vote === false` (NO / veto): call `advanceQueueAtomic(roomId, expectedPosition, expectedVersion)` from `lib/queue.ts`.
   - `vote === true` (YES): call `checkForMatch(room.id, tmdbMovieId)` (existing helper).
     - If match → set `room.matchedMovieId`, record match, then call `advanceQueueAtomic` to move past the matched movie. Return `{ matched: true, movie }`.
     - If no match yet → return `{ matched: false }`. (No advance.)
6. CAS return values:
   - **Advanced:** include the new `{ currentPosition, queueVersion, currentMovie, status }` in the response so the voter's UI re-renders immediately.
   - **Lost the race (0 rows affected):** return `409` with the server's actual current state. Client treats as "you were stale, here's the truth."
7. Response status codes:
   - 200 on success (including non-advancing YES).
   - 409 on staleness or lost CAS race.
   - Existing 400/401/404 unchanged.

### `GET /api/rooms/[code]/poll` (MODIFY)

**Add to response payload:**
```json
{
  "status": "VOTING|MATCHED|DRAINED|DONE",
  "memberCount": 3,
  "matchedMovie": null,
  "rejectedMovieIds": ["..."],
  "watchedFilter": false,
  "currentPosition": 5,
  "queueVersion": 12,
  "currentMovie": { "tmdbId": "...", "title": "...", "posterUrl": "...", "watchUrl": "...", "streamingService": "..." } | null
}
```

**ETag support:**
- Set `ETag: "12"` on every 200 response.
- If incoming `If-None-Match: "12"` and the room's current `queueVersion` matches → return `304 Not Modified` with no body, no further DB reads, no TMDB fetch.
- The 304 short-circuit happens after the `queueVersion` lookup but before `currentMovie` resolution — this is the cost-saver.

### `lib/queue.ts` (NEW — extracted helper)

```ts
type AdvanceResult =
  | { advanced: true; newPosition: number; newVersion: number; status: 'VOTING' | 'DRAINED' | 'MATCHED' }
  | { advanced: false; reason: 'CAS_LOST' | 'ALREADY_TERMINAL' }

async function advanceQueueAtomic(
  prisma: PrismaClient,
  roomId: string,
  expectedPosition: number,
  expectedVersion: number,
): Promise<AdvanceResult>
```

Internals: a single `prisma.room.updateMany` with `where: { id, currentPosition: expectedPosition, queueVersion: expectedVersion }` and `data: { currentPosition: { increment: 1 }, queueVersion: { increment: 1 } }`. If `count === 0` → `{ advanced: false, reason: 'CAS_LOST' }`. Otherwise → fetch new position; if `>= queue.length` → transition `status` to `DRAINED` in a follow-up update and return that status.

The helper is pure (no session/auth concerns) so it tests cleanly.

---

## Component changes

### `app/room/[code]/vote/page.tsx` (MODIFY)

- Replace the current per-member queue iteration with **server-driven current movie**: render `pollResponse.currentMovie`.
- Polling interval: 1.5s. Send `If-None-Match: "<lastSeenQueueVersion>"`. On 304, do nothing. On 200, update local state.
- Branch on `pollResponse.status`:
  - `VOTING` → render `<VotingCard movie={currentMovie} queueVersion={queueVersion} />`.
  - `MATCHED` → existing match flow.
  - `DRAINED` → render `<DrainedScreen />`.
- Pass `queueVersion` into `VotingCard` as a key prop so React remounts the card when the version changes (clean state transition, no stale button-locked state).

### `components/VotingCard.tsx` (MODIFY)

- Add `queueVersion: number` and `tmdbMovieId: string` to props (already takes `movie`).
- Vote submission sends `{ tmdbMovieId, vote }`. On 409 response, do nothing (the next poll tick will update the page); on 200, lock the buttons until either the next poll observes a `queueVersion` change OR a 5s timeout fires.
- Remove any client-side "advance to next card in queue" logic — the parent page now drives that via polling.

### `components/DrainedScreen.tsx` (NEW)

- Renders when `status === 'DRAINED'`.
- Host sees a header ("No more movies to vote on") and a placeholder for future actions ("Deal more movies" — out of scope for this PR; render a disabled button with a "coming soon" tooltip so the spec stays honest).
- Non-host sees the same header without action buttons.

---

## Acceptance criteria (one testable criterion per core feature)

1. **Veto advances for everyone.** Given a room in `VOTING` with members A, B, C all on movie #5, when A POSTs `{ tmdbMovieId: "#5", vote: false }`, then within ≤2s the next `/poll` response for B and C returns `currentPosition === 6` and a new `currentMovie`. Verified by a Jest integration-style test that drives the advance directly via the lib/queue helper and asserts `Room.currentPosition` increments exactly once.

2. **No duplicate skips under contention.** Given members A and B both POST a NO on movie #5 within ~10ms, `Room.currentPosition` is exactly 6 (not 7) after both requests settle. Verified by a Jest test that fires two `advanceQueueAtomic(roomId, 5, V)` calls in parallel and asserts: one returns `advanced:true`, the other returns `{advanced:false, reason:'CAS_LOST'}`, and `Room.currentPosition === 6`.

3. **Stale vote is rejected.** Given the server is on `currentPosition = 6`, when a client POSTs `{ tmdbMovieId: "#5", vote: true }` (movie #5 was at position 5), the server responds 409 with `currentPosition: 6, currentMovie: <movie #6>` and writes no `Vote` row for `(member, #5)` beyond what already exists. Verified by a Jest test on the votes route.

4. **YES-all records a match and advances.** Given members A, B, C in a room and A,B,C all POST YES on movie #5 in sequence, after the third YES: a `Match` row exists for movie #5, `Room.matchedMovieId === "#5"`, AND `currentPosition === 6`. Verified by a Jest test that drives three sequential YES calls through the route handler (with mocked auth).

5. **Drained transition.** Given a room whose queue has 1 entry remaining (`currentPosition = N-1`), when any NO arrives, then `Room.status === 'DRAINED'` and `currentPosition === N` in the same transaction. Verified by a Jest test on the queue helper that constructs a 1-entry queue and asserts the post-condition.

6. **Cheap polling steady-state.** Given `queueVersion = 12` and a poll request with `If-None-Match: "12"`, the response is 304 with no body. Verified by a Jest test on the poll route (manual mock for Prisma).

7. **Client convergence ≤ 2s.** Manual verification in production: open the app in two browsers as two members of the same room; veto on browser 1; observe browser 2's card update within 2 seconds. Captured in the verification report when the change ships.

---

## File manifest (`.workflow_plan_files`)

```
prisma/schema.prisma
lib/queue.ts
app/api/rooms/[code]/votes/route.ts
app/api/rooms/[code]/poll/route.ts
app/room/[code]/vote/page.tsx
components/VotingCard.tsx
components/DrainedScreen.tsx
__tests__/lib/queue.test.ts
__tests__/components/DrainedScreen.test.tsx
__tests__/components/VotingCard.test.tsx
```

**Note on the migration file:** `npx prisma migrate dev --name add_shared_veto_queue` will create `prisma/migrations/<timestamp>_add_shared_veto_queue/migration.sql`. The IMPLEMENT phase begins by running that command (with user approval) and appending the generated path to `.workflow_plan_files` before any code edits, so the drift check stays clean.

## Out of scope (deferred to follow-up PRs)

- Dropping `MemberQueue` and removing it from the `Start` handler.
- SSE / WebSocket migration.
- "Deal more movies" action from the DRAINED state.
- Live "X of Y members voted YES" indicator.
- Vote retraction / undo.
