# Research — Tier-0 recommender (cycle 1: pure scorer)

Spec/plan: `docs/superpowers/{specs,plans}/2026-06-11-recommender-tier0*`. Branch
`feat/recommender-tier0` off `feat/event-tracking-pipeline` (#14, for the dwell signal).

The recommender is split into two serial cycles to keep each verifiable:
- **Cycle 1 (this):** the pure `lib/recommender.ts` scorer + unit tests. No schema, no routes — it
  has zero I/O coupling, so it lands and verifies on its own without breaking any existing route test.
- **Cycle 2 (next):** `RoomQueue.genreIds`/`rating` schema + persistence at start/requeue + wiring the
  scorer into `queue/route.ts` (with `pickedBy` + dwell-by-code join) + queue-route tests + the
  **gated migration**.

## Requirements Summary

Pure, in-session, group-consensus scorer: from the room's decided `(genres, vote, dwellMs?)` build an
exposure-normalized genre-weight vector (YES weighted by dwell up to 2× over 8s; NO always −1), score
each eligible candidate by its average genre weight + a small rating prior, and pick the argmax with a
lowest-position tie-break. Returns `null` below 5 votes / empty eligible so the caller can fall back.

## Stack Choices

- A single pure module `lib/recommender.ts` (no Prisma, no I/O) so it's unit-testable without a DB —
  matches the repo's Jest convention. Constants (`MIN_VOTES_TO_RANK`, `DWELL_REF_MS`,
  `RATING_PRIOR_WEIGHT`, `RATING_BASELINE`) live there.
- Exact math is fixed in the spec ("Scoring math (authoritative)").

## Environment Verification

- No new deps. The module is consumed later by `queue/route.ts` (cycle 2).
- `verify.sh` green at the start of this branch (204 tests inherited from #14). The pure module +
  tests are purely additive — no route or schema touched this cycle.

## Risks & Edge Cases

- Exposure normalization (frequent genre can't dominate), YES-only dwell, NO=−1, unseen genre ⇒ 0,
  `|genres|=0` ⇒ genreScore 0, unknown rating (≤0) ⇒ no prior, `voteCount<5` ⇒ null, lowest-position
  tie-break — all covered by unit tests.
- Floating-point score equality only matters for exact ties (e.g., all-zero) → deterministic
  position tie-break.

## Assumptions & Open Questions

- Dwell magnitude is supplied by the caller (cycle 2 reads it from `Event` by room code); the pure
  module just takes optional `dwellMs`. No blocking questions.

## Out of Scope (this cycle)

- Schema/migration, feature persistence, queue-route wiring, `pickedBy`, the dwell join — all cycle 2.

## Readiness Verdict: READY FOR PLANNING
