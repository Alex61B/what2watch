// lib/recommender.ts
// Pure, in-session group-consensus scorer for the next voting card. No I/O — the queue
// route supplies the data and owns the fallback. Math is authoritative in
// docs/superpowers/specs/2026-06-11-recommender-tier0-design.md.

export const MIN_VOTES_TO_RANK = 5
export const DWELL_REF_MS = 8000
export const RATING_PRIOR_WEIGHT = 0.1
export const RATING_BASELINE = 6.0

export interface Candidate {
  tmdbMovieId: string
  position: number
  genreIds: number[]
  rating: number
}
export interface Decided {
  genreIds: number[]
  vote: boolean
  dwellMs?: number
}
export interface RoomSignal {
  genreWeight: Map<number, number>
  voteCount: number
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * Build the room's genre-weight vector from its decided movies. Each vote contributes to
 * every genre of its movie: YES → +(1 + clamp(dwell/8s, 0, 1)) (1–2×), NO → −1 (dwell
 * ignored). Weights are normalized by exposure (votes touching that genre) so a
 * high-volume genre can't dominate by sheer count.
 */
export function buildRoomSignal(decided: Decided[]): RoomSignal {
  const numerator = new Map<number, number>()
  const exposure = new Map<number, number>()
  for (const d of decided) {
    const contribution = d.vote ? 1 + clamp01((d.dwellMs ?? 0) / DWELL_REF_MS) : -1
    for (const g of d.genreIds) {
      numerator.set(g, (numerator.get(g) ?? 0) + contribution)
      exposure.set(g, (exposure.get(g) ?? 0) + 1)
    }
  }
  const genreWeight = new Map<number, number>()
  for (const [g, n] of numerator) {
    genreWeight.set(g, n / (exposure.get(g) ?? 1))
  }
  return { genreWeight, voteCount: decided.length }
}

/** Average genre weight over the candidate's genres + a small rating prior. */
export function scoreCandidate(c: Candidate, signal: RoomSignal): number {
  let genreScore = 0
  if (c.genreIds.length > 0) {
    let sum = 0
    for (const g of c.genreIds) sum += signal.genreWeight.get(g) ?? 0
    genreScore = sum / c.genreIds.length
  }
  const ratingPrior = c.rating > 0 ? RATING_PRIOR_WEIGHT * (c.rating - RATING_BASELINE) : 0
  return genreScore + ratingPrior
}

/**
 * Highest-scoring eligible candidate, tie-broken by lowest position. Returns null when the
 * room hasn't voted enough yet (cold start) or there are no eligible candidates — the caller
 * then falls back to the lowest-position card (today's behavior).
 */
export function pickNext(eligible: Candidate[], signal: RoomSignal): Candidate | null {
  if (signal.voteCount < MIN_VOTES_TO_RANK || eligible.length === 0) return null
  let best = eligible[0]
  let bestScore = scoreCandidate(best, signal)
  for (let i = 1; i < eligible.length; i++) {
    const c = eligible[i]
    const s = scoreCandidate(c, signal)
    if (s > bestScore || (s === bestScore && c.position < best.position)) {
      best = c
      bestScore = s
    }
  }
  return best
}
