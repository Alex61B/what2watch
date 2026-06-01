# Research — Group A: UI Polish (home button, member visibility, Tinder swipe)

First of four refinement cycles. Quick UI wins only; no schema change, no new dependency.
Design spec: `docs/superpowers/specs/2026-06-01-group-a-ui-polish-design.md`.

## 1. Requirements Summary

Four user-requested UI refinements:

- **A1 (#5)** — Add a **Home** button to the profile screens so users can leave the profile area back to `/`. Today `app/profile/*` pages have no navigation out.
- **A2 (#2)** — Show the **member count/list on the room setup page** so the host can see who has joined before starting. `setup/page.tsx` fetches `members` on load but never renders them; it does not poll.
- **A3 (#3)** — Show a **participant roster to everyone during voting**. `MemberList` only renders in the lobby; the vote page shows no roster, and the poll response carries `memberCount` but not the member list.
- **A4 (#1)** — Make the swipe **Tinder-like**: card follows the finger/mouse, rotates, shows LIKE/NOPE overlays, springs back below a threshold and flies off past it. Today `VotingCard` only detects a >50px swipe then plays a fixed fly-off via page-level `swipeDir`.

## 2. Stack Choices

- **No new dependency.** `package.json` has no gesture/animation library, and project rules forbid adding packages without explicit approval. The swipe is hand-rolled with **Pointer Events** + CSS transforms (touch + mouse).
- Reuse `components/MemberList.tsx` for the setup roster (A2).
- Reuse the existing poll loop on the vote page (A3) and add a 3s poll to setup (A2), matching the lobby/vote polling pattern.
- New presentational `components/ProfileHeader.tsx` (title + Home link), server-component safe.

## 3. Environment Verification

- Poll route `app/api/rooms/[code]/poll/route.ts` returns `{ status, memberCount, matchedMovie, rejectedMovieIds, watchedFilter, currentPosition, queueVersion, currentMovie, isHost }` and an ETag/304 short-circuit on `queueVersion`. Adding a `members` array is one extra `prisma.member.findMany` after the 304 check — does not change ETag semantics.
- `Member` model has `displayName`, `isHost`, `joinedAt`, `leftAt` — sufficient for the roster (`where leftAt: null`, `orderBy joinedAt asc`).
- `setup/page.tsx` already holds `members` in `RoomState`; rendering + a poll interval is additive.
- `VotingCard` is consumed only by `vote/page.tsx`; its `onVote(vote)` + `disabled` contract and YES/NO buttons are covered by `__tests__/components/VotingCard.test.tsx` (synchronous `onVote`). The rewrite preserves that contract.
- `npm run typecheck`, `npm run lint`, `npm test` are the verification commands (`scripts/verify.sh`).

## 4. Risks & Edge Cases

- **Test breakage (A4):** existing tests expect `onVote` to fire synchronously on button click. Mitigation: buttons call `onVote` immediately and only set the exit-animation state; the callback is never deferred behind the animation.
- **jsdom can't simulate pointer geometry:** drag distance/threshold behavior isn't reliably unit-testable. Mitigation: keep button-based tests as the unit contract; verify drag manually.
- **Poll payload growth (A3):** `members` adds a small array per poll (1.5s interval on vote). Acceptable for room-sized member counts; bounded by `leftAt: null`.
- **Pointer capture / stuck drag:** must reset `dragX` and release capture on `onPointerUp`/`onPointerCancel` to avoid a card stuck mid-drag. Drag disabled when `disabled` is true (submitting/locked).
- **Setup polling lifecycle:** interval must be cleared on unmount to avoid leaks/duplicate polls, matching lobby/vote.

## 5. Assumptions & Open Questions

- Assume the host is a normal `Member` row (current member) on the setup page — confirmed by the create-room transaction (`isHost: true`).
- Assume "N watching" should reflect active members (`leftAt: null`), not lifetime joiners.
- No open questions blocking planning: scope, swipe richness (full drag + LIKE/NOPE overlay), roster presentation (collapsible "N watching" chip), and live-vs-static (live on both) were confirmed with the user.

## 6. Out of Scope

- **B** room naming, **C** real TMDB `watch/providers`, **D** join-mid-session with host approval — each a separate later cycle.
- Any schema/migration or dependency change.
- Removing the temporary debug instrumentation from the prior cycle (separate concern).

## 7. Readiness Verdict: READY FOR PLANNING

Scope is four additive, no-schema UI changes with a clear file list and a test strategy that preserves the existing `VotingCard` contract. **READY FOR PLANNING.**
