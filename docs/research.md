# Research — Route-handler unit tests for requeue / watched / votes

Add the recommendation-#4 coverage: unit tests for three server routes whose branching is currently
untested. The concurrency-hardening commit (`7e6efb9`) added match/queue/join-approval/rooms-session/
poll-members/room-code-collision tests; this cycle covers the still-untested `requeue`, `watched`,
and `votes` handlers against their current (post-hardening) behaviour. **Additive only — no
production changes.**

## 1. Requirements Summary

- **`POST /api/rooms/[code]/requeue`** — host-only mid-session rebuild.
  - Position math: VOTING appends after the current card (`startPos = currentPosition + 1`, keeps
    `position < startPos`, deletes/​replaces `>= startPos`); DRAINED fills the empty current slot
    (`startPos = currentPosition`), flips status back to VOTING, sets `currentPosition = startPos`.
  - Exclusion: discovered movies already rejected (down-votes), already kept (`position < startPos`),
    or watched (when `watchedFilter`) are filtered out.
  - No-fresh branch: returns `{ requeued: false, added: 0 }` and does not mutate the queue.
  - Bumps `queueVersion` (increment) on success.
  - Guards: 401 (no session), 403 (non-host), 404 (room mismatch), 409 (not VOTING/DRAINED),
    400 (no valid streaming services).
- **`POST /api/rooms/[code]/watched`** — seen-it / "Skip the Reruns".
  - `watchedFilter` ON + marked movie is the current card → calls `advanceQueueAtomic`, `removed:true`.
  - `watchedFilter` ON + marked movie is NOT current → records only, `removed:false`.
  - `watchedFilter` OFF → records only, `removed:false`.
  - Always upserts a `watchedMovie`; the `SEEN_BEFORE` hook is best-effort (a throw must not fail it).
  - Guards: 401 (no session / member), 404 (room mismatch), 400 (missing `tmdbMovieId`).
- **`POST /api/rooms/[code]/votes`** — main vote flow (only the pending-member 403 is covered today
  inside `join-approval.test.ts`).
  - Stale vote → 409 when the submitted movie isn't the (freshly re-read) current card.
  - No-vote → `advanceQueueAtomic`, `{ matched: false, advance }`.
  - Yes-vote, no match → `{ matched: false }`.
  - Yes-vote, match → `{ matched: true, movie, advance }`, movie hydrated from `getMovieById` +
    queue entry's `watchUrl`/`streamingService`.
  - Guards: 401, 403 (left/unapproved), 404, 409 (not VOTING), 400 (missing fields).

## 2. Stack Choices

Reuse the established route-test pattern (`__tests__/api/room-code-collision.test.ts`,
`rooms-session.test.ts`, `join-approval.test.ts`):

- `@jest-environment node` docblock; call the exported `POST` directly with
  `ctx = { params: Promise.resolve({ code }) }`.
- Mock `@/lib/prisma` with an in-memory store (module-level `let`s reset in `beforeEach`); mock
  `next/headers` `cookies()` with a `jar` Map and drive auth via `sessionCookieName(code)` (real
  `@/lib/session`).
- Per route:
  - **requeue** — mock `@/lib/tmdb` (real-shaped `STREAMING_SERVICES`, `type` re-exports, `jest.fn`
    `discoverMovies`); `$transaction` is the **array** form → mock as `(ops) => Promise.all(ops)`.
  - **watched** — mock `@/lib/queue` (`advanceQueueAtomic` → controlled `AdvanceResult`),
    `@/lib/link` + `@/lib/preferences` (avoid pulling NextAuth ESM through the hook path).
  - **votes** — mock `@/lib/queue`, `@/lib/match` (`checkForMatch`), `@/lib/tmdb` (`getMovieById`),
    `@/lib/link`, `@/lib/preferences`.
- Assert sets / position ranges, never shuffle order (routes use `Math.random`).

## 3. Environment Verification

- Read the current `requeue`/`watched`/`votes` handlers (post-`7e6efb9`); votes now re-reads
  `currentPosition`/`queueVersion` after body-parse (`fresh`), so the mock's `room.findUnique` must
  return the live position both times.
- Confirmed the in-memory-prisma + cookie-jar pattern runs under the existing `next/jest` config
  with no DB/TMDB key (room-code-collision, rooms-session, join-approval all pass this way).
- Full suite currently green at 125; new files are additive and must keep it green.
- No `.env`, auth, schema, migration, or package changes.

## 4. Risks & Edge Cases

- **`$transaction` two forms**: requeue uses the array form (`Promise.all`); watched/votes use none
  (advanceQueueAtomic is mocked). Mock the array form only where needed.
- **`{ increment: 1 }`**: the requeue room-update mock must interpret increment objects, not assign
  them literally (assert `queueVersion` rose / `currentPosition` set on DRAINED).
- **Skip-reruns advances only on the current card**: include the "marked a non-current movie → no
  advance" case so the branch isn't tested vacuously.
- **NextAuth ESM**: mock `@/lib/link` + `@/lib/preferences` (and `@/lib/match`/`@/lib/tmdb` for
  votes) or the import throws under Jest.
- **Best-effort hook**: making `addPreference` reject must still yield `{ ok: true }` (watched) and a
  normal vote response (votes).

## 5. Assumptions & Open Questions

- Testing at the route-handler seam (not the React pages) satisfies the "#4 route tests" ask.
- Mocking `advanceQueueAtomic`/`checkForMatch` is acceptable — each has its own unit suite
  (`queue.test.ts`, `match.test.ts`); these assert the route's branching, not queue/match internals.
- Purely additive: three new `__tests__/api/*.test.ts` files; no production edits.
- The prior-cycle untracked files (requeue route, redesign components, MatchResult test) are listed
  in the manifest for drift-safety.

## 6. Out of Scope

- React page/component tests (vote/setup/lobby/match) — hard to test, excluded.
- The already-covered routes (match/queue/join-approval/rooms-session/poll-members/room-code).
- `start`, `queue` (GET), friends/*, user/*, auth/* route tests.
- Any production code, schema, or config change.

## 7. Readiness Verdict: READY FOR PLANNING

Three additive `@jest-environment node` test files (`requeue`, `watched`, `votes`) using the
established prisma/cookie mock harness, asserting each handler's branches against the current code.
**READY FOR PLANNING.**
