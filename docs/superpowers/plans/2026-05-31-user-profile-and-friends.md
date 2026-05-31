# User Profile & Friend Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Workflow note (this repo):** This project runs the Backpressure protocol (AGENTS.md). This plan document was written during RESEARCH. Before implementing, advance to PLAN, write the file list to `.workflow_plan_files`, then advance to IMPLEMENT. The Prisma migration (Task 1) is a **restricted action** — STOP and get explicit user approval before running it.

**Goal:** Give signed-in users a profile hub with a watch list, seen-before list, and friends system, plus a friend-comparison page showing shared watch lists and shared "Yes" movies from past sessions together.

**Architecture:** Three new Prisma models (`Friendship`, `UserMoviePreference`, `MovieCache`) layered on the existing `User`/`Room`/`Member`/`Vote`/`WatchedMovie` schema. **Session and vote history already exist** via `Member.userId` + `Vote` + `WatchedMovie` — we reuse them rather than adding redundant tables. All business logic goes in testable `lib/` functions (mocked-Prisma unit tests, matching `lib/queue.ts`); route handlers stay thin and call those functions. The watch list is populated by hooking the existing vote/watched routes: a "Yes" vote creates a `WATCHLIST` preference, "Already seen it" creates a `SEEN_BEFORE` preference — but only for members linked to a signed-in `User`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma 6 (PostgreSQL via `@prisma/adapter-pg`), NextAuth 5 (JWT sessions, `auth()`), TailwindCSS, Jest + ts-jest + Testing Library.

---

## Design Decisions & Spec Reconciliation

Read this before starting — it explains where the raw spec was adjusted.

1. **No new vote-history / session-member tables.** The spec lists "vote history" (`roomId, userId, movieId, vote`) and "session/member history" (`roomId, userId, joinedAt`) under Data Changes. These already exist:
   - `Vote { roomId, memberId, tmdbMovieId, vote, votedAt }` + `Member { roomId, userId, joinedAt }` → join `Vote → Member` on `memberId`, filter `Member.userId`, and you have per-user vote history scoped to a room.
   - "Previous sessions together" = rooms that have a `Member` for both users.
   - "Shared Yes in a session" = movies with `vote=true` votes from both users' members in that room.
   Adding parallel tables would duplicate this and require a second write path on every vote. **YAGNI — we query existing tables.**

2. **`UserMoviePreference` IS added.** The watch list / seen-before list need (a) user-owned rows that survive across rooms, (b) independent removal ("remove from list" must not delete a `Vote`), and (c) dedupe across sessions. A denormalized per-user table gives all three cleanly. Populated by hooking the vote/watched routes.

3. **`MovieCache` IS added.** TMDB metadata is currently only in a per-process in-memory cache (`lib/tmdb.ts`), lost on restart. Profile/friend lists render many movies and need a persistent fallback for the "movie deleted/unavailable → show fallback metadata" edge case. We cache `title/posterUrl/year/overview/rating`. Streaming providers are room-specific (`RoomQueue.streamingService`) and **out of scope** for the cache (spec says "if available" — deferred).

4. **The watch-list hook needs an identity bridge.** Room members use the `w2w_session` cookie; the signed-in user comes from `auth()`. A member created by `/api/rooms/[code]/members` has `userId = null` even for a signed-in user (linking only happens best-effort on the landing page). So `lib/link.ts` resolves/links the member's `userId` at vote time via `auth()`, guaranteeing "Voting Yes adds to watch list" works for signed-in users. Anonymous (not-signed-in) members never get preferences written → satisfies "Private/anonymous room participants should not expose data unless signed in."

5. **Access control** for friend pages is enforced server-side in the route handlers via `areFriends(me, friendId)` (403 otherwise) and in page server components via `auth()` + `redirect('/auth/signin')`. Unfriending deletes the `Friendship` row, so `areFriends` returns false → access removed.

---

## File Structure

**New Prisma models** (modify `prisma/schema.prisma`): `Friendship`, `UserMoviePreference`, `MovieCache`, enums `FriendshipStatus`, `MoviePreferenceType`, plus relation fields on `User`.

**New lib modules** (one responsibility each):
- `lib/preferences.ts` — add/remove/list `UserMoviePreference` rows.
- `lib/friends.ts` — friendship CRUD + comparison queries + `FriendError`.
- `lib/movie-cache.ts` — `getCachedMovie` / `getCachedMovies` with TMDB fallback.
- `lib/link.ts` — `resolveMemberUserId` (bridge room member → auth user).

**New API routes:**
- `app/api/user/movies/route.ts` — GET (list watchlist|seen_before) + DELETE (remove one).
- `app/api/user/preferences/route.ts` — **modify**: add PUT (save services/displayName).
- `app/api/users/search/route.ts` — GET user search.
- `app/api/friends/route.ts` — GET friends + incoming + outgoing.
- `app/api/friends/requests/route.ts` — POST send request.
- `app/api/friends/requests/[id]/route.ts` — PATCH accept/decline.
- `app/api/friends/[friendId]/route.ts` — GET detail + DELETE unfriend.
- `app/api/friends/[friendId]/sessions/[roomId]/route.ts` — GET shared-yes movies.

**Modified routes (hooks):** `app/api/rooms/[code]/votes/route.ts`, `app/api/rooms/[code]/watched/route.ts`.

**New pages (server-guarded):**
- `app/profile/page.tsx`, `app/profile/settings/page.tsx`, `app/profile/watchlist/page.tsx`, `app/profile/seen/page.tsx`
- `app/profile/friends/page.tsx`, `app/profile/friends/[friendId]/page.tsx`, `app/profile/friends/[friendId]/sessions/[roomId]/page.tsx`

**New components:** `components/MovieListClient.tsx`, `components/FriendsClient.tsx`, `components/FriendDetailClient.tsx`, `components/SharedSessionClient.tsx`, `components/ProfileGuard.tsx` (shared server guard helper). **Modify** `components/AuthStatus.tsx` (add Profile link).

**Testing convention note:** This codebase unit-tests `lib/` (mocked `@/lib/prisma`) and components (RTL), but does **not** test route handlers. We follow that: every `lib/` function is TDD'd; routes are thin pass-throughs verified by `typecheck`/`lint`; one client component gets an RTL test.

---

## Phase A — Data Layer

### Task 1: Add Prisma models for friendships, preferences, and movie cache

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the two enums** at the top of `prisma/schema.prisma`, immediately after the existing `enum RoomStatus { ... }` block.

```prisma
enum FriendshipStatus {
  PENDING
  ACCEPTED
  DECLINED
}

enum MoviePreferenceType {
  WATCHLIST
  SEEN_BEFORE
}
```

- [ ] **Step 2: Add relation fields to the `User` model.** Insert these three lines just before the closing `}` of `model User`, after the existing `accounts Account[]` line.

```prisma
  friendRequestsSent     Friendship[]          @relation("FriendRequestsSent")
  friendRequestsReceived Friendship[]          @relation("FriendRequestsReceived")
  moviePreferences       UserMoviePreference[]
```

- [ ] **Step 3: Append the three new models** at the end of `prisma/schema.prisma`.

```prisma
model Friendship {
  id          String           @id @default(uuid())
  requesterId String
  receiverId  String
  status      FriendshipStatus @default(PENDING)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  requester   User             @relation("FriendRequestsSent", fields: [requesterId], references: [id], onDelete: Cascade)
  receiver    User             @relation("FriendRequestsReceived", fields: [receiverId], references: [id], onDelete: Cascade)

  @@unique([requesterId, receiverId])
  @@index([receiverId])
  @@index([requesterId])
}

model UserMoviePreference {
  id           String              @id @default(uuid())
  userId       String
  tmdbMovieId  String
  type         MoviePreferenceType
  sourceRoomId String?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  user         User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, tmdbMovieId, type])
  @@index([userId, type])
}

model MovieCache {
  tmdbMovieId String   @id
  title       String
  posterUrl   String
  year        Int
  overview    String
  rating      Float
  updatedAt   DateTime @updatedAt
}
```

- [ ] **Step 4: Validate and format the schema** (these Prisma commands are safe and pre-approved — they do NOT touch the database).

Run: `npx prisma validate && npx prisma format`
Expected: `The schema at prisma/schema.prisma is valid 🚀` and a formatted file with no diff errors.

- [ ] **Step 5: ⛔ STOP — request approval for the migration.** Creating/running a migration is a restricted action in this repo. Present this command to the user and wait for explicit approval before running it:

```bash
npx prisma migrate dev --name add_profile_friends
```

Expected after approval: a new directory `prisma/migrations/<timestamp>_add_profile_friends/migration.sql` and `Prisma Client` regenerated. (Per the project's drift-recovery memory: the generated migration SQL may trip `.workflow_drift` — if so, the user runs the drift-to-plan step in their terminal.)

- [ ] **Step 6: Commit** (after the migration is approved and applied).

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add Friendship, UserMoviePreference, MovieCache models"
```

---

## Phase B — Library Logic (TDD)

### Task 2: `lib/preferences.ts` — watch-list / seen-before storage

**Files:**
- Create: `lib/preferences.ts`
- Test: `__tests__/lib/preferences.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
// __tests__/lib/preferences.test.ts
import { addPreference, removePreference, listPreferences } from '@/lib/preferences'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    userMoviePreference: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

const upsert = prisma.userMoviePreference.upsert as jest.Mock
const deleteMany = prisma.userMoviePreference.deleteMany as jest.Mock
const findMany = prisma.userMoviePreference.findMany as jest.Mock

describe('preferences', () => {
  beforeEach(() => jest.clearAllMocks())

  it('addPreference upserts on the (userId, tmdbMovieId, type) unique key', async () => {
    upsert.mockResolvedValueOnce({})
    await addPreference('user-1', '603', 'WATCHLIST', 'room-1')
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_tmdbMovieId_type: { userId: 'user-1', tmdbMovieId: '603', type: 'WATCHLIST' } },
      create: { userId: 'user-1', tmdbMovieId: '603', type: 'WATCHLIST', sourceRoomId: 'room-1' },
      update: {},
    })
  })

  it('addPreference allows a null sourceRoomId', async () => {
    upsert.mockResolvedValueOnce({})
    await addPreference('user-1', '603', 'SEEN_BEFORE')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ sourceRoomId: null }) })
    )
  })

  it('removePreference deletes the matching row', async () => {
    deleteMany.mockResolvedValueOnce({ count: 1 })
    await removePreference('user-1', '603', 'WATCHLIST')
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', tmdbMovieId: '603', type: 'WATCHLIST' },
    })
  })

  it('listPreferences returns rows ordered by createdAt desc', async () => {
    findMany.mockResolvedValueOnce([{ tmdbMovieId: '603' }])
    const rows = await listPreferences('user-1', 'WATCHLIST')
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'WATCHLIST' },
      orderBy: { createdAt: 'desc' },
    })
    expect(rows).toEqual([{ tmdbMovieId: '603' }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm test -- preferences`
Expected: FAIL — `Cannot find module '@/lib/preferences'`.

- [ ] **Step 3: Write the implementation.**

```typescript
// lib/preferences.ts
import { prisma } from '@/lib/prisma'
import type { MoviePreferenceType, UserMoviePreference } from '@prisma/client'

export async function addPreference(
  userId: string,
  tmdbMovieId: string,
  type: MoviePreferenceType,
  sourceRoomId: string | null = null
): Promise<void> {
  await prisma.userMoviePreference.upsert({
    where: { userId_tmdbMovieId_type: { userId, tmdbMovieId, type } },
    create: { userId, tmdbMovieId, type, sourceRoomId },
    update: {},
  })
}

export async function removePreference(
  userId: string,
  tmdbMovieId: string,
  type: MoviePreferenceType
): Promise<void> {
  await prisma.userMoviePreference.deleteMany({
    where: { userId, tmdbMovieId, type },
  })
}

export async function listPreferences(
  userId: string,
  type: MoviePreferenceType
): Promise<UserMoviePreference[]> {
  return prisma.userMoviePreference.findMany({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  })
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm test -- preferences`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/preferences.ts __tests__/lib/preferences.test.ts
git commit -m "feat(lib): add user movie preference storage"
```

---

### Task 3: `lib/movie-cache.ts` — persistent TMDB metadata with fallback

**Files:**
- Create: `lib/movie-cache.ts`
- Test: `__tests__/lib/movie-cache.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
// __tests__/lib/movie-cache.test.ts
import { getCachedMovie, getCachedMovies } from '@/lib/movie-cache'
import { prisma } from '@/lib/prisma'
import { getMovieById } from '@/lib/tmdb'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    movieCache: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
  },
}))
jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn() }))

const findUnique = prisma.movieCache.findUnique as jest.Mock
const findMany = prisma.movieCache.findMany as jest.Mock
const upsert = prisma.movieCache.upsert as jest.Mock
const tmdb = getMovieById as jest.Mock

describe('movie-cache', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns a cached row without calling TMDB', async () => {
    findUnique.mockResolvedValueOnce({
      tmdbMovieId: '603', title: 'The Matrix', posterUrl: 'p', year: 1999, overview: 'o', rating: 8.2,
    })
    const movie = await getCachedMovie('603')
    expect(tmdb).not.toHaveBeenCalled()
    expect(movie).toEqual({ tmdbMovieId: '603', title: 'The Matrix', posterUrl: 'p', year: 1999, overview: 'o', rating: 8.2 })
  })

  it('fetches from TMDB and upserts on cache miss', async () => {
    findUnique.mockResolvedValueOnce(null)
    tmdb.mockResolvedValueOnce({ tmdbId: '603', title: 'The Matrix', posterUrl: 'p', year: 1999, rating: 8.2, overview: 'o', runtime: 136, genreIds: [] })
    upsert.mockResolvedValueOnce({})
    const movie = await getCachedMovie('603')
    expect(upsert).toHaveBeenCalledWith({
      where: { tmdbMovieId: '603' },
      create: { tmdbMovieId: '603', title: 'The Matrix', posterUrl: 'p', year: 1999, overview: 'o', rating: 8.2 },
      update: { title: 'The Matrix', posterUrl: 'p', year: 1999, overview: 'o', rating: 8.2 },
    })
    expect(movie.title).toBe('The Matrix')
  })

  it('returns fallback metadata when TMDB fails and nothing is cached', async () => {
    findUnique.mockResolvedValueOnce(null)
    tmdb.mockRejectedValueOnce(new Error('TMDB fetch failed: 404'))
    const movie = await getCachedMovie('999')
    expect(movie).toEqual({ tmdbMovieId: '999', title: 'Title unavailable', posterUrl: '', year: 0, overview: '', rating: 0 })
  })

  it('getCachedMovies preserves input order and only fetches misses', async () => {
    findMany.mockResolvedValueOnce([
      { tmdbMovieId: '2', title: 'B', posterUrl: '', year: 2000, overview: '', rating: 5 },
    ])
    tmdb.mockResolvedValueOnce({ tmdbId: '1', title: 'A', posterUrl: '', year: 2001, rating: 6, overview: '', runtime: null, genreIds: [] })
    upsert.mockResolvedValue({})
    const movies = await getCachedMovies(['1', '2'])
    expect(movies.map(m => m.tmdbMovieId)).toEqual(['1', '2'])
    expect(tmdb).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm test -- movie-cache`
Expected: FAIL — `Cannot find module '@/lib/movie-cache'`.

- [ ] **Step 3: Write the implementation.**

```typescript
// lib/movie-cache.ts
import { prisma } from '@/lib/prisma'
import { getMovieById } from '@/lib/tmdb'

export interface CachedMovie {
  tmdbMovieId: string
  title: string
  posterUrl: string
  year: number
  overview: string
  rating: number
}

function fallback(tmdbMovieId: string): CachedMovie {
  return { tmdbMovieId, title: 'Title unavailable', posterUrl: '', year: 0, overview: '', rating: 0 }
}

async function fetchAndCache(tmdbMovieId: string): Promise<CachedMovie> {
  try {
    const m = await getMovieById(tmdbMovieId)
    const row: CachedMovie = {
      tmdbMovieId,
      title: m.title,
      posterUrl: m.posterUrl,
      year: Number.isFinite(m.year) ? m.year : 0,
      overview: m.overview,
      rating: m.rating,
    }
    await prisma.movieCache.upsert({
      where: { tmdbMovieId },
      create: { ...row },
      update: { title: row.title, posterUrl: row.posterUrl, year: row.year, overview: row.overview, rating: row.rating },
    })
    return row
  } catch {
    return fallback(tmdbMovieId)
  }
}

export async function getCachedMovie(tmdbMovieId: string): Promise<CachedMovie> {
  const cached = await prisma.movieCache.findUnique({ where: { tmdbMovieId } })
  if (cached) {
    return {
      tmdbMovieId: cached.tmdbMovieId,
      title: cached.title,
      posterUrl: cached.posterUrl,
      year: cached.year,
      overview: cached.overview,
      rating: cached.rating,
    }
  }
  return fetchAndCache(tmdbMovieId)
}

export async function getCachedMovies(tmdbMovieIds: string[]): Promise<CachedMovie[]> {
  if (tmdbMovieIds.length === 0) return []
  const cached = await prisma.movieCache.findMany({ where: { tmdbMovieId: { in: tmdbMovieIds } } })
  const byId = new Map<string, CachedMovie>(
    cached.map(c => [c.tmdbMovieId, {
      tmdbMovieId: c.tmdbMovieId, title: c.title, posterUrl: c.posterUrl, year: c.year, overview: c.overview, rating: c.rating,
    }])
  )
  const result: CachedMovie[] = []
  for (const id of tmdbMovieIds) {
    result.push(byId.get(id) ?? (await fetchAndCache(id)))
  }
  return result
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm test -- movie-cache`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/movie-cache.ts __tests__/lib/movie-cache.test.ts
git commit -m "feat(lib): add persistent movie metadata cache with TMDB fallback"
```

---

### Task 4: `lib/friends.ts` — friendship CRUD and comparison queries

**Files:**
- Create: `lib/friends.ts`
- Test: `__tests__/lib/friends.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
// __tests__/lib/friends.test.ts
import {
  FriendError, sendFriendRequest, respondToRequest, removeFriend, areFriends,
  listFriends, searchUsers, getSharedWatchlist, getSessionsTogether, getSharedYesInSession,
} from '@/lib/friends'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    friendship: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    member: { findMany: jest.fn() },
    room: { findMany: jest.fn() },
    vote: { findMany: jest.fn() },
    userMoviePreference: { findMany: jest.fn() },
  },
}))

const u = prisma.user as unknown as { findUnique: jest.Mock; findMany: jest.Mock }
const f = prisma.friendship as unknown as Record<string, jest.Mock>
const member = prisma.member.findMany as jest.Mock
const room = prisma.room.findMany as jest.Mock
const vote = prisma.vote.findMany as jest.Mock
const pref = prisma.userMoviePreference.findMany as jest.Mock

describe('friends', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sendFriendRequest throws SELF when requester === receiver', async () => {
    await expect(sendFriendRequest('a', 'a')).rejects.toMatchObject({ code: 'SELF' })
  })

  it('sendFriendRequest throws USER_NOT_FOUND when receiver does not exist', async () => {
    u.findUnique.mockResolvedValueOnce(null)
    await expect(sendFriendRequest('a', 'b')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
  })

  it('sendFriendRequest throws DUPLICATE when a pending request exists', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    f.findFirst.mockResolvedValueOnce({ id: 'r1', requesterId: 'a', receiverId: 'b', status: 'PENDING' })
    await expect(sendFriendRequest('a', 'b')).rejects.toMatchObject({ code: 'DUPLICATE' })
  })

  it('sendFriendRequest throws ALREADY_FRIENDS when accepted', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    f.findFirst.mockResolvedValueOnce({ id: 'r1', requesterId: 'b', receiverId: 'a', status: 'ACCEPTED' })
    await expect(sendFriendRequest('a', 'b')).rejects.toMatchObject({ code: 'ALREADY_FRIENDS' })
  })

  it('sendFriendRequest re-opens a DECLINED row in the new direction', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    f.findFirst.mockResolvedValueOnce({ id: 'r1', requesterId: 'b', receiverId: 'a', status: 'DECLINED' })
    f.update.mockResolvedValueOnce({})
    await sendFriendRequest('a', 'b')
    expect(f.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { requesterId: 'a', receiverId: 'b', status: 'PENDING' } })
  })

  it('sendFriendRequest creates a new pending request when none exists', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    f.findFirst.mockResolvedValueOnce(null)
    f.create.mockResolvedValueOnce({})
    await sendFriendRequest('a', 'b')
    expect(f.create).toHaveBeenCalledWith({ data: { requesterId: 'a', receiverId: 'b', status: 'PENDING' } })
  })

  it('respondToRequest rejects when the responder is not the receiver', async () => {
    f.findUnique.mockResolvedValueOnce({ id: 'r1', receiverId: 'someone-else', status: 'PENDING' })
    await expect(respondToRequest('a', 'r1', true)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('respondToRequest accepts a pending request addressed to the user', async () => {
    f.findUnique.mockResolvedValueOnce({ id: 'r1', receiverId: 'a', status: 'PENDING' })
    f.update.mockResolvedValueOnce({})
    await respondToRequest('a', 'r1', true)
    expect(f.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'ACCEPTED' } })
  })

  it('removeFriend deletes the friendship in either direction', async () => {
    f.deleteMany.mockResolvedValueOnce({ count: 1 })
    await removeFriend('a', 'b')
    expect(f.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ requesterId: 'a', receiverId: 'b' }, { requesterId: 'b', receiverId: 'a' }] },
    })
  })

  it('areFriends returns true only for an ACCEPTED row', async () => {
    f.findFirst.mockResolvedValueOnce({ status: 'ACCEPTED' })
    expect(await areFriends('a', 'b')).toBe(true)
    f.findFirst.mockResolvedValueOnce(null)
    expect(await areFriends('a', 'b')).toBe(false)
  })

  it('listFriends splits accepted / incoming / outgoing relative to the user', async () => {
    f.findMany.mockResolvedValueOnce([
      { id: 'r1', requesterId: 'a', receiverId: 'b', status: 'ACCEPTED', requester: { id: 'a' }, receiver: { id: 'b', displayName: 'Bob', email: 'b@x' } },
      { id: 'r2', requesterId: 'c', receiverId: 'a', status: 'PENDING', requester: { id: 'c', displayName: 'Cara', email: 'c@x' }, receiver: { id: 'a' } },
      { id: 'r3', requesterId: 'a', receiverId: 'd', status: 'PENDING', requester: { id: 'a' }, receiver: { id: 'd', displayName: 'Dee', email: 'd@x' } },
    ])
    const { friends, incoming, outgoing } = await listFriends('a')
    expect(friends).toEqual([{ id: 'b', displayName: 'Bob', email: 'b@x' }])
    expect(incoming).toEqual([{ requestId: 'r2', user: { id: 'c', displayName: 'Cara', email: 'c@x' } }])
    expect(outgoing).toEqual([{ requestId: 'r3', user: { id: 'd', displayName: 'Dee', email: 'd@x' } }])
  })

  it('searchUsers returns [] for blank query and excludes the caller otherwise', async () => {
    expect(await searchUsers('   ', 'a')).toEqual([])
    u.findMany.mockResolvedValueOnce([{ id: 'b', displayName: 'Bob', email: 'b@x' }])
    const rows = await searchUsers('bob', 'a')
    expect(u.findMany).toHaveBeenCalledWith({
      where: { id: { not: 'a' }, OR: [{ email: { contains: 'bob', mode: 'insensitive' } }, { displayName: { contains: 'bob', mode: 'insensitive' } }] },
      select: { id: true, displayName: true, email: true },
      take: 10,
    })
    expect(rows).toEqual([{ id: 'b', displayName: 'Bob', email: 'b@x' }])
  })

  it('getSharedWatchlist intersects both users WATCHLIST entries', async () => {
    pref.mockResolvedValueOnce([{ tmdbMovieId: '1' }, { tmdbMovieId: '2' }])
    pref.mockResolvedValueOnce([{ tmdbMovieId: '2' }, { tmdbMovieId: '3' }])
    expect(await getSharedWatchlist('a', 'b')).toEqual(['2'])
  })

  it('getSessionsTogether returns rooms where both users have a member', async () => {
    member.mockResolvedValueOnce([{ roomId: 'r1' }, { roomId: 'r2' }])
    member.mockResolvedValueOnce([{ roomId: 'r2' }, { roomId: 'r3' }])
    room.mockResolvedValueOnce([{ id: 'r2', code: 'BOLD-42', createdAt: new Date(0) }])
    const sessions = await getSessionsTogether('a', 'b')
    expect(room).toHaveBeenCalledWith({ where: { id: { in: ['r2'] } }, select: { id: true, code: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
    expect(sessions).toEqual([{ id: 'r2', code: 'BOLD-42', createdAt: new Date(0) }])
  })

  it('getSharedYesInSession intersects both users yes-votes in a room', async () => {
    vote.mockResolvedValueOnce([{ tmdbMovieId: '1' }, { tmdbMovieId: '2' }])
    vote.mockResolvedValueOnce([{ tmdbMovieId: '2' }])
    expect(await getSharedYesInSession('a', 'b', 'r2')).toEqual(['2'])
    expect(vote).toHaveBeenCalledWith({ where: { roomId: 'r2', vote: true, member: { userId: 'a' } }, select: { tmdbMovieId: true } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm test -- friends`
Expected: FAIL — `Cannot find module '@/lib/friends'`.

- [ ] **Step 3: Write the implementation.**

```typescript
// lib/friends.ts
import { prisma } from '@/lib/prisma'

export type FriendErrorCode =
  | 'SELF' | 'USER_NOT_FOUND' | 'DUPLICATE' | 'ALREADY_FRIENDS' | 'NOT_FOUND' | 'NOT_PENDING'

export class FriendError extends Error {
  code: FriendErrorCode
  constructor(code: FriendErrorCode) {
    super(code)
    this.name = 'FriendError'
    this.code = code
  }
}

export interface PublicUser {
  id: string
  displayName: string
  email: string
}

const eitherDirection = (a: string, b: string) => ({
  OR: [
    { requesterId: a, receiverId: b },
    { requesterId: b, receiverId: a },
  ],
})

export async function sendFriendRequest(requesterId: string, receiverId: string) {
  if (requesterId === receiverId) throw new FriendError('SELF')

  const receiver = await prisma.user.findUnique({ where: { id: receiverId } })
  if (!receiver) throw new FriendError('USER_NOT_FOUND')

  const existing = await prisma.friendship.findFirst({ where: eitherDirection(requesterId, receiverId) })
  if (existing) {
    if (existing.status === 'ACCEPTED') throw new FriendError('ALREADY_FRIENDS')
    if (existing.status === 'PENDING') throw new FriendError('DUPLICATE')
    // DECLINED — re-open in the new direction
    return prisma.friendship.update({
      where: { id: existing.id },
      data: { requesterId, receiverId, status: 'PENDING' },
    })
  }
  return prisma.friendship.create({ data: { requesterId, receiverId, status: 'PENDING' } })
}

export async function respondToRequest(userId: string, requestId: string, accept: boolean) {
  const req = await prisma.friendship.findUnique({ where: { id: requestId } })
  if (!req || req.receiverId !== userId) throw new FriendError('NOT_FOUND')
  if (req.status !== 'PENDING') throw new FriendError('NOT_PENDING')
  return prisma.friendship.update({
    where: { id: requestId },
    data: { status: accept ? 'ACCEPTED' : 'DECLINED' },
  })
}

export async function removeFriend(userId: string, friendId: string): Promise<void> {
  await prisma.friendship.deleteMany({ where: eitherDirection(userId, friendId) })
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const row = await prisma.friendship.findFirst({ where: eitherDirection(a, b) })
  return row?.status === 'ACCEPTED'
}

export async function listFriends(userId: string): Promise<{
  friends: PublicUser[]
  incoming: { requestId: string; user: PublicUser }[]
  outgoing: { requestId: string; user: PublicUser }[]
}> {
  const rows = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { receiverId: userId }] },
    include: {
      requester: { select: { id: true, displayName: true, email: true } },
      receiver: { select: { id: true, displayName: true, email: true } },
    },
  })

  const friends: PublicUser[] = []
  const incoming: { requestId: string; user: PublicUser }[] = []
  const outgoing: { requestId: string; user: PublicUser }[] = []

  for (const r of rows) {
    const other = r.requesterId === userId ? r.receiver : r.requester
    if (r.status === 'ACCEPTED') {
      friends.push(other)
    } else if (r.status === 'PENDING') {
      if (r.receiverId === userId) incoming.push({ requestId: r.id, user: r.requester })
      else outgoing.push({ requestId: r.id, user: r.receiver })
    }
  }
  return { friends, incoming, outgoing }
}

export async function searchUsers(query: string, excludeUserId: string): Promise<PublicUser[]> {
  const q = query.trim()
  if (!q) return []
  return prisma.user.findMany({
    where: {
      id: { not: excludeUserId },
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, displayName: true, email: true },
    take: 10,
  })
}

export async function getSharedWatchlist(a: string, b: string): Promise<string[]> {
  const [aRows, bRows] = await Promise.all([
    prisma.userMoviePreference.findMany({ where: { userId: a, type: 'WATCHLIST' }, select: { tmdbMovieId: true } }),
    prisma.userMoviePreference.findMany({ where: { userId: b, type: 'WATCHLIST' }, select: { tmdbMovieId: true } }),
  ])
  const bSet = new Set(bRows.map(r => r.tmdbMovieId))
  return [...new Set(aRows.map(r => r.tmdbMovieId).filter(id => bSet.has(id)))]
}

export async function getSessionsTogether(a: string, b: string): Promise<
  { id: string; code: string; createdAt: Date }[]
> {
  const [aMembers, bMembers] = await Promise.all([
    prisma.member.findMany({ where: { userId: a }, select: { roomId: true } }),
    prisma.member.findMany({ where: { userId: b }, select: { roomId: true } }),
  ])
  const bRoomIds = new Set(bMembers.map(m => m.roomId))
  const sharedRoomIds = [...new Set(aMembers.map(m => m.roomId).filter(id => bRoomIds.has(id)))]
  if (sharedRoomIds.length === 0) return []
  return prisma.room.findMany({
    where: { id: { in: sharedRoomIds } },
    select: { id: true, code: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getSharedYesInSession(a: string, b: string, roomId: string): Promise<string[]> {
  const [aYes, bYes] = await Promise.all([
    prisma.vote.findMany({ where: { roomId, vote: true, member: { userId: a } }, select: { tmdbMovieId: true } }),
    prisma.vote.findMany({ where: { roomId, vote: true, member: { userId: b } }, select: { tmdbMovieId: true } }),
  ])
  const bSet = new Set(bYes.map(v => v.tmdbMovieId))
  return [...new Set(aYes.map(v => v.tmdbMovieId).filter(id => bSet.has(id)))]
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm test -- friends`
Expected: PASS (all `friends` tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/friends.ts __tests__/lib/friends.test.ts
git commit -m "feat(lib): add friendship CRUD and comparison queries"
```

---

### Task 5: `lib/link.ts` — bridge a room member to the signed-in user

**Files:**
- Create: `lib/link.ts`
- Test: `__tests__/lib/link.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
// __tests__/lib/link.test.ts
import { resolveMemberUserId } from '@/lib/link'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

jest.mock('@/lib/prisma', () => ({ prisma: { member: { update: jest.fn() } } }))
jest.mock('@/auth', () => ({ auth: jest.fn() }))

const update = prisma.member.update as jest.Mock
const mockAuth = auth as unknown as jest.Mock

describe('resolveMemberUserId', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the existing userId without touching auth', async () => {
    const id = await resolveMemberUserId({ id: 'm1', userId: 'user-1' })
    expect(id).toBe('user-1')
    expect(mockAuth).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('links the member and returns the id when a session exists', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-9' } })
    update.mockResolvedValueOnce({})
    const id = await resolveMemberUserId({ id: 'm1', userId: null })
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { userId: 'user-9' } })
    expect(id).toBe('user-9')
  })

  it('returns null when the member is anonymous and no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const id = await resolveMemberUserId({ id: 'm1', userId: null })
    expect(id).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm test -- link`
Expected: FAIL — `Cannot find module '@/lib/link'`.

- [ ] **Step 3: Write the implementation.**

```typescript
// lib/link.ts
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

/**
 * Resolves the NextAuth user id for a room member, linking the member to the
 * signed-in user on the fly if it is not yet linked. Returns null for anonymous
 * (not-signed-in) members so callers can skip user-scoped side effects.
 */
export async function resolveMemberUserId(
  member: { id: string; userId: string | null }
): Promise<string | null> {
  if (member.userId) return member.userId
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null
  await prisma.member.update({ where: { id: member.id }, data: { userId } })
  return userId
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm test -- link`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/link.ts __tests__/lib/link.test.ts
git commit -m "feat(lib): resolve/link room member to signed-in user"
```

---

## Phase C — Hook the existing room flow

### Task 6: Record watch-list entries on "Yes" votes

**Files:**
- Modify: `app/api/rooms/[code]/votes/route.ts`

- [ ] **Step 1: Add imports.** At the top of `app/api/rooms/[code]/votes/route.ts`, after the existing `import { advanceQueueAtomic } from '@/lib/queue'` line, add:

```typescript
import { resolveMemberUserId } from '@/lib/link'
import { addPreference } from '@/lib/preferences'
```

- [ ] **Step 2: Record the preference after the vote upsert.** In the same file, find this existing block:

```typescript
    await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

    if (!vote) {
```

Insert the watch-list hook **between** the `member.update` line and the `if (!vote)` line:

```typescript
    await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

    if (vote) {
      try {
        const userId = await resolveMemberUserId(member)
        if (userId) await addPreference(userId, tmdbMovieId, 'WATCHLIST', room.id)
      } catch (hookErr) {
        console.error('[votes] watchlist hook failed (non-fatal)', {
          roomCode,
          memberId: member.id,
          message: hookErr instanceof Error ? hookErr.message : String(hookErr),
        })
      }
    }

    if (!vote) {
```

(The hook is wrapped in try/catch so a preference-write failure never breaks voting.)

- [ ] **Step 3: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add app/api/rooms/[code]/votes/route.ts
git commit -m "feat(voting): add Yes-voted movies to the user watch list"
```

---

### Task 7: Record seen-before entries on "Already seen it"

**Files:**
- Modify: `app/api/rooms/[code]/watched/route.ts`

- [ ] **Step 1: Add imports.** At the top of `app/api/rooms/[code]/watched/route.ts`, after `import { getSessionToken } from '@/lib/session'`, add:

```typescript
import { resolveMemberUserId } from '@/lib/link'
import { addPreference } from '@/lib/preferences'
```

- [ ] **Step 2: Record the preference after the watchedMovie upsert.** Find this existing block:

```typescript
    console.log('[watched] upsert', {
      roomId: room.id,
      memberId: member.id,
      tmdbMovieId,
    })

    return NextResponse.json({ ok: true })
```

Insert the seen-before hook **between** the `console.log` call and the `return`:

```typescript
    console.log('[watched] upsert', {
      roomId: room.id,
      memberId: member.id,
      tmdbMovieId,
    })

    try {
      const userId = await resolveMemberUserId(member)
      if (userId) await addPreference(userId, tmdbMovieId, 'SEEN_BEFORE', room.id)
    } catch (hookErr) {
      console.error('[watched] seen-before hook failed (non-fatal)', {
        roomCode,
        memberId: member.id,
        message: hookErr instanceof Error ? hookErr.message : String(hookErr),
      })
    }

    return NextResponse.json({ ok: true })
```

- [ ] **Step 3: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add app/api/rooms/[code]/watched/route.ts
git commit -m "feat(watched): add seen movies to the user seen-before list"
```

---

## Phase D — Profile pages & list APIs

### Task 8: `app/api/user/movies/route.ts` — list & remove preferences

**Files:**
- Create: `app/api/user/movies/route.ts`

This route maps the URL `?type` param (`watchlist` | `seen`) to the Prisma enum, lists enriched movies, and deletes one entry.

- [ ] **Step 1: Write the route.**

```typescript
// app/api/user/movies/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import type { MoviePreferenceType } from '@prisma/client'
import { listPreferences, removePreference } from '@/lib/preferences'
import { getCachedMovies } from '@/lib/movie-cache'

function parseType(raw: string | null): MoviePreferenceType | null {
  if (raw === 'watchlist') return 'WATCHLIST'
  if (raw === 'seen' || raw === 'seen_before') return 'SEEN_BEFORE'
  return null
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const type = parseType(new URL(request.url).searchParams.get('type'))
  if (!type) return NextResponse.json({ error: 'type must be watchlist or seen' }, { status: 400 })

  const prefs = await listPreferences(session.user.id, type)
  const movies = await getCachedMovies(prefs.map(p => p.tmdbMovieId))
  const byId = new Map(movies.map(m => [m.tmdbMovieId, m]))

  return NextResponse.json({
    movies: prefs.map(p => ({
      ...byId.get(p.tmdbMovieId)!,
      sourceRoomId: p.sourceRoomId,
      addedAt: p.createdAt,
    })),
  })
}

export async function DELETE(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const type = parseType(body?.type)
  if (!body?.tmdbMovieId || typeof body.tmdbMovieId !== 'string' || !type) {
    return NextResponse.json({ error: 'tmdbMovieId (string) and type are required' }, { status: 400 })
  }

  await removePreference(session.user.id, body.tmdbMovieId, type)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add app/api/user/movies/route.ts
git commit -m "feat(api): list and remove user watch-list / seen-before movies"
```

---

### Task 9: `MovieListClient` component + its test

**Files:**
- Create: `components/MovieListClient.tsx`
- Test: `__tests__/components/MovieListClient.test.tsx`

- [ ] **Step 1: Write the failing test.**

```typescript
// __tests__/components/MovieListClient.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MovieListClient from '@/components/MovieListClient'

describe('MovieListClient', () => {
  afterEach(() => jest.restoreAllMocks())

  it('renders the empty state when the list is empty', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ movies: [] }), { status: 200 })
    )
    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument()
  })

  it('renders movies and removes one on click', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        movies: [{ tmdbMovieId: '603', title: 'The Matrix', posterUrl: '', year: 1999, overview: '', rating: 8.2, sourceRoomId: null, addedAt: '2026-01-01' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText('The Matrix')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /remove the matrix/i }))

    await waitFor(() => expect(screen.queryByText('The Matrix')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/user/movies', expect.objectContaining({ method: 'DELETE' }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npm test -- MovieListClient`
Expected: FAIL — `Cannot find module '@/components/MovieListClient'`.

- [ ] **Step 3: Write the implementation.**

```tsx
// components/MovieListClient.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'

interface ListMovie {
  tmdbMovieId: string
  title: string
  posterUrl: string
  year: number
  overview: string
  rating: number
  sourceRoomId: string | null
  addedAt: string
}

export default function MovieListClient({ type }: { type: 'watchlist' | 'seen' }) {
  const [movies, setMovies] = useState<ListMovie[] | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/user/movies?type=${type}`)
      .then(r => (r.ok ? r.json() : { movies: [] }))
      .then(data => { if (active) setMovies(data.movies ?? []) })
      .catch(() => { if (active) setMovies([]) })
    return () => { active = false }
  }, [type])

  const handleRemove = useCallback(async (tmdbMovieId: string) => {
    setRemoving(tmdbMovieId)
    try {
      const res = await fetch('/api/user/movies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbMovieId, type }),
      })
      if (res.ok) setMovies(prev => (prev ?? []).filter(m => m.tmdbMovieId !== tmdbMovieId))
    } finally {
      setRemoving(null)
    }
  }, [type])

  if (movies === null) {
    return <p className="text-gray-400">Loading…</p>
  }

  if (movies.length === 0) {
    return <p className="text-gray-400">Nothing here yet.</p>
  }

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {movies.map(m => (
        <li key={m.tmdbMovieId} className="bg-gray-900 rounded-xl overflow-hidden flex flex-col">
          {m.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.posterUrl} alt={m.title} className="w-full aspect-[2/3] object-cover" />
          ) : (
            <div className="w-full aspect-[2/3] bg-gray-800 flex items-center justify-center text-gray-600 text-xs px-2 text-center">
              No image
            </div>
          )}
          <div className="p-3 flex flex-col gap-2 flex-1">
            <p className="text-sm font-medium text-gray-100 line-clamp-2">{m.title}</p>
            {m.year > 0 && <p className="text-xs text-gray-500">{m.year}</p>}
            <button
              type="button"
              onClick={() => handleRemove(m.tmdbMovieId)}
              disabled={removing === m.tmdbMovieId}
              aria-label={`Remove ${m.title}`}
              className="mt-auto rounded-lg border border-gray-700 hover:bg-gray-800 disabled:opacity-40 px-3 py-1.5 text-xs text-gray-300 transition-colors"
            >
              {removing === m.tmdbMovieId ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm test -- MovieListClient`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add components/MovieListClient.tsx __tests__/components/MovieListClient.test.tsx
git commit -m "feat(ui): movie list component with remove action"
```

---

### Task 10: Profile hub + watch-list + seen pages and a shared server guard

**Files:**
- Create: `components/ProfileGuard.tsx`
- Create: `app/profile/page.tsx`
- Create: `app/profile/watchlist/page.tsx`
- Create: `app/profile/seen/page.tsx`

- [ ] **Step 1: Write the shared server guard.** This keeps the redirect logic DRY across every profile page.

```tsx
// components/ProfileGuard.tsx
import { redirect } from 'next/navigation'
import { auth } from '@/auth'

/** Returns the signed-in user id, or redirects to sign-in. Server components only. */
export async function requireUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')
  return session.user.id
}
```

- [ ] **Step 2: Write the profile hub page.**

```tsx
// app/profile/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'

export default async function ProfilePage() {
  await requireUserId()

  const links = [
    { href: '/profile/settings', label: 'Settings / Profile Info' },
    { href: '/profile/friends', label: 'Friends' },
    { href: '/profile/watchlist', label: 'Watch List' },
    { href: '/profile/seen', label: 'Seen Before' },
  ]

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-md mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Your Profile</h1>
        <nav className="space-y-3">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-xl bg-gray-900 hover:bg-gray-800 px-5 py-4 font-medium transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Write the watch-list page.**

```tsx
// app/profile/watchlist/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import MovieListClient from '@/components/MovieListClient'

export default async function WatchlistPage() {
  await requireUserId()
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Link href="/profile" className="text-sm text-gray-400 hover:text-gray-200">← Profile</Link>
        <h1 className="text-3xl font-bold">Watch List</h1>
        <MovieListClient type="watchlist" />
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Write the seen-before page.**

```tsx
// app/profile/seen/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import MovieListClient from '@/components/MovieListClient'

export default async function SeenPage() {
  await requireUserId()
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Link href="/profile" className="text-sm text-gray-400 hover:text-gray-200">← Profile</Link>
        <h1 className="text-3xl font-bold">Seen Before</h1>
        <MovieListClient type="seen" />
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add components/ProfileGuard.tsx app/profile/page.tsx app/profile/watchlist/page.tsx app/profile/seen/page.tsx
git commit -m "feat(ui): profile hub, watch-list, and seen-before pages"
```

---

### Task 11: Settings page + PUT on the preferences API

**Files:**
- Modify: `app/api/user/preferences/route.ts`
- Create: `app/profile/settings/page.tsx`
- Create: `components/SettingsClient.tsx`

- [ ] **Step 1: Add a PUT handler to the preferences route.** Open `app/api/user/preferences/route.ts` and append (the existing `GET` stays unchanged):

```typescript
export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const data: { displayName?: string; savedServices?: string[] } = {}

  if (typeof body?.displayName === 'string') {
    const name = body.displayName.trim()
    if (name.length === 0 || name.length > 255) {
      return NextResponse.json({ error: 'Display name must be 1–255 characters' }, { status: 400 })
    }
    data.displayName = name
  }
  if (Array.isArray(body?.savedServices) && body.savedServices.every((s: unknown) => typeof s === 'string')) {
    data.savedServices = body.savedServices
  }

  await prisma.user.update({ where: { id: session.user.id }, data })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Write the settings client component.** Reuses the existing `StreamingServicePicker`.

```tsx
// components/SettingsClient.tsx
'use client'

import { useEffect, useState } from 'react'
import StreamingServicePicker from '@/components/StreamingServicePicker'
import type { ServiceId } from '@/lib/tmdb'

export default function SettingsClient({ email, initialName }: { email: string; initialName: string }) {
  const [displayName, setDisplayName] = useState(initialName)
  const [services, setServices] = useState<ServiceId[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/user/preferences')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.savedServices) setServices(d.savedServices as ServiceId[]) })
      .catch(() => {})
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim(), savedServices: services }),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <label className="text-sm text-gray-400">Email</label>
        <p className="text-gray-200">{email}</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-gray-400">Display name</label>
        <input
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm text-gray-400">Default streaming services</label>
        <StreamingServicePicker selected={services} onChange={setServices} />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2.5 font-semibold transition-colors"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && <p className="text-sm text-emerald-400">Saved.</p>}
    </div>
  )
}
```

- [ ] **Step 3: Write the settings page** (server component fetches the user's current name/email).

```tsx
// app/profile/settings/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import { prisma } from '@/lib/prisma'
import SettingsClient from '@/components/SettingsClient'

export default async function SettingsPage() {
  const userId = await requireUserId()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true },
  })

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-md mx-auto space-y-6">
        <Link href="/profile" className="text-sm text-gray-400 hover:text-gray-200">← Profile</Link>
        <h1 className="text-3xl font-bold">Settings</h1>
        <SettingsClient email={user?.email ?? ''} initialName={user?.displayName ?? ''} />
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add app/api/user/preferences/route.ts app/profile/settings/page.tsx components/SettingsClient.tsx
git commit -m "feat(profile): settings page with display-name and default services"
```

---

## Phase E — Friends APIs & pages

### Task 12: User-search and friends-list APIs

**Files:**
- Create: `app/api/users/search/route.ts`
- Create: `app/api/friends/route.ts`

- [ ] **Step 1: Write the user-search route.**

```typescript
// app/api/users/search/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { searchUsers } from '@/lib/friends'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q') ?? ''
  const users = await searchUsers(q, session.user.id)
  return NextResponse.json({ users })
}
```

- [ ] **Step 2: Write the friends-list route.**

```typescript
// app/api/friends/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { listFriends } from '@/lib/friends'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { friends, incoming, outgoing } = await listFriends(session.user.id)
  return NextResponse.json({ friends, incoming, outgoing })
}
```

- [ ] **Step 3: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add app/api/users/search/route.ts app/api/friends/route.ts
git commit -m "feat(api): user search and friends list endpoints"
```

---

### Task 13: Friend-request APIs (send / respond / unfriend)

**Files:**
- Create: `app/api/friends/requests/route.ts`
- Create: `app/api/friends/requests/[id]/route.ts`
- Create: `app/api/friends/[friendId]/route.ts` (DELETE only for now; GET added in Task 15)

This shared error-mapping pattern is repeated in each handler (per plan style — no cross-references).

- [ ] **Step 1: Write the send-request route.**

```typescript
// app/api/friends/requests/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { sendFriendRequest, FriendError } from '@/lib/friends'

const STATUS: Record<string, number> = {
  SELF: 400, USER_NOT_FOUND: 404, DUPLICATE: 409, ALREADY_FRIENDS: 409,
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (!body?.receiverId || typeof body.receiverId !== 'string') {
    return NextResponse.json({ error: 'receiverId is required' }, { status: 400 })
  }

  try {
    await sendFriendRequest(session.user.id, body.receiverId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof FriendError) {
      return NextResponse.json({ error: err.code }, { status: STATUS[err.code] ?? 400 })
    }
    throw err
  }
}
```

- [ ] **Step 2: Write the respond route.**

```typescript
// app/api/friends/requests/[id]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { respondToRequest, FriendError } from '@/lib/friends'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (body?.action !== 'accept' && body?.action !== 'decline') {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 })
  }

  try {
    await respondToRequest(session.user.id, id, body.action === 'accept')
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof FriendError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 409
      return NextResponse.json({ error: err.code }, { status })
    }
    throw err
  }
}
```

- [ ] **Step 3: Write the unfriend route.**

```typescript
// app/api/friends/[friendId]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { removeFriend } from '@/lib/friends'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { friendId } = await params
  await removeFriend(session.user.id, friendId)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add app/api/friends/requests/route.ts "app/api/friends/requests/[id]/route.ts" "app/api/friends/[friendId]/route.ts"
git commit -m "feat(api): send, respond to, and remove friend requests"
```

---

### Task 14: Friends page (search, requests, list)

**Files:**
- Create: `components/FriendsClient.tsx`
- Create: `app/profile/friends/page.tsx`

- [ ] **Step 1: Write the friends client component.**

```tsx
// components/FriendsClient.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface PublicUser { id: string; displayName: string; email: string }
interface PendingItem { requestId: string; user: PublicUser }

export default function FriendsClient() {
  const [friends, setFriends] = useState<PublicUser[]>([])
  const [incoming, setIncoming] = useState<PendingItem[]>([])
  const [outgoing, setOutgoing] = useState<PendingItem[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PublicUser[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/friends')
    if (res.ok) {
      const data = await res.json()
      setFriends(data.friends)
      setIncoming(data.incoming)
      setOutgoing(data.outgoing)
    }
    setLoaded(true)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`)
    if (res.ok) setResults((await res.json()).users)
  }

  async function sendRequest(receiverId: string) {
    await fetch('/api/friends/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverId }),
    })
    setResults(prev => prev.filter(u => u.id !== receiverId))
    await refresh()
  }

  async function respond(requestId: string, action: 'accept' | 'decline') {
    await fetch(`/api/friends/requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    await refresh()
  }

  const friendIds = new Set(friends.map(f => f.id))
  const outgoingIds = new Set(outgoing.map(o => o.user.id))

  return (
    <div className="space-y-8">
      {/* Search */}
      <section className="space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button type="submit" className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 font-semibold">Search</button>
        </form>
        {results.map(u => {
          const already = friendIds.has(u.id)
          const pending = outgoingIds.has(u.id)
          return (
            <div key={u.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3">
              <span className="text-sm">{u.displayName} <span className="text-gray-500">{u.email}</span></span>
              <button
                type="button"
                disabled={already || pending}
                onClick={() => sendRequest(u.id)}
                className="rounded-lg border border-gray-700 hover:bg-gray-800 disabled:opacity-40 px-3 py-1.5 text-xs"
              >
                {already ? 'Friends' : pending ? 'Requested' : 'Add friend'}
              </button>
            </div>
          )
        })}
      </section>

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Friend requests</h2>
          {incoming.map(item => (
            <div key={item.requestId} className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3">
              <span className="text-sm">{item.user.displayName}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => respond(item.requestId, 'accept')} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs">Accept</button>
                <button type="button" onClick={() => respond(item.requestId, 'decline')} className="rounded-lg border border-gray-700 hover:bg-gray-800 px-3 py-1.5 text-xs">Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Outgoing requests */}
      {outgoing.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Pending (sent)</h2>
          {outgoing.map(item => (
            <div key={item.requestId} className="bg-gray-900 rounded-lg px-4 py-3 text-sm text-gray-400">
              {item.user.displayName} — awaiting response
            </div>
          ))}
        </section>
      )}

      {/* Friends list */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Friends</h2>
        {loaded && friends.length === 0 && (
          <p className="text-gray-400 text-sm">No friends yet. Search above to send a request.</p>
        )}
        {friends.map(f => (
          <Link key={f.id} href={`/profile/friends/${f.id}`} className="block bg-gray-900 hover:bg-gray-800 rounded-lg px-4 py-3 transition-colors">
            {f.displayName}
          </Link>
        ))}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Write the friends page.**

```tsx
// app/profile/friends/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import FriendsClient from '@/components/FriendsClient'

export default async function FriendsPage() {
  await requireUserId()
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Link href="/profile" className="text-sm text-gray-400 hover:text-gray-200">← Profile</Link>
        <h1 className="text-3xl font-bold">Friends</h1>
        <FriendsClient />
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add components/FriendsClient.tsx app/profile/friends/page.tsx
git commit -m "feat(ui): friends page with search, requests, and list"
```

---

## Phase F — Friend comparison page (Feature 2)

### Task 15: Friend-detail and shared-session APIs

**Files:**
- Modify: `app/api/friends/[friendId]/route.ts` (add GET)
- Create: `app/api/friends/[friendId]/sessions/[roomId]/route.ts`

- [ ] **Step 1: Add a GET handler to the friend route.** Open `app/api/friends/[friendId]/route.ts`. Add these imports to the existing import block:

```typescript
import { areFriends, getSharedWatchlist, getSessionsTogether, getSharedYesInSession } from '@/lib/friends'
import { getCachedMovies } from '@/lib/movie-cache'
import { prisma } from '@/lib/prisma'
```

Then append this `GET` handler (the existing `DELETE` stays unchanged):

```typescript
export async function GET(
  request: Request,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { friendId } = await params
  const me = session.user.id

  if (!(await areFriends(me, friendId))) {
    return NextResponse.json({ error: 'Not friends' }, { status: 403 })
  }

  const friend = await prisma.user.findUnique({
    where: { id: friendId },
    select: { id: true, displayName: true, email: true },
  })
  if (!friend) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const sharedIds = await getSharedWatchlist(me, friendId)
  const sharedWatchlist = await getCachedMovies(sharedIds)

  const rooms = await getSessionsTogether(me, friendId)
  const sessions = await Promise.all(
    rooms.map(async r => ({
      roomId: r.id,
      code: r.code,
      createdAt: r.createdAt,
      sharedYesCount: (await getSharedYesInSession(me, friendId, r.id)).length,
    }))
  )

  return NextResponse.json({ friend, sharedWatchlist, sessions })
}
```

- [ ] **Step 2: Write the shared-session route.**

```typescript
// app/api/friends/[friendId]/sessions/[roomId]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { areFriends, getSharedYesInSession } from '@/lib/friends'
import { getCachedMovies } from '@/lib/movie-cache'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ friendId: string; roomId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { friendId, roomId } = await params
  const me = session.user.id

  if (!(await areFriends(me, friendId))) {
    return NextResponse.json({ error: 'Not friends' }, { status: 403 })
  }

  const ids = await getSharedYesInSession(me, friendId, roomId)
  const movies = await getCachedMovies(ids)
  return NextResponse.json({ movies })
}
```

- [ ] **Step 3: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add "app/api/friends/[friendId]/route.ts" "app/api/friends/[friendId]/sessions/[roomId]/route.ts"
git commit -m "feat(api): friend detail and shared-session comparison"
```

---

### Task 16: Friend-detail and shared-session pages

**Files:**
- Create: `components/FriendDetailClient.tsx`
- Create: `components/SharedSessionClient.tsx`
- Create: `app/profile/friends/[friendId]/page.tsx`
- Create: `app/profile/friends/[friendId]/sessions/[roomId]/page.tsx`

- [ ] **Step 1: Write the friend-detail client component.**

```tsx
// components/FriendDetailClient.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Movie { tmdbMovieId: string; title: string; posterUrl: string; year: number }
interface SessionRow { roomId: string; code: string; createdAt: string; sharedYesCount: number }
interface Detail {
  friend: { id: string; displayName: string; email: string }
  sharedWatchlist: Movie[]
  sessions: SessionRow[]
}

export default function FriendDetailClient({ friendId }: { friendId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch(`/api/friends/${friendId}`)
      .then(r => {
        if (r.status === 403) { setForbidden(true); return null }
        return r.ok ? r.json() : null
      })
      .then(d => { if (d) setDetail(d) })
      .catch(() => {})
  }, [friendId])

  async function unfriend() {
    await fetch(`/api/friends/${friendId}`, { method: 'DELETE' })
    window.location.href = '/profile/friends'
  }

  if (forbidden) return <p className="text-gray-400">You are not friends with this user.</p>
  if (!detail) return <p className="text-gray-400">Loading…</p>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{detail.friend.displayName}</h1>
        <button type="button" onClick={unfriend} className="rounded-lg border border-gray-700 hover:bg-gray-800 px-3 py-1.5 text-xs text-gray-300">Unfriend</button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Shared Watch List</h2>
        {detail.sharedWatchlist.length === 0 ? (
          <p className="text-gray-400 text-sm">No movies you both want to watch yet.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {detail.sharedWatchlist.map(m => (
              <li key={m.tmdbMovieId} className="bg-gray-900 rounded-xl overflow-hidden">
                {m.posterUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={m.posterUrl} alt={m.title} className="w-full aspect-[2/3] object-cover" />
                  : <div className="w-full aspect-[2/3] bg-gray-800" />}
                <p className="p-3 text-sm">{m.title}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Previous Sessions Together</h2>
        {detail.sessions.length === 0 ? (
          <p className="text-gray-400 text-sm">No shared sessions yet.</p>
        ) : (
          detail.sessions.map(s => (
            <Link
              key={s.roomId}
              href={`/profile/friends/${friendId}/sessions/${s.roomId}`}
              className="block bg-gray-900 hover:bg-gray-800 rounded-lg px-4 py-3 transition-colors"
            >
              <span className="font-medium">{s.code}</span>
              <span className="text-gray-500 text-sm"> — {s.sharedYesCount} shared yes</span>
            </Link>
          ))
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Write the shared-session client component.**

```tsx
// components/SharedSessionClient.tsx
'use client'

import { useEffect, useState } from 'react'

interface Movie { tmdbMovieId: string; title: string; posterUrl: string; year: number }

export default function SharedSessionClient({ friendId, roomId }: { friendId: string; roomId: string }) {
  const [movies, setMovies] = useState<Movie[] | null>(null)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch(`/api/friends/${friendId}/sessions/${roomId}`)
      .then(r => {
        if (r.status === 403) { setForbidden(true); return null }
        return r.ok ? r.json() : { movies: [] }
      })
      .then(d => { if (d) setMovies(d.movies) })
      .catch(() => setMovies([]))
  }, [friendId, roomId])

  if (forbidden) return <p className="text-gray-400">You are not friends with this user.</p>
  if (movies === null) return <p className="text-gray-400">Loading…</p>
  if (movies.length === 0) return <p className="text-gray-400 text-sm">You both said yes to nothing in this session.</p>

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {movies.map(m => (
        <li key={m.tmdbMovieId} className="bg-gray-900 rounded-xl overflow-hidden">
          {m.posterUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={m.posterUrl} alt={m.title} className="w-full aspect-[2/3] object-cover" />
            : <div className="w-full aspect-[2/3] bg-gray-800" />}
          <p className="p-3 text-sm">{m.title}</p>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Write the friend-detail page.**

```tsx
// app/profile/friends/[friendId]/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import FriendDetailClient from '@/components/FriendDetailClient'

export default async function FriendDetailPage({
  params,
}: {
  params: Promise<{ friendId: string }>
}) {
  await requireUserId()
  const { friendId } = await params
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Link href="/profile/friends" className="text-sm text-gray-400 hover:text-gray-200">← Friends</Link>
        <FriendDetailClient friendId={friendId} />
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Write the shared-session page.**

```tsx
// app/profile/friends/[friendId]/sessions/[roomId]/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import SharedSessionClient from '@/components/SharedSessionClient'

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ friendId: string; roomId: string }>
}) {
  await requireUserId()
  const { friendId, roomId } = await params
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Link href={`/profile/friends/${friendId}`} className="text-sm text-gray-400 hover:text-gray-200">← Friend</Link>
        <h1 className="text-3xl font-bold">Shared Yes</h1>
        <SharedSessionClient friendId={friendId} roomId={roomId} />
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add components/FriendDetailClient.tsx components/SharedSessionClient.tsx "app/profile/friends/[friendId]/page.tsx" "app/profile/friends/[friendId]/sessions/[roomId]/page.tsx"
git commit -m "feat(ui): friend detail and shared-session comparison pages"
```

---

## Phase G — Wiring & final verification

### Task 17: Add a Profile link to the global auth status

**Files:**
- Modify: `components/AuthStatus.tsx`

- [ ] **Step 1: Add the Profile link.** In `components/AuthStatus.tsx`, replace the signed-in block (the `if (session?.user) { return (...) }` JSX) so the name links to the profile:

```tsx
  if (session?.user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Link href="/profile" className="text-gray-300 hover:text-white transition-colors">Profile</Link>
        <span className="text-gray-400">{session.user.name ?? session.user.email}</span>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    )
  }
```

(`Link` is already imported in this file.)

- [ ] **Step 2: Verify it type-checks and lints.**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add components/AuthStatus.tsx
git commit -m "feat(ui): link to profile from auth status"
```

---

### Task 18: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full verification script** (the project's deterministic gate: typecheck → lint → jest).

Run: `bash scripts/verify.sh`
Expected: exits 0; writes `.workflow_verified`. All Jest suites pass, including the new `preferences`, `movie-cache`, `friends`, `link`, and `MovieListClient` suites.

- [ ] **Step 2: Manual smoke test (requires a running dev server — start only with user approval, never during RESEARCH/PLAN).** Walk the success criteria:
  1. Visit `/profile` while signed out → redirected to `/auth/signin`.
  2. Sign in, visit `/profile` → see four buttons.
  3. Create/join a room **while signed in**, vote Yes on a movie → it appears in `/profile/watchlist`.
  4. Click "Already seen it" → movie appears in `/profile/seen`.
  5. Remove a movie from each list → it disappears and stays gone after refresh.
  6. Search a second user, send a request; as that user, accept it; confirm they appear in both friends lists.
  7. Open the friend's detail page → shared watch list shows the intersection; a shared session lists movies both said Yes to.
  8. Unfriend → the friend-detail page now shows "not friends" (403).

- [ ] **Step 3: Commit any verification fixups, then advance the workflow state.**

```bash
bash scripts/advance_state.sh next   # IMPLEMENT → TEST (only if verify.sh passed)
```

---

## Self-Review

**Spec coverage check (each success criterion → task):**

| Success criterion | Task(s) |
|---|---|
| Signed-in users can access a profile page | 10 |
| Unsigned users cannot access profile/friend features | 10 (ProfileGuard), enforced on every page; APIs 401 |
| View and edit watch list & seen-before list | 9, 10 (view + remove); 11 (settings edit) |
| Voting Yes adds movie to watch list | 6 |
| Clicking "Already Seen It" adds to seen-before list | 7 |
| Send, accept, decline friend requests | 13, 14 |
| Accepted friends appear in friends list | 12, 14 |
| Open a friend detail page | 16 |
| Friend page shows shared watch-list intersection | 4 (`getSharedWatchlist`), 15, 16 |
| Friend page shows past shared sessions | 4 (`getSessionsTogether`), 15, 16 |
| Shared session page shows movies both voted Yes on | 4 (`getSharedYesInSession`), 15, 16 |
| Data persists after refresh/logout/login | 1 (DB-backed) |
| No duplicate friend requests / watch-list items | 1 (`@@unique`), 2 (upsert), 4 (DUPLICATE/ALREADY_FRIENDS) |
| Access control on private friend/session data | 5 (anon never written), 15 (`areFriends` 403), 16 |

**Edge cases mapped:**
- Not signed in → redirect: `requireUserId` (Task 10); APIs return 401.
- Empty watch/seen list → empty state: Task 9 ("Nothing here yet").
- No friends → invite/search prompt: Task 14 ("No friends yet…").
- Duplicate request / already friends / self: Task 4 `FriendError` codes → Task 13 status mapping.
- Non-friend's friend page blocked: Task 15 `areFriends` 403, Task 16 "not friends" UI.
- Movie unavailable → fallback metadata: Task 3 `fallback()`.
- Same movie across sessions deduped: Task 2 unique key + Task 4 `Set`-based intersections.
- Remove from watch list updates shared list: shared list is computed live from `UserMoviePreference` (Task 4) — removal (Task 8) propagates.
- Unfriend removes access: Task 13 `removeFriend` → `areFriends` false.
- One Yes + one No → not shared: Task 4 `getSharedYesInSession` filters `vote: true` for both.
- Anonymous participants not exposed: Task 5 returns null for unlinked members → no preference written.

**Placeholder scan:** none — every code step contains complete, runnable code.

**Type consistency check:** `MoviePreferenceType` values `'WATCHLIST' | 'SEEN_BEFORE'` used consistently (Tasks 1, 2, 6, 7, 8); URL param `type` is `'watchlist' | 'seen'` mapped in Task 8 and passed by `MovieListClient` (Task 9). `PublicUser { id, displayName, email }` consistent across Tasks 4, 12, 14. `CachedMovie` shape (Task 3) consumed by Tasks 8, 15, 16. `FriendError.code` set (Task 4) and mapped (Task 13). `resolveMemberUserId` signature (Task 5) matches calls (Tasks 6, 7).

**Open follow-ups (out of scope, noted for the team):**
- Streaming-provider metadata in `MovieCache` (spec "if available") is deferred.
- The `MemberQueue` retirement noted in project memory is unrelated to this work.
- `getSessionsTogether` computes `sharedYesCount` with one query per room (N+1). Fine for MVP volumes; revisit if session counts grow.
