import {
  buildRoomSignal,
  scoreCandidate,
  pickNext,
  MIN_VOTES_TO_RANK,
  RATING_PRIOR_WEIGHT,
  RATING_BASELINE,
  type Candidate,
} from '@/lib/recommender'

const cand = (tmdbMovieId: string, position: number, genreIds: number[], rating = 0): Candidate => ({
  tmdbMovieId,
  position,
  genreIds,
  rating,
})

describe('buildRoomSignal', () => {
  test('exposure-normalizes so a high-volume genre does not dominate', () => {
    const s = buildRoomSignal([
      { genreIds: [1], vote: true },
      { genreIds: [1], vote: true },
      { genreIds: [1], vote: true }, // 3 YES on genre 1
      { genreIds: [2], vote: true }, // 1 YES on genre 2
    ])
    expect(s.genreWeight.get(1)).toBeCloseTo(1) // 3/3
    expect(s.genreWeight.get(2)).toBeCloseTo(1) // 1/1 — equal despite 3x volume
    expect(s.voteCount).toBe(4)
  })

  test('dwell weights YES only: >=8s -> 2, 4s -> 1.5, none -> 1, clamps above 8s', () => {
    expect(buildRoomSignal([{ genreIds: [1], vote: true, dwellMs: 8000 }]).genreWeight.get(1)).toBeCloseTo(2)
    expect(buildRoomSignal([{ genreIds: [1], vote: true, dwellMs: 4000 }]).genreWeight.get(1)).toBeCloseTo(1.5)
    expect(buildRoomSignal([{ genreIds: [1], vote: true }]).genreWeight.get(1)).toBeCloseTo(1)
    expect(buildRoomSignal([{ genreIds: [1], vote: true, dwellMs: 999999 }]).genreWeight.get(1)).toBeCloseTo(2)
  })

  test('NO is always -1 regardless of dwell', () => {
    expect(buildRoomSignal([{ genreIds: [1], vote: false, dwellMs: 999999 }]).genreWeight.get(1)).toBeCloseTo(-1)
  })
})

describe('scoreCandidate', () => {
  const signal = buildRoomSignal([
    { genreIds: [1], vote: true }, // w1 = 1
    { genreIds: [2], vote: false }, // w2 = -1
  ])

  test('averages genre weights over the candidate genre count; unseen genre counts as 0', () => {
    expect(scoreCandidate(cand('a', 0, [1]), signal)).toBeCloseTo(1) // 1/1
    expect(scoreCandidate(cand('a', 0, [1, 2]), signal)).toBeCloseTo(0) // (1 + -1)/2
    expect(scoreCandidate(cand('a', 0, [1, 99]), signal)).toBeCloseTo(0.5) // (1 + 0)/2
  })

  test('empty genres -> genreScore 0; rating prior applies only when rating > 0', () => {
    expect(scoreCandidate(cand('a', 0, [], 0), signal)).toBeCloseTo(0) // unknown rating ⇒ no prior
    expect(scoreCandidate(cand('a', 0, [], 8), signal)).toBeCloseTo(RATING_PRIOR_WEIGHT * (8 - RATING_BASELINE)) // 0.2
  })
})

describe('pickNext', () => {
  const warm = buildRoomSignal(
    Array.from({ length: 5 }, () => ({ genreIds: [1], vote: true as const })),
  ) // w1 = 1, voteCount 5

  test('returns null below the vote threshold', () => {
    const cold = buildRoomSignal([{ genreIds: [1], vote: true }]) // voteCount 1 < 5
    expect(pickNext([cand('a', 0, [1])], cold)).toBeNull()
  })

  test('picks the highest score', () => {
    const chosen = pickNext([cand('low', 0, [2]), cand('high', 1, [1])], warm)
    expect(chosen?.tmdbMovieId).toBe('high')
  })

  test('ties break by lowest position', () => {
    const chosen = pickNext([cand('p3', 3, [1]), cand('p1', 1, [1]), cand('p2', 2, [1])], warm)
    expect(chosen?.tmdbMovieId).toBe('p1')
  })

  test('empty eligible -> null', () => {
    expect(pickNext([], warm)).toBeNull()
  })
})

test('MIN_VOTES_TO_RANK is 5', () => expect(MIN_VOTES_TO_RANK).toBe(5))
