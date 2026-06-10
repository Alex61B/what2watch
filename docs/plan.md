# Plan — Cycle 2: Per-member decks + card fits one screen

Every file below is in `.workflow_plan_files`.

---

## R1 — Per-member decks

### 1a. `app/api/rooms/[code]/queue/route.ts` — source the card from RoomQueue
Keep guards, heartbeat, and the `excludedIds = votes ∪ global rejects ∪ watched` computation. Replace the `memberQueue` lookup with `RoomQueue`:
```ts
const nextEntry = await prisma.roomQueue.findFirst({
  where: { roomId: room.id, tmdbMovieId: { notIn: notInClause } },
  orderBy: { position: 'asc' },
})
if (!nextEntry) return NextResponse.json(null)
const remaining = await prisma.roomQueue.count({
  where: { roomId: room.id, tmdbMovieId: { notIn: notInClause } },
})
// TMDB hydrate (unchanged) → { movie: {...nextEntry.watchUrl/streamingService}, remaining }
```
Drop the `memberQueue.findFirst`/`roomQueue.findUnique` round-trip.

### 1b. `app/api/rooms/[code]/votes/route.ts` — no shared advance, no staleness
- Remove the `fresh` re-read + the staleness 409 + `advanceQueueAtomic` import/calls.
- Validate the movie is in the room's `RoomQueue` (lightweight `findUnique`; 409 if absent).
- Keep: approved-member guard, VOTING guard, `vote.upsert`, `lastSeenAt`, watchlist hook (on yes).
- `!vote` → `return { matched: false }`. `vote` → `checkForMatch`; if matched, hydrate movie and `return { matched: true, movie }`, else `{ matched: false }`.

### 1c. `lib/match.ts` — bump queueVersion on MATCHED
Add `queueVersion: { increment: 1 }` to the guarded `updateMany` that sets `status: 'MATCHED'`, so other members' polls (which 304 on an unchanged version) see the match.

### 1d. `app/api/rooms/[code]/watched/route.ts` — drop the shared advance
Remove the `advanceQueueAtomic` import and the entire `skip-reruns-advance` block; return `{ ok: true }`. Room-wide removal now comes from the `WatchedMovie` row + `/queue`'s room-wide watched exclusion.

### 1e. `app/room/[code]/vote/page.tsx` — drive the card from `/queue`
- New state: `card: Movie | null | undefined`, `remaining: number`. Keep `state` (poll) for status/members/pending/approval/host.
- `fetchCard()`: GET `/queue`; `null` → `setCard(null)` (exhausted); else `setCard(data.movie)` + `setRemaining(data.remaining)`.
- Fetch the card on first approved poll (mount) and after each own vote / seen-removal — **never** inside `pollOnce`.
- Add an effect: when the poll's `queueVersion` increases **and** `card === null`, re-fetch (pick up a requeue).
- `handleVote`: POST `/votes` for `card.tmdbId`; if `data.matched` → redirect to match; else `fetchCard()`. Keep the OFF-mode `recordSeen`.
- `handleRemoveSeen` (skip-reruns ON): POST `/watched` → `fetchCard()`.
- Render: `card === undefined` → "Loading movies…"; `card === null` → exhaustion screen (host: "Broaden filters" → `setEditorOpen(true)`); else `<VotingCard movie={card} … />`. Progress shows `remaining`.
- Keep the `notAdmitted` / `pendingApproval` / poll-status redirects and the host `JoinRequestModal`/`HostFilterEditor`.

### 1f–1i. Tests
- `__tests__/api/queue-route.test.ts`: mock `roomQueue.findFirst`/`roomQueue.count`; assert the `notIn` exclusion is applied to the `roomQueue.findFirst` query; keep guard/heartbeat/null/shape cases.
- `__tests__/api/votes.test.ts`: drop the staleness-409 and advance-on-NO cases; assert a NO records `vote:false` and returns `{matched:false}` with no advance; a YES runs match detection; keep auth/approval/VOTING guards.
- `__tests__/api/watched.test.ts`: assert the upsert + hook happen and no advance occurs (no `advanceQueueAtomic`).
- `__tests__/lib/match.test.ts`: assert the MATCHED `updateMany` includes `queueVersion: { increment: 1 }`.

**Acceptance:** Two members vote independently; one hitting Nope advances only themselves and never changes the other's current card; a movie anyone Nopes is gone from both members' upcoming cards; when everyone Piks the same movie the whole room lands on the match screen; finishing your deck shows "waiting for the others", and a host broadening filters brings new cards back.

---

## R2 — Card fits one screen

### 2a. `components/VotingCard.tsx`
Root card → `flex h-full flex-col`; poster wrapper → `relative flex-1 min-h-0` (drop `aspect-[3/4]`), `Image fill object-cover`; info block compact (`p-4`, `line-clamp-2/3` overview); swipe hints compact; buttons `shrink-0`. Swipe/stamp/commit logic unchanged.

### 2b. `app/room/[code]/vote/page.tsx` (container, same file as 1e)
Main → `flex h-[100dvh] flex-col`; inner wrapper → `flex w-full max-w-md flex-1 min-h-0 flex-col` with smaller vertical padding; the card sits in a `flex-1 min-h-0` slot so it fills the viewport without scrolling.

### 2c. `__tests__/components/VotingCard.test.tsx`
Verify it still passes after the layout change; adjust only if it asserts removed structural classes (behavioral swipe/click assertions should be untouched).

**Acceptance:** On a phone viewport the poster, title row, and both Nope/Pik buttons are visible without scrolling.

---

## Schema changes
None.

## API changes
- `GET /api/rooms/[code]/queue` now sources the card from `RoomQueue` (same response shape).
- `POST /api/rooms/[code]/votes` no longer advances a shared queue; response keeps `{ matched, movie? }`.
- `POST /api/rooms/[code]/watched` no longer advances; returns `{ ok: true }`.

## Verification
`bash scripts/verify.sh` → typecheck + lint + jest exit 0. Route/lib tests lock R1; the client deck flow + R2 layout are confirmed by manual browser run-through.
