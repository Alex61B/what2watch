# Research: Shared Real-Time Veto Queue

## Requirements Summary

Replace the current per-member shuffled queue with a single shared queue per room where:

- All active members see the same "current" movie at any given time, determined by `Room.currentPosition` indexing into the shared `RoomQueue`.
- A **NO** vote ("veto") from any member immediately advances the queue for everyone — the movie is appended to a per-room `skippedMovieIds` list and `currentPosition` is incremented atomically.
- A **YES** vote is recorded silently; if all currently-active members of the room have YES'd the same `(roomId, currentPosition)`, the server writes a `Match` row and advances the queue the same way as a NO.
- All clients converge on the new current movie within a small bounded latency (≤2s p95) via short polling against a cheap ETag (`Room.queueVersion`).
- When `currentPosition >= roomQueue.length`, the room transitions to a new `DRAINED` status; the UI renders an end-of-queue view.

The functional outcome is "any veto kills the movie for everyone, immediately." The non-functional outcome is "no duplicate skips, no stale votes, no client desync."

## Stack Choices

| Concern | Choice | Rationale |
|---|---|---|
| Realtime sync | **Short polling with ETag (`If-None-Match`)**, 1.5s interval, returns 304 when `queueVersion` is unchanged | Vercel Hobby/Pro serverless functions cannot hold a persistent WebSocket. SSE is possible but adds per-room connection cost; for an MVP a 1.5s polling tick is good enough for the 2s p95 target. Polling code is also trivially debuggable. SSE/WebSocket migration deferred to a phase-2 ticket. |
| Concurrency control | **Postgres compare-and-swap via `WHERE currentPosition = $expected`** | Native to Prisma's `updateMany`. Simpler than `SELECT ... FOR UPDATE` row locks, and Prisma reports affected-row count so a racy advance is detected by `count === 0`. |
| Versioning / ETag | **Integer `queueVersion` on `Room`**, bumped on every advance | Cheaper than hashing state; monotonic; trivial `If-None-Match`. |
| Skipped movie storage | **`String[]` column on `Room` (`skippedMovieIds`)** | Append-only list, small (~60 entries max per session), no joins needed. Avoids creating a separate table for an MVP-scale dataset. |
| Vote staleness check | **Vote payload carries `tmdbMovieId`; server compares to `roomQueue[currentPosition].tmdbMovieId`** | Single round trip, no extra read on the client. 409 on mismatch tells the client to re-render from server state. |
| Per-member queue | **Retire `MemberQueue` as the source of truth for the voting screen.** Either drop the table or repurpose as `MemberSeen`. Decision: **drop** for MVP. | Per-member shuffling fundamentally contradicts "everyone sees the same movie." Keeping it as a secondary table invites desync bugs. |
| Match logic reuse | **Existing `Match` table + `lib/match` helpers** | Already tested (`__tests__/lib/match.test.ts`). Match creation runs inside the same transaction as the YES vote's advance. |

## Environment Verification

- `.workflow_state` = RESEARCH (post-cycle reset, confirmed by `cat .workflow_state`).
- `.workflow_failures` = 0.
- Prior cycle (debug instrumentation + genre union) verified via `bash scripts/verify.sh` — 42 tests passing, typecheck and lint clean.
- Tech stack confirmed in `AGENTS.md`: Next.js 15 App Router, TypeScript, Prisma ORM, PostgreSQL, NextAuth 5, Tailwind, Jest.
- Production deploy is live at `https://what2watch-gamma-sable.vercel.app` serving commit `4bee8fc` (verified via `gh api .../deployments`).
- Vercel runtime constraints (no persistent WebSocket connections on serverless functions; ~10s execution limit on Hobby, ~5min on Pro) inform the polling-over-SSE decision.
- Database: Supabase Postgres. Schema migrations require explicit user approval per the project's Prisma migration rule (see existing memory). New columns on `Room` are non-blocking adds with defaults; safe even on live data.

## Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| **Simultaneous NO votes on the same movie.** Two users veto within ~50ms. | CAS update: `UPDATE Room SET currentPosition = $X+1, queueVersion = $V+1, skippedMovieIds = array_append(skippedMovieIds, $movieId) WHERE id = $R AND currentPosition = $X`. First wins. Subsequent votes see `count === 0`, return 409, client refetches state. Movie appears once in skip list. |
| **Stale YES vote arrives after queue advanced.** User A is on movie #5; user B vetos; A's YES arrives 200ms later. | Vote body carries `tmdbMovieId`. Server compares to current. Mismatch → 409 + current state. Vote never applied to the wrong movie. |
| **Stale NO vote arrives after queue advanced.** Same as above but a NO. | Same mechanism. The "redundant veto" cannot double-skip — the CAS WHERE clause would already see the new `currentPosition`. |
| **Match-eligible YES arrives while another user vetoes.** All-YES count completes for movie #5 in the same instant a NO for #5 arrives. | Both end up as CAS attempts. Whichever transaction commits first wins. Lost transaction returns 409 to its caller; UI re-renders. No `Match` row is orphaned because the match write is inside the same transaction as the advance. |
| **Late joiner.** User joins mid-session, several movies already skipped. | First `/state` poll returns full snapshot: `currentPosition`, `currentMovie`, `skippedMovieIds`, `queueVersion`, `status`, `activeMemberCount`. Client renders from the snapshot. No client-side replay. |
| **All members but one leave; remaining user keeps voting.** YES match condition relies on "all active members YES'd." | "Active member" computed from `Member.leftAt IS NULL` at vote-evaluation time. Single member remaining → their YES alone satisfies the all-YES count → match recorded. (Product decision: confirm with user; alternative is "needs ≥ 2 members for a match".) |
| **Queue drains.** All movies vetoed or matched, `currentPosition >= length`. | CAS advance that would push position past the end instead sets `status = 'DRAINED'` in the same transaction. Polling clients see new status, swap to the DRAINED view. |
| **Network blip on the voting client.** User taps NO, response is delayed. | Vote button locked until either (a) the response returns, or (b) a poll observes a new `queueVersion`, or (c) 5s timeout fires re-enabling the button. Prevents dead UI without enabling double-vote. |
| **Polling cost.** 1.5s polling per active client × N members × M concurrent rooms. | `If-None-Match: "<queueVersion>"` returns 304 with no body and no DB read (handler short-circuits after a `SELECT queueVersion FROM Room WHERE id = $r`). Expected steady-state: ~0.7 RPS per member, single indexed select, minimal Vercel function cost. |
| **Pre-existing per-member queue rows.** Live rooms in `MemberQueue` from the current code path. | Migration order: ship new vote API + new `Room` columns first (additive, safe). Then ship the new voting UI that reads from `RoomQueue`/`currentPosition`. Then, once no live room is using `MemberQueue`, ship a follow-up migration that drops the table. Three commits; never an inconsistent live state. |
| **Race between Start-handler and first vote.** Race between `Room.status = 'VOTING'` write and first incoming vote. | Vote handler short-circuits if `room.status !== 'VOTING'` (returns 409). Start handler already writes status inside a transaction with the queue creation. |
| **Vote idempotency on client retries.** User taps YES, request times out, client retries. | `Vote` table gets a unique constraint on `(memberId, tmdbMovieId)`. Duplicate insert → `P2002` → server treats as success (idempotent). |
| **Production observability.** "Vote disappeared" / "out of sync" complaints. | Carry forward the `stage`-based logging pattern from the recently-shipped `start/route.ts`. Every vote handler logs `{ stage, voterId, position, version, vote, decision }` on success and the full structured payload on failure. |

## Assumptions & Open Questions

**Assumptions (acting as if true unless overridden):**

1. Match semantics: a `Match` is recorded when **all currently-active members** have voted YES on the same movie. (Same model as today's matching; just gated on the shared `currentPosition`.)
2. Single-member rooms can match. If the host is the only active member and votes YES, that's a match. (If product wants ≥ 2, change a constant; cheap.)
3. We don't surface vetoers' identity in the UI. The product currently treats votes as anonymous from the recipient's perspective; preserved here.
4. We don't allow vote retraction in MVP. Once submitted, votes are final until the queue advances.
5. The host's existing "Start" action is the only entry to `VOTING` status. No mid-session "deal more movies" feature in this plan — captured as future work.

**Open questions (will surface to user before locking the plan):**

1. Should YES votes from non-host members be visible in real time to other members ("3/4 voted yes"), or only revealed when a match is recorded? Current product UI doesn't show this; defaulting to "no live count" unless asked.
2. When `status = DRAINED` and the host re-deals (future feature), do we reset `skippedMovieIds` or carry it forward as a filter? Out of scope; flagging.
3. Polling interval: 1.5s recommended. Acceptable for product? (Trade-off: lower interval = snappier feel + higher cost.)

## Out of Scope

Explicitly **not** part of this feature:

- SSE / WebSocket / Ably / Pusher / Supabase Realtime integration (deferred to phase 2).
- "Deal more movies" / re-deal action on a drained room.
- Vote retraction / undo.
- Live "X of Y members have voted" indicator on the voting screen.
- Per-member "already seen" filtering on rejoin (only matters if we let users leave & rejoin during VOTING; product doesn't currently support this).
- Replacing the existing `Match` discovery flow — we extend it, don't rewrite it.
- Dropping `MemberQueue` in this PR. Drop ships in a follow-up PR after the new code path is fully live.
- Changes to the `Start` handler beyond what's required to initialize `currentPosition = 0` and `queueVersion = 0` on the room (already defaulted by the schema migration; the handler may need no changes).
- Authentication, billing, or session handling changes.

## Readiness Verdict: READY FOR PLANNING

All seven sections complete. Assumptions and open questions are recorded but do not block planning — they are bounded product decisions with sensible defaults. The technical mechanism (CAS-based advance, tmdbMovieId staleness check, queueVersion ETag, short polling) is concrete enough to derive a file manifest from.

Proceed to PLAN: define `.workflow_plan_files`, schema migration, API surface, component changes, and acceptance criteria.
