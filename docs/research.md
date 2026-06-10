# Research — Cycle 2: Per-member decks (a "nope" only affects you) + card fits one screen

The risky part, isolated from Cycle 1. Two changes:

1. **A "nope" must not yank everyone forward.** Today everyone votes on one shared card (`room.currentPosition`); any "no" calls `advanceQueueAtomic` and moves the whole room. Switch to **per-member decks**: each person swipes their own card at their own pace. A "nope" removes the movie from everyone's *upcoming* deck (user's choice) but never interrupts the card someone is currently viewing. Match = everyone liked the same movie.
2. **VotingCard must fit one screen** (no scrolling to reach the Nope/Pik buttons).

---

## 1. Requirements Summary

### R1 — Per-member decks
Current model (read from source):
- `poll/route.ts` serves the card at the shared `room.currentPosition` to everyone (`currentMovie`).
- `votes/route.ts`: a `!vote` (no) runs `advanceQueueAtomic` → bumps shared `currentPosition`/`queueVersion` for everyone (the disorienting jump); a `vote` (yes) runs `checkForMatch`; both re-validate against the shared card via a staleness 409.
- `watched/route.ts`: marking seen with skip-reruns ON also `advanceQueueAtomic`s the shared queue.
- `queue/route.ts` *already* computes a per-member "next card" (first entry not in `member votes ∪ global rejects ∪ watched`) — but sources it from the half-retired `MemberQueue`, which `requeue` never refills (so requeued movies would be invisible).

New model:
- **Card source:** repurpose `queue/route.ts` to source the next card from **`RoomQueue`** (ordered by `position`), excluding `member votes ∪ global rejects (anyone voted no) ∪ watched`. This drops the `MemberQueue` dependency and means `requeue` (which appends to `RoomQueue`) automatically feeds decks. `remaining` = count of eligible `RoomQueue` rows.
- **Card fetched on own action only:** the vote page fetches `/queue` on mount and after the member's own vote / seen-removal — **not** on every poll. This is what guarantees another person's "nope" never changes the card you're looking at.
- **Votes:** `votes/route.ts` drops the shared-card staleness check and all `advanceQueueAtomic` calls. A "no" just records `vote:false` (→ now in global rejects → excluded from everyone's *future* deck). A "yes" records the vote and runs `checkForMatch`.
- **Match propagation:** with no `advanceQueueAtomic`, `queueVersion` no longer changes on votes, so a match wouldn't bust the poll's 304 for other approved members. Fix: `checkForMatch` bumps `queueVersion` when it sets `MATCHED`. The triggering voter redirects from the vote response; everyone else redirects when their poll sees `status: MATCHED`.
- **Watched:** `watched/route.ts` drops `advanceQueueAtomic`; the `WatchedMovie` row + `/queue`'s room-wide watched exclusion (skip-reruns ON) already removes it from every deck.
- **Exhaustion:** when `/queue` returns `null` the member has voted on everything → show a per-member "all caught up — waiting for the others" screen (host gets a "broaden filters" affordance → existing `HostFilterEditor` → `requeue` appends + bumps `queueVersion` → the exhausted member's next poll re-fetches `/queue` and resumes). The room no longer auto-`DRAINED`s; that branch becomes dead but harmless.

### R2 — Card fits one screen
`VotingCard` uses a fixed `aspect-[3/4]` poster that overflows the viewport, pushing the Nope/Pik buttons below the fold. Make the vote view a viewport-height (`h-[100dvh]`) flex column: compact header, poster fills the remaining space (`flex-1 min-h-0`, `object-cover`), info compact, buttons pinned. Swipe + click voting behavior unchanged.

---

## 2. Stack Choices
- Reuse the tested `/queue` route shape (`{movie, remaining}` | `null`); only change its data source to `RoomQueue`.
- Reuse `checkForMatch`'s guarded `updateMany` (add `queueVersion` increment).
- Reuse `HostFilterEditor` (already rendered for hosts) for the host's broaden-on-exhaustion path; reuse `handleApproval`/poll for status/members/pending.
- `advanceQueueAtomic` stays defined (still unit-tested in `lib/queue.test.ts`) but loses its callers — no deletion needed.

## 3. Environment Verification
- No env/package/schema changes. `RoomQueue`, `Vote`, `WatchedMovie` already hold everything needed. `room.currentPosition` simply stops advancing (stays 0); `poll/route.ts` still computes an (now-unused) `currentMovie` — left as-is to keep the poll route and its tests out of scope.

## 4. Risks & Edge Cases
- **Card stability is the whole point:** the card must change *only* on the member's own action. Re-fetching `/queue` on poll would re-introduce the jump when two people sit on the same card and one nopes. Only re-fetch on poll when the member is **exhausted** (`card === null`) and `queueVersion` grew (to pick up a requeue).
- **Voting a vetoed card:** since I don't re-fetch on others' actions, a member may "yes" a movie someone else already "no"d — harmless, it just can't reach unanimous and they advance normally. This is the deliberate "never interrupt the current card" trade.
- **Match must reach everyone:** REQUIRES the `queueVersion` bump in `checkForMatch`; without it approved non-host members 304 and never see `MATCHED`.
- **Spurious drain:** leaving `advanceQueueAtomic` in votes/watched would keep bumping `currentPosition` and could flip the room to `DRAINED` while members still have cards — so both calls must be removed.
- **Hardened concurrency:** the removed staleness/CAS guards were for the shared queue; the remaining race (concurrent yes → match) is still covered by `checkForMatch`'s `updateMany(where status VOTING)` guard.
- **Tests to rewrite:** `queue-route.test.ts` (RoomQueue source: `roomQueue.findFirst`/`count` instead of `memberQueue`), `votes.test.ts` (no staleness 409, no advance on no; vote recorded; yes→match), `watched.test.ts` (no advance; just upsert + hook), `match.test.ts` (assert `queueVersion` increment). `VotingCard.test.tsx` is behavioral (swipe/click → onVote) and should survive the layout change — verify.
- **Vote page is a client component** (jsdom lacks fetch) — not unit-tested; rely on the route/lib tests + manual browser verification of the deck flow and layout.

## 5. Assumptions & Open Questions
- **Resolved (user):** a nope removes the movie from everyone's upcoming deck but never interrupts the current card.
- **Assumption:** same deck order for all (RoomQueue `position` order) is acceptable — per-member *shuffle* was a `MemberQueue` nicety not requested; progress is independent, which is what matters.
- **Assumption:** per-member exhaustion + host "broaden filters" replaces the old room-level `DRAINED` screen acceptably (host can still broaden any time via the filter editor).

## 6. Out of Scope
- `poll/route.ts` (left unchanged; its `currentMovie` becomes unused but harmless), `auth.ts`, `.env*`, schema/migrations.
- Deleting `advanceQueueAtomic` / `MemberQueue` (retire later).
- Per-member deck shuffle.

## 7. Readiness Verdict: READY FOR PLANNING
- R1 → `app/api/rooms/[code]/queue/route.ts`, `app/api/rooms/[code]/votes/route.ts`, `app/api/rooms/[code]/watched/route.ts`, `lib/match.ts`, `app/room/[code]/vote/page.tsx` (+ tests: `queue-route`, `votes`, `watched`, `match`).
- R2 → `components/VotingCard.tsx` (+ `app/room/[code]/vote/page.tsx` container).
