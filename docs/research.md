# Research — Tier-0 recommender (cycle 2: schema + persistence + queue wiring)

Spec/plan: `docs/superpowers/{specs,plans}/2026-06-11-recommender-tier0*`. Cycle 1 (pure
`lib/recommender.ts` scorer) shipped + verified. This cycle wires it in. **The DB migration is
deferred to a gated step** — code is written + `prisma generate`d so it typechecks; `migrate dev`
runs only on explicit user approval (run with the local CLI).

## Requirements Summary

- `RoomQueue` gains `genreIds Int[]` + `rating Float`, populated at build time in `start` + `requeue`
  from `discoverMovies`.
- `queue/route.ts` selects the next card by **highest group-consensus score** (via cycle-1
  `pickNext`) instead of lowest position, falling back to lowest position on cold start / no signal.
- Votes signal is read from `Vote` (by room id); dwell from `Event` `card_decided` (by room **code**,
  YES only) — a key mismatch degrades to votes-only, never zeroes. Response gains `pickedBy` + a
  `[queue] picked` log.

## Stack Choices / Environment Verification

- **Queue route block confirmed** (lines 68–105): replace `notInClause` + `roomQueue.findFirst` +
  `roomQueue.count` with `roomQueue.findMany` (select incl. `genreIds`/`rating`) → JS exclude via
  `excludedSet` → build signal (`vote.findMany` all + dwell-by-code) → `pickNext` → fallback. Keep the
  exclusion computation, heartbeat, and TMDB fetch.
- **`room.code`** is on the `findUnique` result (no select) → available for the dwell join.
- **`start.test.ts` unaffected** — it reads only `position`/`tmdbMovieId` from `roomQueue.createMany`
  data; extra fields are ignored. Not in the manifest.
- **`queue-route.test.ts` reworked**: mock `roomQueue.findMany` + `event.findMany` (drop
  `findFirst`/`count`); `getMovieById` echoes the id so the chosen card is assertable; exclusion is
  verified by which candidate is chosen; add warm (`pickedBy:score`) + cold (`pickedBy:fallback`) cases.
- `prisma generate` (safe, no DB) makes `genreIds`/`rating` typecheck before the gated migration.

## Risks & Edge Cases

- **Migration deferred/gated** — schema edited + generated this cycle; `migrate dev` is the gated
  follow-up (local CLI per `reference-prisma-migrate-local-cli`; drift recovery is user-run).
- **Dwell key** is room **code** (not id); miss ⇒ votes-only weighting (never zeroed); `dwellMatches`
  logged for observability.
- **No behavior change for existing/pre-migration rooms** (genreIds=[], rating=0 ⇒ score 0 ⇒
  position tie-break) and **cold rooms** (<5 votes ⇒ fallback) — both byte-for-byte today's order.
- `vote.findMany` is now called three times (member votes, rejects, all-for-signal) — the test mock
  differentiates by `where` (memberId / vote:false / roomId-only).

## Assumptions & Open Questions

- `pickedBy` added to the `/queue` JSON is ignored by the vote page (no UI change). No blocking questions.

## Out of Scope

- Running the migration (gated); UI changes; Tier-1+ ranking; TMDB recommendation candidate generation.

## Readiness Verdict: READY FOR PLANNING
