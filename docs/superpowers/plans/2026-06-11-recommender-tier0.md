# Tier-0 Recommender — Implementation Plan

> **For agentic workers:** This repo uses the **Backpressure workflow** (`AGENTS.md`):
> RESEARCH → PLAN → IMPLEMENT → TEST, driven **serially** (one `.workflow_plan_files` manifest at a
> time). Do **NOT** fan out parallel subagents — `.workflow_state`/`.workflow_plan_files` are
> singletons. Steps use checkbox (`- [ ]`) syntax. TDD on the pure module; `bash scripts/verify.sh`
> must stay green. Branch: `feat/recommender-tier0` off `feat/event-tracking-pipeline` (PR #14).

**Goal:** Re-rank each member's next voting card from "lowest queue position" to "highest
group-consensus score" learned in-session from votes (authoritative) weighted by dwell (best-effort).

**Architecture:** Read-time scoring in `GET /api/rooms/[code]/queue` via a pure `lib/recommender.ts`;
movie features (`genreIds`, `rating`) persisted on `RoomQueue` at build time; cold-start + dwell-miss
both fall back to today's lowest-position behavior. No queue mutation.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma/Postgres, Jest (Prisma mocked).

**Source spec:** `docs/superpowers/specs/2026-06-11-recommender-tier0-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | add `genreIds Int[]` + `rating Float` to `RoomQueue` (+ migration) |
| `lib/recommender.ts` | pure scoring: `buildRoomSignal`, `scoreCandidate`, `pickNext` + constants |
| `app/api/rooms/[code]/start/route.ts` | persist `genreIds`/`rating` when building `RoomQueue` |
| `app/api/rooms/[code]/requeue/route.ts` | persist `genreIds`/`rating` when rebuilding `RoomQueue` |
| `app/api/rooms/[code]/queue/route.ts` | gather inputs → score → pick → fallback; `pickedBy` + log |
| `__tests__/lib/recommender.test.ts` | unit tests (pure) |
| `__tests__/api/queue-route.test.ts` | ranking + `pickedBy` cases (extend existing) |

---

### Task 1: Schema + migration (GATED)

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: Add the two columns** to the `RoomQueue` model:

```prisma
model RoomQueue {
  id               String @id @default(uuid())
  roomId           String
  tmdbMovieId      String
  position         Int
  streamingService String
  watchUrl         String
  genreIds         Int[]  @default([])
  rating           Float  @default(0)
  room             Room   @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@unique([roomId, tmdbMovieId])
  @@index([roomId, position])
}
```

- [ ] **Step 2: Validate** — Run: `npx prisma validate` → Expected: "schema ... is valid 🚀"

- [ ] **Step 3: GATE — request approval, then migrate with the LOCAL CLI**

Stop and ask the user. Then (only after approval):
Run: `./node_modules/.bin/prisma migrate dev --name add_roomqueue_features`
> Use the local CLI, NOT bare `npx prisma` (it pulls v7 and breaks this v6 project — see memory
> `reference-prisma-migrate-local-cli`). Generated migration SQL trips `.workflow_drift`; recover via
> `bash scripts/advance_state.sh drift-to-plan` (user-run), then add the migration dir to the manifest.

- [ ] **Step 4: Commit**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(reco): add genreIds + rating to RoomQueue"
```

---

### Task 2: Pure scorer — `lib/recommender.ts` (TDD)

**Files:** Create `lib/recommender.ts`, Test `__tests__/lib/recommender.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/recommender.test.ts
import {
  buildRoomSignal, scoreCandidate, pickNext,
  MIN_VOTES_TO_RANK, RATING_PRIOR_WEIGHT, RATING_BASELINE,
  type Candidate,
} from '@/lib/recommender'

const cand = (tmdbMovieId: string, position: number, genreIds: number[], rating = 0): Candidate =>
  ({ tmdbMovieId, position, genreIds, rating })

describe('buildRoomSignal', () => {
  test('exposure-normalizes so a high-volume genre does not dominate', () => {
    const s = buildRoomSignal([
      { genreIds: [1], vote: true }, { genreIds: [1], vote: true }, { genreIds: [1], vote: true }, // 3 YES, genre 1
      { genreIds: [2], vote: true }, // 1 YES, genre 2
    ])
    expect(s.genreWeight.get(1)).toBeCloseTo(1) // 3/3
    expect(s.genreWeight.get(2)).toBeCloseTo(1) // 1/1 — equal despite 3x volume
    expect(s.voteCount).toBe(4)
  })

  test('dwell weights YES only: ≥8s → 2, 4s → 1.5, none → 1', () => {
    expect(buildRoomSignal([{ genreIds: [1], vote: true, dwellMs: 8000 }]).genreWeight.get(1)).toBeCloseTo(2)
    expect(buildRoomSignal([{ genreIds: [1], vote: true, dwellMs: 4000 }]).genreWeight.get(1)).toBeCloseTo(1.5)
    expect(buildRoomSignal([{ genreIds: [1], vote: true }]).genreWeight.get(1)).toBeCloseTo(1)
    expect(buildRoomSignal([{ genreIds: [1], vote: true, dwellMs: 999999 }]).genreWeight.get(1)).toBeCloseTo(2) // clamp
  })

  test('NO is always −1 regardless of dwell', () => {
    expect(buildRoomSignal([{ genreIds: [1], vote: false, dwellMs: 999999 }]).genreWeight.get(1)).toBeCloseTo(-1)
  })
})

describe('scoreCandidate', () => {
  const signal = buildRoomSignal([{ genreIds: [1], vote: true }, { genreIds: [2], vote: false }]) // w1=1, w2=-1
  test('averages genre weights over the candidate genre count; unseen genre = 0', () => {
    expect(scoreCandidate(cand('a', 0, [1]), signal)).toBeCloseTo(1)        // 1/1
    expect(scoreCandidate(cand('a', 0, [1, 2]), signal)).toBeCloseTo(0)     // (1 + -1)/2
    expect(scoreCandidate(cand('a', 0, [1, 99]), signal)).toBeCloseTo(0.5)  // (1 + 0)/2, 99 unseen
  })
  test('empty genres → genreScore 0; rating prior applies only when rating > 0', () => {
    expect(scoreCandidate(cand('a', 0, [], 0), signal)).toBeCloseTo(0)                       // unknown rating ⇒ no prior
    expect(scoreCandidate(cand('a', 0, [], 8), signal)).toBeCloseTo(RATING_PRIOR_WEIGHT * (8 - RATING_BASELINE)) // 0.2
  })
})

describe('pickNext', () => {
  const warm = buildRoomSignal(Array.from({ length: 5 }, () => ({ genreIds: [1], vote: true as const }))) // w1=1, voteCount 5
  test('returns null below the vote threshold', () => {
    const cold = buildRoomSignal([{ genreIds: [1], vote: true }]) // voteCount 1 < 5
    expect(pickNext([cand('a', 0, [1])], cold)).toBeNull()
  })
  test('picks the highest score', () => {
    const chosen = pickNext([cand('low', 0, [2]), cand('high', 1, [1])], warm) // genre1 favored
    expect(chosen?.tmdbMovieId).toBe('high')
  })
  test('ties break by lowest position', () => {
    const chosen = pickNext([cand('p3', 3, [1]), cand('p1', 1, [1]), cand('p2', 2, [1])], warm)
    expect(chosen?.tmdbMovieId).toBe('p1')
  })
  test('empty eligible → null', () => {
    expect(pickNext([], warm)).toBeNull()
  })
})

test('MIN_VOTES_TO_RANK is 5', () => expect(MIN_VOTES_TO_RANK).toBe(5))
```

- [ ] **Step 2: Run — expect failure** — Run: `npx jest __tests__/lib/recommender.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/recommender.ts
// Pure, in-session group-consensus scorer. No I/O — the queue route supplies the data and
// owns the fallback. See docs/superpowers/specs/2026-06-11-recommender-tier0-design.md.

export const MIN_VOTES_TO_RANK = 5
export const DWELL_REF_MS = 8000
export const RATING_PRIOR_WEIGHT = 0.1
export const RATING_BASELINE = 6.0

export interface Candidate { tmdbMovieId: string; position: number; genreIds: number[]; rating: number }
export interface Decided { genreIds: number[]; vote: boolean; dwellMs?: number }
export interface RoomSignal { genreWeight: Map<number, number>; voteCount: number }

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function buildRoomSignal(decided: Decided[]): RoomSignal {
  const numerator = new Map<number, number>()
  const exposure = new Map<number, number>()
  for (const d of decided) {
    // Dwell weights YES only (long dwell on a NO is deliberation, not strong rejection).
    const contribution = d.vote ? 1 + clamp01((d.dwellMs ?? 0) / DWELL_REF_MS) : -1
    for (const g of d.genreIds) {
      numerator.set(g, (numerator.get(g) ?? 0) + contribution)
      exposure.set(g, (exposure.get(g) ?? 0) + 1)
    }
  }
  const genreWeight = new Map<number, number>()
  for (const [g, n] of numerator) {
    genreWeight.set(g, n / (exposure.get(g) ?? 1)) // exposure-normalized
  }
  return { genreWeight, voteCount: decided.length }
}

export function scoreCandidate(c: Candidate, signal: RoomSignal): number {
  let genreScore = 0
  if (c.genreIds.length > 0) {
    let sum = 0
    for (const g of c.genreIds) sum += signal.genreWeight.get(g) ?? 0
    genreScore = sum / c.genreIds.length // average over the candidate's genre count
  }
  const ratingPrior = c.rating > 0 ? RATING_PRIOR_WEIGHT * (c.rating - RATING_BASELINE) : 0
  return genreScore + ratingPrior
}

/** Highest score, tie-broken by lowest position. null ⇒ caller falls back (cold start / empty). */
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
```

- [ ] **Step 4: Run — expect pass** — Run: `npx jest __tests__/lib/recommender.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/recommender.ts __tests__/lib/recommender.test.ts
git commit -m "feat(reco): pure group-consensus scorer"
```

---

### Task 3: Persist movie features at queue-build time

**Files:** Modify `app/api/rooms/[code]/start/route.ts`, `app/api/rooms/[code]/requeue/route.ts`

- [ ] **Step 1: `start` route** — in the `roomQueue.createMany` mapping, add `genreIds`/`rating` from
the discovered `TmdbMovie`:

```ts
prisma.roomQueue.createMany({
  data: shuffled.map((movie, position) => ({
    roomId: room.id,
    tmdbMovieId: movie.tmdbId,
    position,
    streamingService: serviceIds[0],
    watchUrl: `https://www.themoviedb.org/movie/${movie.tmdbId}`,
    genreIds: movie.genreIds,
    rating: movie.rating,
  })),
  skipDuplicates: true,
}),
```

- [ ] **Step 2: `requeue` route** — same addition in its `roomQueue.createMany` mapping:

```ts
prisma.roomQueue.createMany({
  data: fresh.map((movie, i) => ({
    roomId: room.id,
    tmdbMovieId: movie.tmdbId,
    position: startPos + i,
    streamingService: serviceIds[0],
    watchUrl: `https://www.themoviedb.org/movie/${movie.tmdbId}`,
    genreIds: movie.genreIds,
    rating: movie.rating,
  })),
  skipDuplicates: true,
}),
```

- [ ] **Step 3: Verify** — Run: `npm run typecheck` → PASS (`TmdbMovie` has `genreIds: number[]` + `rating: number`).

- [ ] **Step 4: Commit**
```bash
git add "app/api/rooms/[code]/start/route.ts" "app/api/rooms/[code]/requeue/route.ts"
git commit -m "feat(reco): persist genreIds + rating on RoomQueue build"
```

---

### Task 4: Wire the recommender into the queue route

**Files:** Modify `app/api/rooms/[code]/queue/route.ts`

> Read the file first. Today it computes `excludedIds`, then `roomQueue.findFirst` (lowest position)
> + a `roomQueue.count` for `remaining`, then `getMovieById`. Replace the **selection** only; keep the
> exclusion logic, the heartbeat, and the TMDB fetch.

- [ ] **Step 1: Add imports + a dwell loader** at the top of the file:

```ts
import { buildRoomSignal, pickNext, scoreCandidate, type Candidate } from '@/lib/recommender'

// card_decided events carry the room CODE (not id) and no memberId, so dwell aggregates per
// (code, movieId). YES events only (matches the YES-only dwell weighting). A miss → empty map ⇒
// votes-only weighting; it can never zero the signal.
async function loadDwellByMovie(roomCode: string): Promise<Map<string, number>> {
  const events = await prisma.event.findMany({
    where: { roomId: roomCode, type: 'card_decided' },
    select: { props: true },
  })
  const acc = new Map<string, { total: number; n: number }>()
  for (const e of events) {
    const p = e.props as { movieId?: unknown; vote?: unknown; dwellMs?: unknown } | null
    if (!p || p.vote !== true) continue
    const movieId = typeof p.movieId === 'string' ? p.movieId : null
    const dwellMs = typeof p.dwellMs === 'number' ? p.dwellMs : null
    if (!movieId || dwellMs === null) continue
    const cur = acc.get(movieId) ?? { total: 0, n: 0 }
    cur.total += dwellMs
    cur.n += 1
    acc.set(movieId, cur)
  }
  const avg = new Map<string, number>()
  for (const [m, { total, n }] of acc) avg.set(m, total / n)
  return avg
}
```

- [ ] **Step 2: Replace the `findFirst` + `count` block** (the `room-queue-find` / `remaining-count`
stages) with scored selection. `excludedIds`/`notInClause` from the existing code stay:

```ts
    stage = 'room-queue-load'
    const allQueue = await prisma.roomQueue.findMany({
      where: { roomId: room.id },
      select: { tmdbMovieId: true, position: true, genreIds: true, rating: true, watchUrl: true, streamingService: true },
    })
    const excludedSet = new Set(excludedIds)
    const eligible = allQueue.filter((q) => !excludedSet.has(q.tmdbMovieId))
    if (eligible.length === 0) {
      return NextResponse.json(null)
    }

    stage = 'signal'
    const genreMap = new Map(allQueue.map((q) => [q.tmdbMovieId, q.genreIds]))
    const votes = await prisma.vote.findMany({
      where: { roomId: room.id },
      select: { tmdbMovieId: true, vote: true },
    })
    const dwellByMovie = await loadDwellByMovie(room.code)
    const signal = buildRoomSignal(
      votes.map((v) => ({ genreIds: genreMap.get(v.tmdbMovieId) ?? [], vote: v.vote, dwellMs: dwellByMovie.get(v.tmdbMovieId) })),
    )

    stage = 'rank'
    const candidates: Candidate[] = eligible.map((q) => ({
      tmdbMovieId: q.tmdbMovieId, position: q.position, genreIds: q.genreIds, rating: q.rating,
    }))
    const chosen = pickNext(candidates, signal)
    const pickedBy: 'score' | 'fallback' = chosen ? 'score' : 'fallback'
    const chosenId = chosen?.tmdbMovieId
      ?? eligible.reduce((a, b) => (b.position < a.position ? b : a)).tmdbMovieId
    const nextEntry = eligible.find((q) => q.tmdbMovieId === chosenId)!
    const remaining = eligible.length

    console.log('[queue] picked', {
      roomId: room.id,
      pickedBy,
      voteCount: signal.voteCount,
      dwellMatches: dwellByMovie.size,
      topScore: chosen ? Number(scoreCandidate(chosen, signal).toFixed(3)) : null,
    })
```

- [ ] **Step 3: Add `pickedBy` to the success response** (the `getMovieById` block is unchanged):

```ts
    return NextResponse.json({
      movie: { ...movie, watchUrl: nextEntry.watchUrl, streamingService: nextEntry.streamingService },
      remaining,
      pickedBy,
    })
```

- [ ] **Step 4: Verify** — Run: `npm run typecheck && npm run lint` → PASS.

- [ ] **Step 5: Commit**
```bash
git add "app/api/rooms/[code]/queue/route.ts"
git commit -m "feat(reco): score-rank the next card in the queue route"
```

---

### Task 5: Queue-route ranking test + full verification

**Files:** Modify `__tests__/api/queue-route.test.ts`

> Read the existing file for its Prisma mock shape. The route now calls `prisma.roomQueue.findMany`
> (not `findFirst`/`count`), `prisma.vote.findMany`, and `prisma.event.findMany`. Extend the mock to
> provide those, and add the two cases below.

- [ ] **Step 1: Add the mock methods** the route now needs (merge into the existing
`jest.mock('@/lib/prisma', …)`): `roomQueue: { findMany: jest.fn() }`, `vote: { findMany: jest.fn() }`,
`event: { findMany: jest.fn(async () => []) }`, plus the existing `member`/`room` mocks and the
`getMovieById` mock (returns a movie object for any id).

- [ ] **Step 2: Add the warm-path test** — ≥5 votes favoring genre 1 ⇒ the genre-1 candidate wins with
`pickedBy: 'score'`:

```ts
test('warm room ranks by genre score and reports pickedBy:score', async () => {
  // member + room mocks set to a VOTING room (reuse existing helpers)
  ;(prisma.roomQueue.findMany as jest.Mock).mockResolvedValue([
    { tmdbMovieId: 'drama',  position: 0, genreIds: [18], rating: 0, watchUrl: 'u', streamingService: 'netflix' },
    { tmdbMovieId: 'action', position: 1, genreIds: [28], rating: 0, watchUrl: 'u', streamingService: 'netflix' },
  ])
  ;(prisma.vote.findMany as jest.Mock).mockResolvedValue(
    // 5 prior YES votes on action movies (genre 28) by other members; none on the two eligible cards
    Array.from({ length: 5 }, (_, i) => ({ tmdbMovieId: `seed${i}`, vote: true })),
  )
  // genreMap for seed votes resolves to [] (not in queue) → use an action card in queue instead:
  // simplest: include a voted action movie in roomQueue so genreMap maps it.
  // (Adjust the roomQueue mock to also contain the 5 voted action movies with genreIds:[28].)
  const res = await GET(req(), ctx('ROOM1'))
  const body = await res.json()
  expect(body.pickedBy).toBe('score')
  expect(body.movie.tmdbId ?? body.movie.id).toBe('action')
})
```
> Implementation note: for the genre signal to favour genre 28, the 5 voted movies must be present in
> `roomQueue.findMany`'s result with `genreIds: [28]` (so `genreMap` resolves them) and excluded from
> `eligible` (they're voted). Set the member's voted ids accordingly, mirroring the existing
> `excludedIds` mock. Keep `event.findMany → []` (votes-only weighting).

- [ ] **Step 3: Add the cold-path test** — under 5 votes ⇒ lowest position, `pickedBy: 'fallback'`:

```ts
test('cold room falls back to lowest position with pickedBy:fallback', async () => {
  ;(prisma.roomQueue.findMany as jest.Mock).mockResolvedValue([
    { tmdbMovieId: 'p1', position: 1, genreIds: [28], rating: 9, watchUrl: 'u', streamingService: 'netflix' },
    { tmdbMovieId: 'p0', position: 0, genreIds: [18], rating: 1, watchUrl: 'u', streamingService: 'netflix' },
  ])
  ;(prisma.vote.findMany as jest.Mock).mockResolvedValue([{ tmdbMovieId: 'x', vote: true }]) // 1 < 5
  const res = await GET(req(), ctx('ROOM1'))
  const body = await res.json()
  expect(body.pickedBy).toBe('fallback')
  expect(body.movie.tmdbId ?? body.movie.id).toBe('p0') // lowest position despite p1's higher rating
})
```

- [ ] **Step 4: Run the gate** — Run: `bash scripts/verify.sh` → Expected: typecheck + lint + all Jest
green (existing 204 + recommender unit tests + these two cases).

- [ ] **Step 5: Update `PROMPTS.md`** (dated entry: prompt, approach, verification) and **commit**:
```bash
git add "__tests__/api/queue-route.test.ts" PROMPTS.md
git commit -m "test(reco): queue-route ranking + cold-start cases"
```

- [ ] **Step 6: Close the workflow** per `AGENTS.md`; open/refresh the PR when the user asks.

---

## Self-review (plan vs spec)

- **Spec coverage:** schema features (T1) · exact scoring math incl. exposure-normalization, YES-only
  dwell, rating prior, tie-break (T2) · feature persistence at start+requeue (T3) · read-time wiring +
  dwell-by-code join + `pickedBy` + observability log (T4) · cold-start fallback (T2 `pickNext` null →
  T4 fallback) · tests incl. ranking/cold-start (T2, T5) · gated migration with local CLI (T1). All map.
- **Type consistency:** `Candidate`/`Decided`/`RoomSignal` + `buildRoomSignal`/`scoreCandidate`/
  `pickNext` defined in T2 and used unchanged in T4/T5; constants (`MIN_VOTES_TO_RANK` etc.) referenced
  consistently. `genreIds Int[]` / `rating Float` names match across T1, T3, T4.
- **Open risk:** T4 & T5 edit existing files whose internals aren't fully pinned here — each says "read
  the file first" and gives the precise replacement + integration contract.
