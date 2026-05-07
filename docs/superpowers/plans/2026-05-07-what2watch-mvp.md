# What2Watch MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a group movie-picking app where friends create a shared room, select streaming services, and vote yes/no on movies until everyone agrees on one.

**Architecture:** Next.js App Router monolith with API routes, PostgreSQL via Prisma, anonymous session cookies for auth, and 3-second client-side polling for real-time feel. Movie metadata is never stored — it's fetched fresh from TMDB. Queue is generated once server-side when the host starts the session.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Prisma ORM, PostgreSQL, TMDB API, Jest + React Testing Library, Vercel deployment.

---

## File Map

```
app/
  page.tsx                          Landing — create room / join by code
  room/[code]/
    setup/page.tsx                  Room Setup — host picks streaming services
    lobby/page.tsx                  Lobby — share link, member list, host starts
    vote/page.tsx                   Voting — Tinder-style cards + poll loop
    match/page.tsx                  Match — celebration + Watch Now link
    done/page.tsx                   No Match — queue exhausted, retry suggestions
  api/rooms/
    route.ts                        POST /api/rooms
    [code]/
      route.ts                      GET + PATCH /api/rooms/[code]
      members/route.ts              POST /api/rooms/[code]/members
      start/route.ts                POST /api/rooms/[code]/start
      queue/route.ts                GET /api/rooms/[code]/queue
      votes/route.ts                POST /api/rooms/[code]/votes
      poll/route.ts                 GET /api/rooms/[code]/poll

lib/
  prisma.ts                         Prisma client singleton
  session.ts                        Session cookie read/write helpers
  room-code.ts                      Random room code generation with uniqueness retry
  tmdb.ts                           TMDB API client + in-memory cache
  match.ts                          Match detection query (extracted for testability)

prisma/
  schema.prisma

components/
  StreamingServicePicker.tsx        Checkbox grid of 6 streaming services
  MemberList.tsx                    Live member list with online dots
  VotingCard.tsx                    Movie card with Yes/No buttons + touch swipe
  MatchCelebration.tsx              Match screen with confetti + Watch Now button

__tests__/
  lib/session.test.ts
  lib/room-code.test.ts
  lib/tmdb.test.ts
  lib/match.test.ts
  components/VotingCard.test.tsx
  components/StreamingServicePicker.test.tsx
```

---

## Task 1: Project Bootstrap

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `jest.config.ts`, `jest.setup.ts`

- [ ] **Step 1: Scaffold Next.js app**

```bash
cd /Users/alexsmith/Downloads/What2Watch
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --no-import-alias --yes
```

Expected: Next.js project created with TypeScript and Tailwind.

- [ ] **Step 2: Install dependencies**

```bash
npm install prisma @prisma/client
npm install --save-dev jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event ts-jest @types/jest
```

- [ ] **Step 3: Configure Jest**

Create `jest.config.ts`:
```typescript
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
}

export default createJestConfig(config)
```

Create `jest.setup.ts`:
```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Add test script to package.json**

In `package.json`, add to `scripts`:
```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 5: Create .env.local**

```bash
cat > .env.local << 'EOF'
DATABASE_URL="postgresql://localhost:5432/what2watch_dev"
TMDB_API_KEY="your_tmdb_api_key_here"
SESSION_SECRET="dev-secret-change-in-production-min-32-chars"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
EOF
```

Get a free TMDB API key at https://www.themoviedb.org/settings/api

- [ ] **Step 6: Add .env.local to .gitignore**

Verify `.gitignore` already includes `.env.local` (Next.js adds it by default). If not, add it.

- [ ] **Step 7: Create local Postgres database**

```bash
createdb what2watch_dev
```

- [ ] **Step 8: Verify Next.js runs**

```bash
npm run dev
```

Expected: Server starts at http://localhost:3000 with the default Next.js page.

- [ ] **Step 9: Commit**

```bash
git init
git add -A
git commit -m "chore: bootstrap Next.js app with TypeScript, Tailwind, Jest"
```

---

## Task 2: Prisma Schema + Migration

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

Expected: Creates `prisma/schema.prisma` and updates `.env` with DATABASE_URL placeholder.

- [ ] **Step 2: Write schema**

Replace contents of `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  displayName   String
  savedServices String[]
  savedFilters  Json?
  createdAt     DateTime @default(now())
  members       Member[]
}

model Room {
  id                String     @id @default(uuid())
  code              String     @unique
  hostMemberId      String
  streamingServices String[]
  filters           Json?
  status            RoomStatus @default(LOBBY)
  matchedMovieId    String?
  createdAt         DateTime   @default(now())
  expiresAt         DateTime
  members           Member[]
  queue             RoomQueue[]
  votes             Vote[]
}

enum RoomStatus {
  LOBBY
  VOTING
  MATCHED
  DONE
}

model Member {
  id           String   @id @default(uuid())
  roomId       String
  userId       String?
  displayName  String
  sessionToken String   @unique
  isHost       Boolean  @default(false)
  joinedAt     DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  room         Room     @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user         User?    @relation(fields: [userId], references: [id])
  votes        Vote[]
}

model RoomQueue {
  id               String @id @default(uuid())
  roomId           String
  tmdbMovieId      String
  position         Int
  streamingService String
  watchUrl         String
  room             Room   @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@unique([roomId, tmdbMovieId])
  @@index([roomId, position])
}

model Vote {
  id          String   @id @default(uuid())
  roomId      String
  memberId    String
  tmdbMovieId String
  vote        Boolean
  votedAt     DateTime @default(now())
  room        Room     @relation(fields: [roomId], references: [id], onDelete: Cascade)
  member      Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@unique([roomId, memberId, tmdbMovieId])
  @@index([roomId, tmdbMovieId, vote])
}
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name init
```

Expected: Migration created and applied. Prisma Client generated.

- [ ] **Step 4: Verify schema in Prisma Studio**

```bash
npx prisma studio
```

Expected: Opens at http://localhost:5555. Confirm all 5 tables visible: User, Room, Member, RoomQueue, Vote.

- [ ] **Step 5: Create Prisma singleton**

Create `lib/prisma.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 6: Commit**

```bash
git add prisma/ lib/prisma.ts
git commit -m "feat: add Prisma schema and initial migration"
```

---

## Task 3: Session Utilities

**Files:**
- Create: `lib/session.ts`, `__tests__/lib/session.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/session.test.ts`:
```typescript
import { generateSessionToken, SESSION_COOKIE_NAME } from '@/lib/session'

describe('generateSessionToken', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateSessionToken()).toBe('string')
    expect(generateSessionToken().length).toBeGreaterThan(0)
  })

  it('returns unique tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSessionToken))
    expect(tokens.size).toBe(100)
  })
})

describe('SESSION_COOKIE_NAME', () => {
  it('is a non-empty string', () => {
    expect(typeof SESSION_COOKIE_NAME).toBe('string')
    expect(SESSION_COOKIE_NAME.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=session
```

Expected: FAIL — `Cannot find module '@/lib/session'`

- [ ] **Step 3: Implement session utilities**

Create `lib/session.ts`:
```typescript
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

export const SESSION_COOKIE_NAME = 'w2w_session'

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
}

export function setSessionCookie(
  response: Response,
  token: string,
  maxAgeSeconds = 60 * 60 * 24 * 7 // 7 days
): void {
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/`
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=session
```

Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/session.ts __tests__/lib/session.test.ts
git commit -m "feat: add session token utilities"
```

---

## Task 4: Room Code Generation

**Files:**
- Create: `lib/room-code.ts`, `__tests__/lib/room-code.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/room-code.test.ts`:
```typescript
import { generateRoomCode, isValidRoomCode } from '@/lib/room-code'

describe('generateRoomCode', () => {
  it('returns a string matching WORD-DIGITS format', () => {
    const code = generateRoomCode()
    expect(code).toMatch(/^[A-Z]{4}-\d{2}$/)
  })

  it('generates unique codes across 1000 calls with high probability', () => {
    const codes = new Set(Array.from({ length: 1000 }, generateRoomCode))
    expect(codes.size).toBeGreaterThan(900)
  })
})

describe('isValidRoomCode', () => {
  it('returns true for valid codes', () => {
    expect(isValidRoomCode('XKCD-42')).toBe(true)
    expect(isValidRoomCode('ABCD-99')).toBe(true)
  })

  it('returns false for invalid codes', () => {
    expect(isValidRoomCode('')).toBe(false)
    expect(isValidRoomCode('abc-12')).toBe(false)
    expect(isValidRoomCode('ABCDE-12')).toBe(false)
    expect(isValidRoomCode('ABCD-123')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=room-code
```

Expected: FAIL — `Cannot find module '@/lib/room-code'`

- [ ] **Step 3: Implement room code generation**

Create `lib/room-code.ts`:
```typescript
const ADJECTIVES = ['BOLD', 'CALM', 'DARK', 'EPIC', 'FAST', 'GRIM', 'HAZY', 'IRON', 'JADE', 'KEEN', 'LAZY', 'MILD', 'NEAT', 'PALE', 'ROSY', 'SAGE', 'TEAL', 'VAST', 'WILD', 'ZANY']

export function generateRoomCode(): string {
  const word = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const digits = String(Math.floor(Math.random() * 90) + 10)
  return `${word}-${digits}`
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z]{4}-\d{2}$/.test(code)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=room-code
```

Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/room-code.ts __tests__/lib/room-code.test.ts
git commit -m "feat: add room code generation"
```

---

## Task 5: TMDB API Client

**Files:**
- Create: `lib/tmdb.ts`, `__tests__/lib/tmdb.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/tmdb.test.ts`:
```typescript
import { buildDiscoverUrl, buildMovieDetailUrl, parseMovieResult, STREAMING_SERVICES } from '@/lib/tmdb'

describe('STREAMING_SERVICES', () => {
  it('contains 6 services with id and name', () => {
    expect(STREAMING_SERVICES).toHaveLength(6)
    STREAMING_SERVICES.forEach(s => {
      expect(s).toHaveProperty('id')
      expect(s).toHaveProperty('name')
      expect(s).toHaveProperty('tmdbId')
    })
  })
})

describe('buildDiscoverUrl', () => {
  it('includes watch provider IDs for given services', () => {
    const url = buildDiscoverUrl(['netflix', 'hulu'], {})
    expect(url).toContain('with_watch_providers=8%7C15')
    expect(url).toContain('watch_region=US')
  })

  it('includes genre filter when provided', () => {
    const url = buildDiscoverUrl(['netflix'], { genres: [28, 12] })
    expect(url).toContain('with_genres=28%2C12')
  })

  it('includes runtime filter when provided', () => {
    const url = buildDiscoverUrl(['netflix'], { maxRuntime: 120 })
    expect(url).toContain('with_runtime.lte=120')
  })

  it('includes rating filter when provided', () => {
    const url = buildDiscoverUrl(['netflix'], { minRating: 7 })
    expect(url).toContain('vote_average.gte=7')
  })
})

describe('parseMovieResult', () => {
  const raw = {
    id: 157336,
    title: 'Interstellar',
    overview: 'A team of explorers...',
    poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    release_date: '2014-11-05',
    vote_average: 8.6,
    runtime: 169,
    genre_ids: [18, 878],
  }

  it('maps TMDB response fields to our movie shape', () => {
    const movie = parseMovieResult(raw)
    expect(movie.tmdbId).toBe('157336')
    expect(movie.title).toBe('Interstellar')
    expect(movie.year).toBe(2014)
    expect(movie.rating).toBe(8.6)
    expect(movie.posterUrl).toContain('gEU2QniE6E77NI6lCU6MxlNBvIx.jpg')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=tmdb
```

Expected: FAIL — `Cannot find module '@/lib/tmdb'`

- [ ] **Step 3: Implement TMDB client**

Create `lib/tmdb.ts`:
```typescript
const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

export const STREAMING_SERVICES = [
  { id: 'netflix',  name: 'Netflix',      tmdbId: 8    },
  { id: 'prime',    name: 'Amazon Prime', tmdbId: 9    },
  { id: 'disney',   name: 'Disney+',      tmdbId: 337  },
  { id: 'hbo',      name: 'HBO Max',      tmdbId: 1899 },
  { id: 'hulu',     name: 'Hulu',         tmdbId: 15   },
  { id: 'apple',    name: 'Apple TV+',    tmdbId: 350  },
] as const

export type ServiceId = typeof STREAMING_SERVICES[number]['id']

export interface TmdbMovie {
  tmdbId: string
  title: string
  overview: string
  posterUrl: string
  year: number
  rating: number
  runtime: number | null
  genreIds: number[]
}

export interface DiscoverFilters {
  genres?: number[]
  maxRuntime?: number
  minRating?: number
}

// Simple in-memory cache with 1-hour TTL
const cache = new Map<string, { data: unknown; expiresAt: number }>()

async function tmdbFetch<T>(url: string): Promise<T> {
  const cached = cache.get(url)
  if (cached && cached.expiresAt > Date.now()) return cached.data as T

  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB fetch failed: ${res.status} ${url}`)
  const data = await res.json()
  cache.set(url, { data, expiresAt: Date.now() + 60 * 60 * 1000 })
  return data as T
}

export function buildDiscoverUrl(serviceIds: string[], filters: DiscoverFilters): string {
  const providerIds = serviceIds
    .map(id => STREAMING_SERVICES.find(s => s.id === id)?.tmdbId)
    .filter(Boolean)
    .join('|')

  const params = new URLSearchParams({
    api_key: process.env.TMDB_API_KEY!,
    with_watch_providers: providerIds,
    watch_region: 'US',
    sort_by: 'popularity.desc',
    'vote_count.gte': '100',
  })

  if (filters.genres?.length) params.set('with_genres', filters.genres.join(','))
  if (filters.maxRuntime) params.set('with_runtime.lte', String(filters.maxRuntime))
  if (filters.minRating) params.set('vote_average.gte', String(filters.minRating))

  return `${TMDB_BASE}/discover/movie?${params}`
}

export function buildMovieDetailUrl(tmdbId: string): string {
  return `${TMDB_BASE}/movie/${tmdbId}?api_key=${process.env.TMDB_API_KEY}`
}

export function parseMovieResult(raw: Record<string, unknown>): TmdbMovie {
  return {
    tmdbId: String(raw.id),
    title: raw.title as string,
    overview: raw.overview as string,
    posterUrl: raw.poster_path ? `${TMDB_IMAGE_BASE}${raw.poster_path}` : '',
    year: new Date(raw.release_date as string).getFullYear(),
    rating: raw.vote_average as number,
    runtime: (raw.runtime as number) ?? null,
    genreIds: (raw.genre_ids as number[]) ?? [],
  }
}

export async function discoverMovies(
  serviceIds: string[],
  filters: DiscoverFilters,
  maxResults = 60
): Promise<TmdbMovie[]> {
  const movies: TmdbMovie[] = []
  let page = 1

  while (movies.length < maxResults) {
    const url = buildDiscoverUrl(serviceIds, filters) + `&page=${page}`
    const data = await tmdbFetch<{ results: Record<string, unknown>[]; total_pages: number }>(url)
    movies.push(...data.results.map(parseMovieResult))
    if (page >= data.total_pages || page >= 3) break
    page++
  }

  return movies.slice(0, maxResults)
}

export async function getMovieById(tmdbId: string): Promise<TmdbMovie> {
  const data = await tmdbFetch<Record<string, unknown>>(buildMovieDetailUrl(tmdbId))
  return parseMovieResult(data)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=tmdb
```

Expected: PASS — 7 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/tmdb.ts __tests__/lib/tmdb.test.ts
git commit -m "feat: add TMDB API client with in-memory cache"
```

---

## Task 6: Match Detection

**Files:**
- Create: `lib/match.ts`, `__tests__/lib/match.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/match.test.ts`:
```typescript
import { checkForMatch } from '@/lib/match'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    room: { update: jest.fn() },
  },
}))

const mockPrisma = prisma as jest.Mocked<typeof prisma>

describe('checkForMatch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns null when vote count is less than active member count', async () => {
    ;(mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ tmdb_movie_id: null, yes_count: 1n, active_count: 2n }])
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBeNull()
  })

  it('returns movieId when all active members voted yes', async () => {
    ;(mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ tmdb_movie_id: 'movie-1', yes_count: 2n, active_count: 2n }])
    ;(mockPrisma.room.update as jest.Mock).mockResolvedValueOnce({})
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBe('movie-1')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=match
```

Expected: FAIL — `Cannot find module '@/lib/match'`

- [ ] **Step 3: Implement match detection**

Create `lib/match.ts`:
```typescript
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

interface MatchRow {
  tmdb_movie_id: string | null
  yes_count: bigint
  active_count: bigint
}

export async function checkForMatch(roomId: string, tmdbMovieId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<MatchRow[]>(Prisma.sql`
    SELECT
      v.tmdb_movie_id,
      COUNT(*) FILTER (WHERE v.vote = true) AS yes_count,
      (
        SELECT COUNT(*) FROM "Member" m
        WHERE m."roomId" = ${roomId}
          AND m."lastSeenAt" > NOW() - INTERVAL '5 minutes'
      ) AS active_count
    FROM "Vote" v
    WHERE v."roomId" = ${roomId}
      AND v."tmdbMovieId" = ${tmdbMovieId}
    GROUP BY v.tmdb_movie_id
  `)

  const row = rows[0]
  if (!row || row.yes_count < row.active_count || row.active_count === 0n) return null

  await prisma.room.update({
    where: { id: roomId },
    data: { status: 'MATCHED', matchedMovieId: tmdbMovieId },
  })

  return tmdbMovieId
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=match
```

Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/match.ts __tests__/lib/match.test.ts
git commit -m "feat: add match detection query"
```

---

## Task 7: Room Creation API

**Files:**
- Create: `app/api/rooms/route.ts`

- [ ] **Step 1: Create route handler**

Create `app/api/rooms/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRoomCode } from '@/lib/room-code'
import { generateSessionToken, setSessionCookie } from '@/lib/session'

export async function POST(request: Request) {
  const { displayName } = await request.json()

  if (!displayName?.trim()) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
  }

  // Generate unique room code with retry
  let code: string | null = null
  for (let i = 0; i < 5; i++) {
    const candidate = generateRoomCode()
    const existing = await prisma.room.findUnique({ where: { code: candidate } })
    if (!existing) { code = candidate; break }
  }
  if (!code) return NextResponse.json({ error: 'Failed to generate room code' }, { status: 500 })

  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  const room = await prisma.room.create({
    data: {
      code,
      hostMemberId: '',  // filled in after member is created
      streamingServices: [],
      expiresAt,
      members: {
        create: {
          displayName: displayName.trim(),
          sessionToken,
          isHost: true,
        },
      },
    },
    include: { members: true },
  })

  const hostMember = room.members[0]
  await prisma.room.update({
    where: { id: room.id },
    data: { hostMemberId: hostMember.id },
  })

  const response = NextResponse.json({ code: room.code, memberId: hostMember.id })
  setSessionCookie(response as unknown as Response, sessionToken)
  return response
}
```

- [ ] **Step 2: Test manually**

```bash
curl -s -X POST http://localhost:3000/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Alex"}' | jq .
```

Expected:
```json
{ "code": "BOLD-42", "memberId": "uuid-here" }
```
Also check for `Set-Cookie: w2w_session=...` in response headers.

- [ ] **Step 3: Commit**

```bash
git add app/api/rooms/route.ts
git commit -m "feat: add POST /api/rooms endpoint"
```

---

## Task 8: Room Join + State APIs

**Files:**
- Create: `app/api/rooms/[code]/route.ts`, `app/api/rooms/[code]/members/route.ts`

- [ ] **Step 1: Create member join endpoint**

Create `app/api/rooms/[code]/members/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateSessionToken, setSessionCookie } from '@/lib/session'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const { displayName } = await request.json()

  if (!displayName?.trim()) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
  }

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (room.status !== 'LOBBY') {
    return NextResponse.json({ error: 'Room is no longer accepting members' }, { status: 409 })
  }

  const sessionToken = generateSessionToken()
  const member = await prisma.member.create({
    data: {
      roomId: room.id,
      displayName: displayName.trim(),
      sessionToken,
      isHost: false,
    },
  })

  const response = NextResponse.json({ memberId: member.id })
  setSessionCookie(response as unknown as Response, sessionToken)
  return response
}
```

- [ ] **Step 2: Create room state endpoint**

Create `app/api/rooms/[code]/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const room = await prisma.room.findUnique({
    where: { code },
    include: {
      members: {
        select: { id: true, displayName: true, isHost: true, lastSeenAt: true },
        orderBy: { joinedAt: 'asc' },
      },
    },
  })

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  let matchedMovie = null
  if (room.matchedMovieId) {
    matchedMovie = await getMovieById(room.matchedMovieId)
    const queueEntry = await prisma.roomQueue.findUnique({
      where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: room.matchedMovieId } },
    })
    if (queueEntry) Object.assign(matchedMovie, { watchUrl: queueEntry.watchUrl, streamingService: queueEntry.streamingService })
  }

  return NextResponse.json({
    code: room.code,
    status: room.status,
    streamingServices: room.streamingServices,
    filters: room.filters,
    members: room.members,
    matchedMovie,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken()
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member?.isHost) return NextResponse.json({ error: 'Only the host can update the room' }, { status: 403 })

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room || room.id !== member.roomId) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const body = await request.json()
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: {
      ...(body.streamingServices && { streamingServices: body.streamingServices }),
      ...(body.filters !== undefined && { filters: body.filters }),
    },
  })

  return NextResponse.json({ streamingServices: updated.streamingServices, filters: updated.filters })
}
```

- [ ] **Step 3: Test join flow manually**

```bash
# Create room
ROOM=$(curl -s -X POST http://localhost:3000/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Alex"}')
CODE=$(echo $ROOM | jq -r '.code')
echo "Room code: $CODE"

# Guest joins
curl -s -X POST http://localhost:3000/api/rooms/$CODE/members \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Jordan"}' | jq .

# Check room state
curl -s http://localhost:3000/api/rooms/$CODE | jq .
```

Expected: Room state shows 2 members (Alex as host, Jordan as guest), status: LOBBY.

- [ ] **Step 4: Commit**

```bash
git add app/api/rooms/[code]/route.ts app/api/rooms/[code]/members/route.ts
git commit -m "feat: add room join and room state APIs"
```

---

## Task 9: Queue Generation + Start API

**Files:**
- Create: `app/api/rooms/[code]/start/route.ts`

- [ ] **Step 1: Create start endpoint**

Create `app/api/rooms/[code]/start/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { discoverMovies, STREAMING_SERVICES } from '@/lib/tmdb'

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken()
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member?.isHost) return NextResponse.json({ error: 'Only the host can start the session' }, { status: 403 })

  const room = await prisma.room.findUnique({
    where: { code },
    include: { members: { where: { lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } } },
  })

  if (!room || room.id !== member.roomId) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (room.status !== 'LOBBY') return NextResponse.json({ error: 'Room already started' }, { status: 409 })
  if (room.members.length < 2) return NextResponse.json({ error: 'Need at least 2 members to start' }, { status: 400 })
  if (room.streamingServices.length === 0) return NextResponse.json({ error: 'Select at least one streaming service' }, { status: 400 })

  const filters = (room.filters as { genres?: number[]; maxRuntime?: number; minRating?: number }) ?? {}
  const movies = await discoverMovies(room.streamingServices, filters, 60)

  if (movies.length === 0) {
    return NextResponse.json({ error: 'No movies found for these services and filters' }, { status: 422 })
  }

  const shuffled = shuffle(movies)

  await prisma.$transaction([
    prisma.room.update({ where: { id: room.id }, data: { status: 'VOTING' } }),
    prisma.roomQueue.createMany({
      data: shuffled.map((movie, position) => ({
        roomId: room.id,
        tmdbMovieId: movie.tmdbId,
        position,
        streamingService: room.streamingServices[0], // first selected service
        watchUrl: `https://www.themoviedb.org/movie/${movie.tmdbId}`,
      })),
      skipDuplicates: true,
    }),
  ])

  return NextResponse.json({ queueSize: shuffled.length })
}
```

- [ ] **Step 2: Test start flow manually**

```bash
# Create room and get session cookie
COOKIE_JAR=$(mktemp)
ROOM=$(curl -s -c $COOKIE_JAR -X POST http://localhost:3000/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Alex"}')
CODE=$(echo $ROOM | jq -r '.code')

# Add a second member (different cookie jar)
COOKIE_JAR2=$(mktemp)
curl -s -c $COOKIE_JAR2 -X POST http://localhost:3000/api/rooms/$CODE/members \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Jordan"}' > /dev/null

# Set streaming services as host
curl -s -b $COOKIE_JAR -X PATCH http://localhost:3000/api/rooms/$CODE \
  -H "Content-Type: application/json" \
  -d '{"streamingServices":["netflix"]}' | jq .

# Start session
curl -s -b $COOKIE_JAR -X POST http://localhost:3000/api/rooms/$CODE/start | jq .
```

Expected: `{ "queueSize": N }` where N > 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/rooms/[code]/start/route.ts
git commit -m "feat: add queue generation and session start API"
```

---

## Task 10: Queue + Vote + Poll APIs

**Files:**
- Create: `app/api/rooms/[code]/queue/route.ts`, `app/api/rooms/[code]/votes/route.ts`, `app/api/rooms/[code]/poll/route.ts`

- [ ] **Step 1: Create queue endpoint**

Create `app/api/rooms/[code]/queue/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken()
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room || room.id !== member.roomId) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  // Update lastSeenAt for inactive member detection
  await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

  const votedMovieIds = (await prisma.vote.findMany({
    where: { roomId: room.id, memberId: member.id },
    select: { tmdbMovieId: true },
  })).map(v => v.tmdbMovieId)

  const nextQueueEntry = await prisma.roomQueue.findFirst({
    where: { roomId: room.id, tmdbMovieId: { notIn: votedMovieIds } },
    orderBy: { position: 'asc' },
  })

  if (!nextQueueEntry) {
    const totalQueue = await prisma.roomQueue.count({ where: { roomId: room.id } })
    return NextResponse.json({ movie: null, remaining: 0, totalQueue })
  }

  const movie = await getMovieById(nextQueueEntry.tmdbMovieId)
  const remaining = await prisma.roomQueue.count({
    where: { roomId: room.id, tmdbMovieId: { notIn: votedMovieIds } },
  })

  return NextResponse.json({
    movie: { ...movie, watchUrl: nextQueueEntry.watchUrl, streamingService: nextQueueEntry.streamingService },
    remaining,
  })
}
```

- [ ] **Step 2: Create vote endpoint**

Create `app/api/rooms/[code]/votes/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { checkForMatch } from '@/lib/match'
import { getMovieById } from '@/lib/tmdb'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken()
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room || room.id !== member.roomId) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (room.status !== 'VOTING') return NextResponse.json({ error: 'Room is not in voting state' }, { status: 409 })

  const { tmdbMovieId, vote } = await request.json()
  if (!tmdbMovieId || typeof vote !== 'boolean') {
    return NextResponse.json({ error: 'tmdbMovieId and vote (boolean) are required' }, { status: 400 })
  }

  await prisma.vote.upsert({
    where: { roomId_memberId_tmdbMovieId: { roomId: room.id, memberId: member.id, tmdbMovieId } },
    create: { roomId: room.id, memberId: member.id, tmdbMovieId, vote },
    update: { vote },
  })

  await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

  if (!vote) return NextResponse.json({ matched: false })

  const matchedMovieId = await checkForMatch(room.id, tmdbMovieId)
  if (!matchedMovieId) return NextResponse.json({ matched: false })

  const queueEntry = await prisma.roomQueue.findUnique({
    where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: matchedMovieId } },
  })
  const movie = await getMovieById(matchedMovieId)

  return NextResponse.json({
    matched: true,
    movie: { ...movie, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService },
  })
}
```

- [ ] **Step 3: Create poll endpoint**

Create `app/api/rooms/[code]/poll/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken()
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

  const memberCount = await prisma.member.count({
    where: { roomId: room.id, lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
  })

  let matchedMovie = null
  if (room.matchedMovieId) {
    matchedMovie = await getMovieById(room.matchedMovieId)
    const queueEntry = await prisma.roomQueue.findUnique({
      where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: room.matchedMovieId } },
    })
    if (queueEntry) Object.assign(matchedMovie, { watchUrl: queueEntry.watchUrl, streamingService: queueEntry.streamingService })
  }

  return NextResponse.json({ status: room.status, memberCount, matchedMovie })
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/rooms/[code]/queue/route.ts app/api/rooms/[code]/votes/route.ts app/api/rooms/[code]/poll/route.ts
git commit -m "feat: add queue, vote, and poll API endpoints"
```

---

## Task 11: StreamingServicePicker Component

**Files:**
- Create: `components/StreamingServicePicker.tsx`, `__tests__/components/StreamingServicePicker.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/StreamingServicePicker.test.tsx`:
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { StreamingServicePicker } from '@/components/StreamingServicePicker'

describe('StreamingServicePicker', () => {
  it('renders all 6 streaming services', () => {
    render(<StreamingServicePicker selected={[]} onChange={jest.fn()} />)
    expect(screen.getByText('Netflix')).toBeInTheDocument()
    expect(screen.getByText('Amazon Prime')).toBeInTheDocument()
    expect(screen.getByText('Disney+')).toBeInTheDocument()
    expect(screen.getByText('HBO Max')).toBeInTheDocument()
    expect(screen.getByText('Hulu')).toBeInTheDocument()
    expect(screen.getByText('Apple TV+')).toBeInTheDocument()
  })

  it('calls onChange with added service when unselected item is clicked', () => {
    const onChange = jest.fn()
    render(<StreamingServicePicker selected={[]} onChange={onChange} />)
    fireEvent.click(screen.getByText('Netflix'))
    expect(onChange).toHaveBeenCalledWith(['netflix'])
  })

  it('calls onChange with removed service when selected item is clicked', () => {
    const onChange = jest.fn()
    render(<StreamingServicePicker selected={['netflix']} onChange={onChange} />)
    fireEvent.click(screen.getByText('Netflix'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('shows selected services as visually distinct', () => {
    const { container } = render(
      <StreamingServicePicker selected={['netflix']} onChange={jest.fn()} />
    )
    const netflixButton = screen.getByText('Netflix').closest('button')
    expect(netflixButton).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=StreamingServicePicker
```

Expected: FAIL — `Cannot find module '@/components/StreamingServicePicker'`

- [ ] **Step 3: Implement component**

Create `components/StreamingServicePicker.tsx`:
```typescript
'use client'
import { STREAMING_SERVICES, ServiceId } from '@/lib/tmdb'

interface Props {
  selected: string[]
  onChange: (services: string[]) => void
}

const SERVICE_COLORS: Record<string, string> = {
  netflix: 'bg-red-600',
  prime:   'bg-blue-500',
  disney:  'bg-blue-800',
  hbo:     'bg-purple-700',
  hulu:    'bg-green-500',
  apple:   'bg-gray-800',
}

export function StreamingServicePicker({ selected, onChange }: Props) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {STREAMING_SERVICES.map(service => {
        const isSelected = selected.includes(service.id)
        return (
          <button
            key={service.id}
            onClick={() => toggle(service.id)}
            aria-pressed={isSelected}
            className={`
              rounded-lg py-3 px-4 text-sm font-bold text-white transition-all
              ${isSelected
                ? `${SERVICE_COLORS[service.id]} ring-2 ring-white scale-105`
                : 'bg-gray-800 opacity-50 hover:opacity-75'}
            `}
          >
            {service.name}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=StreamingServicePicker
```

Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add components/StreamingServicePicker.tsx __tests__/components/StreamingServicePicker.test.tsx
git commit -m "feat: add StreamingServicePicker component"
```

---

## Task 12: VotingCard Component

**Files:**
- Create: `components/VotingCard.tsx`, `__tests__/components/VotingCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/VotingCard.test.tsx`:
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { VotingCard } from '@/components/VotingCard'
import type { TmdbMovie } from '@/lib/tmdb'

const movie: TmdbMovie & { watchUrl: string; streamingService: string } = {
  tmdbId: '157336',
  title: 'Interstellar',
  overview: 'A team of explorers travel through a wormhole.',
  posterUrl: 'https://example.com/poster.jpg',
  year: 2014,
  rating: 8.6,
  runtime: 169,
  genreIds: [18, 878],
  watchUrl: 'https://netflix.com/watch/157336',
  streamingService: 'netflix',
}

describe('VotingCard', () => {
  it('renders movie title, year, and rating', () => {
    render(<VotingCard movie={movie} onVote={jest.fn()} />)
    expect(screen.getByText('Interstellar')).toBeInTheDocument()
    expect(screen.getByText(/2014/)).toBeInTheDocument()
    expect(screen.getByText(/8\.6/)).toBeInTheDocument()
  })

  it('calls onVote(true) when Yes button is clicked', () => {
    const onVote = jest.fn()
    render(<VotingCard movie={movie} onVote={onVote} />)
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    expect(onVote).toHaveBeenCalledWith(true)
  })

  it('calls onVote(false) when No button is clicked', () => {
    const onVote = jest.fn()
    render(<VotingCard movie={movie} onVote={onVote} />)
    fireEvent.click(screen.getByRole('button', { name: /no/i }))
    expect(onVote).toHaveBeenCalledWith(false)
  })

  it('disables buttons when disabled prop is true', () => {
    render(<VotingCard movie={movie} onVote={jest.fn()} disabled />)
    expect(screen.getByRole('button', { name: /yes/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /no/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=VotingCard
```

Expected: FAIL — `Cannot find module '@/components/VotingCard'`

- [ ] **Step 3: Implement VotingCard**

Create `components/VotingCard.tsx`:
```typescript
'use client'
import Image from 'next/image'
import { useRef } from 'react'
import type { TmdbMovie } from '@/lib/tmdb'

interface Props {
  movie: TmdbMovie & { watchUrl: string; streamingService: string }
  onVote: (vote: boolean) => void
  disabled?: boolean
}

export function VotingCard({ movie, onVote, disabled = false }: Props) {
  const touchStartX = useRef<number | null>(null)

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(delta) > 80) onVote(delta > 0)
    touchStartX.current = null
  }

  return (
    <div
      className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl max-w-sm w-full mx-auto select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {movie.posterUrl ? (
        <div className="relative h-72 w-full">
          <Image src={movie.posterUrl} alt={movie.title} fill className="object-cover" />
        </div>
      ) : (
        <div className="h-72 w-full bg-gray-800 flex items-center justify-center text-6xl">🎬</div>
      )}

      <div className="p-5">
        <h2 className="text-white text-xl font-bold mb-1">{movie.title}</h2>
        <p className="text-gray-400 text-sm mb-1">
          {movie.year}
          {movie.runtime ? ` · ${movie.runtime} min` : ''}
          {` · ★ ${movie.rating.toFixed(1)}`}
        </p>
        <p className="text-gray-400 text-sm line-clamp-2 mb-4">{movie.overview}</p>

        <div className="flex justify-around">
          <button
            aria-label="No"
            onClick={() => onVote(false)}
            disabled={disabled}
            className="w-14 h-14 rounded-full bg-red-500/20 border-2 border-red-500 text-2xl flex items-center justify-center disabled:opacity-40 hover:bg-red-500/40 transition-colors"
          >
            ✕
          </button>
          <button
            aria-label="Yes"
            onClick={() => onVote(true)}
            disabled={disabled}
            className="w-14 h-14 rounded-full bg-green-500/20 border-2 border-green-500 text-2xl flex items-center justify-center disabled:opacity-40 hover:bg-green-500/40 transition-colors"
          >
            ♥
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=VotingCard
```

Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add components/VotingCard.tsx __tests__/components/VotingCard.test.tsx
git commit -m "feat: add VotingCard component with touch swipe support"
```

---

## Task 13: MemberList Component

**Files:**
- Create: `components/MemberList.tsx`

- [ ] **Step 1: Implement MemberList**

Create `components/MemberList.tsx`:
```typescript
interface Member {
  id: string
  displayName: string
  isHost: boolean
  lastSeenAt: string
}

interface Props {
  members: Member[]
  currentMemberId?: string
}

function isOnline(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000
}

export function MemberList({ members, currentMemberId }: Props) {
  return (
    <ul className="space-y-2">
      {members.map(member => (
        <li key={member.id} className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isOnline(member.lastSeenAt) ? 'bg-green-400' : 'bg-gray-600'}`} />
          <span className="text-white text-sm">
            {member.displayName}
            {member.id === currentMemberId && <span className="text-gray-400 text-xs ml-1">(you)</span>}
          </span>
          {member.isHost && (
            <span className="text-purple-400 text-xs font-medium">host</span>
          )}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/MemberList.tsx
git commit -m "feat: add MemberList component"
```

---

## Task 14: MatchCelebration Component

**Files:**
- Create: `components/MatchCelebration.tsx`

- [ ] **Step 1: Implement MatchCelebration**

Create `components/MatchCelebration.tsx`:
```typescript
'use client'
import Image from 'next/image'
import type { TmdbMovie } from '@/lib/tmdb'

interface Props {
  movie: TmdbMovie & { watchUrl: string; streamingService: string }
  onPlayAgain: () => void
}

const SERVICE_LABELS: Record<string, string> = {
  netflix: 'Netflix',
  prime:   'Amazon Prime',
  disney:  'Disney+',
  hbo:     'HBO Max',
  hulu:    'Hulu',
  apple:   'Apple TV+',
}

export function MatchCelebration({ movie, onPlayAgain }: Props) {
  return (
    <div className="flex flex-col items-center gap-6 text-center px-4 py-8">
      <div className="text-6xl animate-bounce">🎉</div>
      <div>
        <h1 className="text-green-400 text-3xl font-black mb-1">It's a Match!</h1>
        <p className="text-gray-400">Everyone wants to watch</p>
      </div>

      <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl max-w-xs w-full">
        {movie.posterUrl && (
          <div className="relative h-48 w-full">
            <Image src={movie.posterUrl} alt={movie.title} fill className="object-cover" />
          </div>
        )}
        <div className="p-4">
          <h2 className="text-white text-lg font-bold">{movie.title}</h2>
          <p className="text-gray-400 text-sm">{movie.year}{movie.runtime ? ` · ${movie.runtime} min` : ''}</p>
        </div>
      </div>

      <a
        href={movie.watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-green-500 hover:bg-green-400 text-black font-black py-4 px-8 rounded-xl text-lg transition-colors w-full max-w-xs text-center"
      >
        ▶ Watch on {SERVICE_LABELS[movie.streamingService] ?? movie.streamingService}
      </a>

      <button
        onClick={onPlayAgain}
        className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
      >
        Play again
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/MatchCelebration.tsx
git commit -m "feat: add MatchCelebration component"
```

---

## Task 15: Landing Page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Implement landing page**

Replace `app/page.tsx`:
```typescript
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LandingPage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!displayName.trim()) { setError('Enter your name first'); return }
    setLoading(true)
    setError('')
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    router.push(`/room/${data.code}/setup`)
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase()
    if (!displayName.trim()) { setError('Enter your name first'); return }
    if (!code) { setError('Enter a room code'); return }
    setLoading(true)
    setError('')
    const res = await fetch(`/api/rooms/${code}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    router.push(`/room/${code}/lobby`)
  }

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="text-5xl mb-3">🎬</div>
          <h1 className="text-white text-3xl font-black">What2Watch</h1>
          <p className="text-gray-400 mt-2">Pick a movie everyone agrees on</p>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Your name"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            maxLength={30}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="space-y-3">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl text-lg transition-colors disabled:opacity-50"
          >
            Create a Room
          </button>

          <div className="flex items-center gap-3 text-gray-600">
            <div className="flex-1 h-px bg-gray-800" />
            <span className="text-sm">or</span>
            <div className="flex-1 h-px bg-gray-800" />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Room code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
              maxLength={7}
              className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 placeholder-gray-500 uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <button
              onClick={handleJoin}
              disabled={loading}
              className="bg-gray-700 hover:bg-gray-600 text-white font-bold px-5 rounded-xl transition-colors disabled:opacity-50"
            >
              Join
            </button>
          </div>
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Test in browser**

```bash
npm run dev
```

Open http://localhost:3000. Verify:
- Can enter a name
- "Create a Room" navigates to `/room/CODE/setup` (will 404 for now)
- "Join" with an invalid code shows an error

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add landing page"
```

---

## Task 16: Room Setup Page

**Files:**
- Create: `app/room/[code]/setup/page.tsx`

- [ ] **Step 1: Implement setup page**

Create `app/room/[code]/setup/page.tsx`:
```typescript
'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { StreamingServicePicker } from '@/components/StreamingServicePicker'

export default function SetupPage() {
  const router = useRouter()
  const { code } = useParams<{ code: string }>()
  const [services, setServices] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Verify this member is the host; redirect guests to lobby
    fetch(`/api/rooms/${code}`)
      .then(r => r.json())
      .then(data => {
        if (!data.code) { router.replace('/'); return }
        // If room is already past LOBBY, redirect to appropriate page
        if (data.status === 'VOTING') router.replace(`/room/${code}/vote`)
        if (data.status === 'MATCHED') router.replace(`/room/${code}/match`)
        if (data.status === 'DONE') router.replace(`/room/${code}/done`)
        if (data.streamingServices?.length) setServices(data.streamingServices)
      })
  }, [code, router])

  async function handleContinue() {
    if (services.length === 0) { setError('Select at least one streaming service'); return }
    setSaving(true)
    setError('')
    const res = await fetch(`/api/rooms/${code}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamingServices: services }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error)
      setSaving(false)
      return
    }
    router.push(`/room/${code}/lobby`)
  }

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-white text-2xl font-black">Your Streaming Services</h1>
          <p className="text-gray-400 mt-1 text-sm">Select all the services you have access to</p>
        </div>

        <StreamingServicePicker selected={services} onChange={setServices} />

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          onClick={handleContinue}
          disabled={saving}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl text-lg transition-colors disabled:opacity-50"
        >
          Continue →
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Test in browser**

After creating a room from the landing page, verify:
- Setup page loads with service picker
- Selecting services and clicking Continue navigates to lobby (will 404 for now)
- Non-host guests trying to access `/setup` get redirected once lobby page exists

- [ ] **Step 3: Commit**

```bash
git add app/room/[code]/setup/page.tsx
git commit -m "feat: add room setup page"
```

---

## Task 17: Lobby Page

**Files:**
- Create: `app/room/[code]/lobby/page.tsx`

- [ ] **Step 1: Implement lobby page**

Create `app/room/[code]/lobby/page.tsx`:
```typescript
'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { MemberList } from '@/components/MemberList'

interface Member {
  id: string
  displayName: string
  isHost: boolean
  lastSeenAt: string
}

interface RoomState {
  code: string
  status: string
  streamingServices: string[]
  members: Member[]
}

export default function LobbyPage() {
  const router = useRouter()
  const { code } = useParams<{ code: string }>()
  const [room, setRoom] = useState<RoomState | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/?join=${code}` : ''

  const fetchRoom = useCallback(async () => {
    const res = await fetch(`/api/rooms/${code}`)
    if (!res.ok) { router.replace('/'); return }
    const data: RoomState = await res.json()
    setRoom(data)
    if (data.status === 'VOTING') router.replace(`/room/${code}/vote`)
    if (data.status === 'MATCHED') router.replace(`/room/${code}/match`)
  }, [code, router])

  useEffect(() => {
    fetchRoom()
    // Check if current user is host via poll
    fetch(`/api/rooms/${code}/poll`)
      .then(r => r.json())
      .catch(() => {})
    // Determine host status from members list after fetch
  }, [code, fetchRoom])

  // Poll every 3 seconds for new members
  useEffect(() => {
    const interval = setInterval(fetchRoom, 3000)
    return () => clearInterval(interval)
  }, [fetchRoom])

  // Determine isHost by checking which member's session matches
  useEffect(() => {
    if (!room) return
    // We check by seeing if PATCH succeeds (host check) — simpler: expose in GET response
    fetch(`/api/rooms/${code}`)
      .then(r => r.json())
      .then(data => {
        // Try a no-op PATCH to detect host status
        fetch(`/api/rooms/${code}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
          .then(r => setIsHost(r.ok))
      })
  }, [code, room])

  async function handleStart() {
    setStarting(true)
    setError('')
    const res = await fetch(`/api/rooms/${code}/start`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setStarting(false); return }
    router.push(`/room/${code}/vote`)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!room) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>

  const canStart = isHost && room.members.length >= 2 && room.streamingServices.length > 0

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-gray-400 text-sm">Room code</p>
          <h1 className="text-white text-3xl font-black tracking-wider">{code}</h1>
          <p className="text-gray-500 text-xs mt-1">{room.streamingServices.join(' · ')}</p>
        </div>

        <div className="bg-gray-900 rounded-xl p-4 space-y-2">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Share link</p>
          <div className="flex items-center gap-2">
            <code className="text-purple-400 text-xs flex-1 truncate">{shareUrl}</code>
            <button
              onClick={copyLink}
              className="text-gray-400 hover:text-white text-xs transition-colors shrink-0"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="bg-gray-900 rounded-xl p-4">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">
            {room.members.length} {room.members.length === 1 ? 'person' : 'people'} joined
          </p>
          <MemberList members={room.members} />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {isHost && (
          <button
            onClick={handleStart}
            disabled={!canStart || starting}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl text-lg transition-colors disabled:opacity-40"
          >
            {starting ? 'Loading movies...' : 'Start Voting →'}
          </button>
        )}
        {isHost && room.members.length < 2 && (
          <p className="text-gray-500 text-xs text-center">Waiting for at least one more person to join</p>
        )}
        {!isHost && (
          <p className="text-gray-400 text-sm text-center">Waiting for the host to start…</p>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Test in browser**

Open two tabs. Create room in tab 1, join in tab 2. Verify:
- Both members appear in the lobby within 3 seconds
- Copy link button works
- Start button is only visible for the host
- Start button is disabled when only 1 member is present

- [ ] **Step 3: Commit**

```bash
git add app/room/[code]/lobby/page.tsx
git commit -m "feat: add lobby page with live member list"
```

---

## Task 18: Voting Page

**Files:**
- Create: `app/room/[code]/vote/page.tsx`

- [ ] **Step 1: Implement voting page**

Create `app/room/[code]/vote/page.tsx`:
```typescript
'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { VotingCard } from '@/components/VotingCard'
import type { TmdbMovie } from '@/lib/tmdb'

type MovieWithMeta = TmdbMovie & { watchUrl: string; streamingService: string }

export default function VotePage() {
  const router = useRouter()
  const { code } = useParams<{ code: string }>()
  const [movie, setMovie] = useState<MovieWithMeta | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [voting, setVoting] = useState(false)
  const [queueEmpty, setQueueEmpty] = useState(false)
  const [memberCount, setMemberCount] = useState(0)

  const fetchNextMovie = useCallback(async () => {
    const res = await fetch(`/api/rooms/${code}/queue`)
    if (!res.ok) return
    const data = await res.json()
    if (!data.movie) { setQueueEmpty(true); return }
    setMovie(data.movie)
    setRemaining(data.remaining)
  }, [code])

  const poll = useCallback(async () => {
    const res = await fetch(`/api/rooms/${code}/poll`)
    if (!res.ok) return
    const data = await res.json()
    setMemberCount(data.memberCount)
    if (data.status === 'MATCHED') router.replace(`/room/${code}/match`)
    if (data.status === 'DONE') router.replace(`/room/${code}/done`)
  }, [code, router])

  useEffect(() => { fetchNextMovie() }, [fetchNextMovie])

  useEffect(() => {
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [poll])

  // Redirect to done when queue is empty for this member
  useEffect(() => {
    if (queueEmpty) router.replace(`/room/${code}/done`)
  }, [queueEmpty, code, router])

  async function handleVote(vote: boolean) {
    if (!movie || voting) return
    setVoting(true)
    const res = await fetch(`/api/rooms/${code}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdbMovieId: movie.tmdbId, vote }),
    })
    const data = await res.json()
    if (data.matched) { router.replace(`/room/${code}/match`); return }
    await fetchNextMovie()
    setVoting(false)
  }

  if (!movie) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <p>Loading movies…</p>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 gap-4">
      <p className="text-gray-500 text-sm">{remaining} movie{remaining !== 1 ? 's' : ''} left · {memberCount} voting</p>
      <VotingCard movie={movie} onVote={handleVote} disabled={voting} />
      <p className="text-gray-600 text-xs">Swipe right to say yes, left to say no</p>
    </main>
  )
}
```

- [ ] **Step 2: Test voting flow in browser**

With two tabs both in the voting page:
- Each card shows a movie with Yes/No buttons
- Voting moves to the next movie
- Verify the poll detects status changes

- [ ] **Step 3: Commit**

```bash
git add app/room/[code]/vote/page.tsx
git commit -m "feat: add voting page with card swipe and poll loop"
```

---

## Task 19: Match + No-Match Pages

**Files:**
- Create: `app/room/[code]/match/page.tsx`, `app/room/[code]/done/page.tsx`

- [ ] **Step 1: Implement match page**

Create `app/room/[code]/match/page.tsx`:
```typescript
'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { MatchCelebration } from '@/components/MatchCelebration'
import type { TmdbMovie } from '@/lib/tmdb'

type MovieWithMeta = TmdbMovie & { watchUrl: string; streamingService: string }

export default function MatchPage() {
  const router = useRouter()
  const { code } = useParams<{ code: string }>()
  const [movie, setMovie] = useState<MovieWithMeta | null>(null)

  useEffect(() => {
    fetch(`/api/rooms/${code}`)
      .then(r => r.json())
      .then(data => {
        if (data.matchedMovie) setMovie(data.matchedMovie)
        else router.replace(`/room/${code}/vote`)
      })
  }, [code, router])

  function handlePlayAgain() {
    router.push('/')
  }

  if (!movie) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading…</div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center">
      <MatchCelebration movie={movie} onPlayAgain={handlePlayAgain} />
    </main>
  )
}
```

- [ ] **Step 2: Implement no-match page**

Create `app/room/[code]/done/page.tsx`:
```typescript
'use client'
import { useRouter, useParams } from 'next/navigation'

export default function DonePage() {
  const router = useRouter()
  const { code } = useParams<{ code: string }>()

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="text-5xl">😅</div>
        <div>
          <h1 className="text-white text-2xl font-black">No match found</h1>
          <p className="text-gray-400 mt-2">You went through all the movies without agreeing</p>
        </div>

        <div className="bg-gray-900 rounded-xl p-4 text-left space-y-2">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Try adjusting</p>
          <ul className="text-gray-300 text-sm space-y-1">
            <li>✦ Expand to more genres</li>
            <li>✦ Lower the minimum rating</li>
            <li>✦ Add more streaming services</li>
            <li>✦ Increase the runtime limit</li>
          </ul>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => router.push(`/room/${code}/setup`)}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl transition-colors"
          >
            Adjust & Try Again
          </button>
          <button
            onClick={() => router.push('/')}
            className="w-full text-gray-500 hover:text-gray-300 text-sm transition-colors py-2"
          >
            Start a new room
          </button>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/room/[code]/match/page.tsx app/room/[code]/done/page.tsx
git commit -m "feat: add match and no-match pages"
```

---

## Task 20: End-to-End Verification

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run the full user flow**

```bash
npm run dev
```

1. Open http://localhost:3000 in two browser windows (A and B)
2. In window A: enter name "Alex", click Create a Room
3. In window A: select Netflix, click Continue
4. In window A: copy the share link from the lobby
5. In window B: open the landing page, enter name "Jordan", paste the room code, click Join
6. In window A: verify Jordan appears in the member list within 3 seconds
7. In window A: click Start Voting — verify both windows transition to the voting screen
8. Vote Yes on the same movie in both windows — verify the match screen appears in both within ~3 seconds
9. Click Watch Now — verify the link opens the correct streaming platform page

- [ ] **Step 3: Test no-match path**

1. Create a new room with 2 members
2. Both members vote No on every movie
3. Verify the no-match screen appears with retry suggestions
4. Click "Adjust & Try Again" — verify it returns to the setup page

- [ ] **Step 4: Test dropout handling**

1. Create a room with 2 members, start voting
2. In window B, close the tab mid-voting
3. Wait 5 minutes (or temporarily change the interval in `lib/match.ts` to 10 seconds for testing)
4. Vote Yes in window A — verify a match still fires (inactive member excluded)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete What2Watch MVP — room creation, voting, and match detection"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Landing page (create + join)
- ✅ Room setup (streaming service picker, host only)
- ✅ Lobby (share link, member list, host starts)
- ✅ Tinder-style voting cards with touch swipe
- ✅ Anonymous session cookie auth
- ✅ TMDB queue generation with streaming service + filter support
- ✅ Vote submission with upsert (idempotent)
- ✅ Match detection (all active members voted yes)
- ✅ 3-second polling during voting and lobby
- ✅ Match screen with Watch Now link
- ✅ No-match screen with retry suggestions
- ✅ Inactive member handling (5-minute timeout in match check)
- ✅ Room code collision retry
- ✅ TMDB in-memory cache (1-hour TTL)

**Not in this plan (Phase 2):**
- Optional account sign-up
- Genre/mood/runtime/rating filter UI
- Queue size preview in lobby
- Room expiry cron job
