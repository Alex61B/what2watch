# Design — Tier-0 in-session recommender (group-consensus re-ranker)

**Status:** Approved design, pre-implementation
**Date:** 2026-06-11
**Base branch:** `feat/event-tracking-pipeline` (PR #14) — uses the `card_decided` dwell signal.
Rebases onto `main` when #14 merges.

## Summary

Re-rank each member's next voting card from "lowest queue position" to "highest **group-consensus
score**," learned in-session from the room's votes (authoritative) weighted by dwell time
(best-effort). Goal: surface broadly-liked movies sooner so the room reaches a unanimous-YES match
faster. Pure, read-time scoring in `GET /api/rooms/[code]/queue`; the `position` / `currentPosition`
/ requeue machinery is untouched.

Scope is **Tier-0 only**: in-session genre-preference re-rank + a rating prior + cold-start fallback.
Out of scope: consensus "swipes-to-match" ordering, TMDB recommendations/similar candidate
generation, per-user cross-session personalization.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Signal | **Votes (authoritative) + dwell (best-effort weight)** |
| Optimize for | **Group consensus** — score from the whole room's votes |
| Breadth | **Tier-0** only |
| Where | **Read-time** scoring in `/queue` (no queue mutation) |
| Cold-start | `< 5` room votes ⇒ fallback to lowest-position (today's behavior) |
| Migration | Gated on explicit approval; run with the **local** Prisma CLI |

## Scoring math (authoritative)

Constants (one place — `lib/recommender.ts`):
`MIN_VOTES_TO_RANK = 5`, `DWELL_REF_MS = 8000`, `RATING_PRIOR_WEIGHT = 0.1`, `RATING_BASELINE = 6.0`.

### Genre weights — normalized by exposure

Over every room vote `v` (all members) joined to its movie's `genreIds`:

```
contribution(v) =
  v.vote === YES ?  1 + clamp(dwellMs(v) / DWELL_REF_MS, 0, 1)   // +1 … +2
                 : -1                                            // NO: always −1, dwell IGNORED

for each genre g in the voted movie:
  numerator[g] += contribution(v)
  exposure[g]  += 1

genreWeight[g] = numerator[g] / exposure[g]        // exposure-normalized → range ≈ [−1, +2]
```

- **Dwell weights YES only** (deliberate: long dwell on a NO signals deliberation, not strong
  rejection). A YES with no dwell datum ⇒ weight `1`. A YES with dwell ≥ 8s ⇒ weight `2`
  (the clamp makes the 60s dwell-cap irrelevant — anything ≥ 8s is max weight).
- **Exposure normalization** means a frequently-voted genre contributes its *average* signed
  sentiment, not a volume-inflated sum.

### Per-candidate score

For an eligible candidate `C` (genres `G_C`, rating `r_C`):

```
genreScore(C) = |G_C| === 0 ? 0
              : ( Σ_{g ∈ G_C} (genreWeight[g] ?? 0) ) / |G_C|   // unseen genre ⇒ 0; avg over genre count

ratingPrior(C) = r_C > 0 ? RATING_PRIOR_WEIGHT * (r_C − RATING_BASELINE) : 0
                 // 0.1·(r−6) ≈ [−0.2, +0.4]; unknown rating (≤ 0) ⇒ 0 (neutral, not a penalty)

score(C) = genreScore(C) + ratingPrior(C)
```

- `genreScore` is averaged over `|G_C|` so multi-genre films aren't inflated; magnitude ≈ [−1, +2].
- `ratingPrior` is intentionally small so it's a mild prior / tie-leaner (matters most early, when
  genre signal is sparse), never overpowering the learned signal.

### Selection

`pickNext(eligible, signal)`:
1. If `signal.voteCount < MIN_VOTES_TO_RANK` ⇒ return `null` (caller falls back).
2. If `eligible` is empty ⇒ return `null`.
3. Otherwise return the candidate with the **highest `score`**, **tie-broken by lowest `position`**
   (stable; preserves the original ordering for equal scores).

Fallback (caller, when `pickNext` returns `null`): the lowest-`position` eligible candidate — exactly
today's behavior.

## Data flow (in `GET /api/rooms/[code]/queue`)

Inputs gathered (the exclusion logic — voted / vetoed / watched — is unchanged):

1. **All `RoomQueue` entries for the room** in one query: `{ tmdbMovieId, position, genreIds, rating }`.
   Derives both the genre map (movieId → genreIds) and the eligible set (entries whose `tmdbMovieId`
   is not excluded).
2. **All room votes**: `prisma.vote.findMany({ where: { roomId }, select: { tmdbMovieId, vote } })`.
3. **Dwell map (best-effort)** — see the explicit join below.

Then: `signal = buildRoomSignal(decided)` where `decided[i] = { genreIds: genreMap[vote.tmdbMovieId]
?? [], vote: vote.vote, dwellMs: dwellByMovie[vote.tmdbMovieId] }`; `chosen = pickNext(eligible,
signal)`; if `chosen` is `null`, fall back to the lowest-position eligible. `remaining =
eligible.length` (replaces the separate count query). Then the existing `getMovieById(chosen)` fetch.

### Dwell join — pinned explicitly (item 4)

`card_decided` events were emitted client-side as `track('card_decided', { movieId, vote, dwellMs,
dwellCapped? }, { roomId: <CODE> })`. Therefore:

- **`Event.roomId` holds the room CODE**, NOT the room id (`Vote.roomId` / `RoomQueue.roomId` hold the
  id). The dwell query MUST use the code: `prisma.event.findMany({ where: { roomId: <room.code>, type:
  'card_decided' } })`. The route passes `room.code` explicitly; a code/id mix-up is called out in a
  code comment at the call site.
- **Events carry no `memberId`** for `card_decided`, so dwell cannot be attributed per member — it
  aggregates per `(code, movieId)`. `dwellByMovie[movieId] = average(props.dwellMs)` over that
  movie's `card_decided` events **where `props.vote === true`** (YES only, matching the weighting).
- **A key mismatch can NOT silently zero the signal.** If the dwell query returns nothing (wrong key,
  events dropped, or the analytics table empty), every YES simply gets `dwellWeight = 1` and the
  recommender runs on **votes alone** — it degrades to votes-only, it never zeroes. Observability
  (below) surfaces the dwell-match count so a silent mismatch is detectable.

## Observability (item 6)

- The `/queue` response gains `pickedBy: 'score' | 'fallback'` so the recommender's firing is
  verifiable from the client/Network tab. The vote page ignores the field (no UI change).
- A server log on each pick: `console.log('[queue] picked', { roomId, pickedBy, voteCount,
  dwellMatches, topScore })` — `dwellMatches` = number of movies with a dwell datum, so a
  code/id key mismatch shows up as `dwellMatches: 0` despite votes existing.

## Schema change (prerequisite)

Add to `RoomQueue`:
```prisma
genreIds Int[]   @default([])
rating   Float   @default(0)
```
Populated at queue-build time from `discoverMovies` (which returns `genreIds` + `rating`):
- `app/api/rooms/[code]/start/route.ts` — when creating `RoomQueue` rows.
- `app/api/rooms/[code]/requeue/route.ts` — when rebuilding rows.

Existing rooms (pre-migration) keep `genreIds = []`, `rating = 0`. Then `genreScore = 0` and
`ratingPrior = 0` (rating ≤ 0 treated as unknown ⇒ neutral), so every candidate scores 0 and the
lowest-`position` tie-break wins ⇒ **exactly today's order**. New rooms — and any room after a
post-migration requeue — get the full benefit.

## Module boundary — `lib/recommender.ts` (new, pure)

```ts
export interface Candidate { tmdbMovieId: string; position: number; genreIds: number[]; rating: number }
export interface Decided   { genreIds: number[]; vote: boolean; dwellMs?: number }
export interface RoomSignal { genreWeight: Map<number, number>; voteCount: number }

export function buildRoomSignal(decided: Decided[]): RoomSignal
export function scoreCandidate(c: Candidate, signal: RoomSignal): number
export function pickNext(eligible: Candidate[], signal: RoomSignal): Candidate | null  // null ⇒ fallback
```

All pure (no I/O), so unit-testable without a DB. `queue/route.ts` does the I/O and the fallback.

## Testing

- `__tests__/lib/recommender.test.ts` (pure): genre accumulation + exposure normalization; YES dwell
  weighting (1 vs 2 at/over 8s) and the cap-irrelevance; **NO always −1 regardless of dwell**; unseen
  genre ⇒ 0; `|G_C|=0` ⇒ genreScore 0; rating-prior magnitude; `voteCount < 5` ⇒ `pickNext` null;
  argmax with **lowest-position tie-break**.
- `__tests__/api/queue-route.test.ts` (mocked Prisma): once warm (≥5 votes), the higher-genre-score
  candidate is returned with `pickedBy: 'score'`; under 5 votes, lowest-position with
  `pickedBy: 'fallback'`. Update existing assertions for the new response field.

## Migration & rollout

- Adds two `RoomQueue` columns ⇒ `prisma migrate dev --name add_roomqueue_features`. **GATED** — not
  run without explicit approval; run via `./node_modules/.bin/prisma` (local CLI) to avoid the
  npx 6→7 trap. Additive, non-breaking.
- Rollout is safe: scoring only changes *which* eligible card is shown; the fallback is byte-for-byte
  today's behavior, and dwell absence degrades to votes-only.

## Out of scope

Tier-1 consensus/swipes-to-match ordering; TMDB `/recommendations` & `/similar` candidate generation;
cross-session per-user personalization; any queue-mutation / persisted re-ordering; UI changes.
