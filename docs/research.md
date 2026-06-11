# Research — Event tracking pipeline (Phase 2a: dwell signal)

Spec/plan: `docs/superpowers/{specs,plans}/2026-06-10-event-tracking-pipeline*`.
Phase 1 (core pipeline: Event table + ingest + client track + AnalyticsTracker) shipped and
verified; migration applied on Prisma 6.19.3 (an accidental npx 6→7 bump was reverted).

Phase 2 is split to keep each cycle small and reviewable:
- **2a (this cycle):** the recommender-critical **dwell signal** — `lib/dwell.ts` + wiring
  `card_decided` (with visibility-aware, ceiling-capped dwell) into the vote page, plus the
  `room_matched` funnel event (already in that file) and the `docs/analytics-queries.md` doc.
- **2b (next cycle):** the remaining funnel (`room_created/joined/started`) and `feature_used`
  emits across `app/page.tsx`, lobby/setup pages, `RoomCodeBar`, `DrainedScreen`,
  `HostFilterEditor`, and the friends pages (~8 client sites; simple one-liners each).

## Requirements Summary

Capture clean per-slide attention time as `card_decided { movieId, vote, dwellMs, dwellCapped? }`
— the implicit-feedback signal for the future recommender. Dwell counts only visible, current-card
time (pause on tab hide) and is hard-capped at 60s. Emit `room_matched` when a vote produces a match.

## Stack Choices

- **Pure `lib/dwell.ts`** (clock injected) so the accumulator is unit-tested without a DOM.
- Wire into `app/room/[code]/vote/page.tsx`: a `dwellRef` started by an effect keyed on the
  current movie id, a `visibilitychange` listener for pause/resume, and `finalizeDwell` + `track`
  in the existing `handleVote`. `room_matched` goes in the existing `data.matched` branch.
- Reuse the `track()` client from Phase 1; no new infra.

## Environment Verification

- Vote page read: `card.tmdbId` is the current movie; `handleVote(vote)` is the single decision
  point; line ~198 `data.matched` is the match branch; `code` is the room code. All present.
- `lib/analytics.ts`, `lib/analytics-events.ts` (with `DWELL_CEILING_MS`) from Phase 1 are in place.
- `verify.sh` green at Phase 1 close (200 tests); Prisma back on 6.19.3.

## Risks & Edge Cases

- **Backgrounded tab must not inflate dwell** — visibility-aware accumulation + 60s ceiling+flag.
- **exhaustive-deps lint** — the dwell effect keys on a derived `cardId` (not the `card` object) so
  it restarts only when the movie changes and satisfies the hook lint rule.
- **No behavior change** — instrumentation is additive; voting/advance logic untouched.
- Dwell helper is pure → fully unit-tested (visible-only accrual, pause/resume idempotence, cap+flag).

## Assumptions & Open Questions

- One `card_decided` per swipe (no separate skip action — confirmed from the vote page).
- `dwellCapped` only set when raw dwell exceeds the ceiling. No blocking questions.

## Out of Scope

- 2b funnel + `feature_used` emits (next cycle).
- Recommender logic; dashboards; retention cron.

## Readiness Verdict: READY FOR PLANNING
