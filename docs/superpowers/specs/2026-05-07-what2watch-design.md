# What2Watch — MVP Spec & Implementation Plan

**Date:** 2026-05-07
**Status:** Ready for implementation

---

## Context

What2Watch solves the "what should we watch tonight?" problem for groups. Instead of scrolling endlessly through streaming apps and arguing, a group creates a shared room, picks their streaming services, and votes yes/no on the same queue of movies. The first movie everyone votes yes on is the match — and they get a direct "Watch Now" link. The MVP is focused on the core loop: room creation → streaming service selection → synchronized voting → match detection.

---

## Tech Stack

- **Framework:** Next.js (App Router) — frontend + API routes in one project
- **Database:** PostgreSQL via Prisma ORM
- **Movie data:** TMDB API (free tier) — metadata, posters, streaming availability via JustWatch
- **Auth:** Anonymous-first (session cookie) with optional account sign-up
- **Real-time:** Client-side polling every 3 seconds during voting
- **Deploy:** Vercel (frontend + serverless API routes) + managed Postgres (Vercel Postgres or Supabase)

---

## Core User Flow

```
Host                          Guest
 |                              |
 | Create Room                  | Open shared link
 |                              |
 └──────────> Enter display name <──────────┘
                     |
              [Host only] Select streaming services
              [Host only] Set optional filters
                     |
              Lobby — share link, see who joined
                     |
              [Host] Start Voting → server generates queue
                     |
              Voting — Tinder-style cards, Yes/No
                     |
              Poll every 3s for match/status
                     |
         ┌───────────┴───────────┐
      MATCH 🎉                No match 😅
      Watch Now link         Adjust filters / retry
```

---

## Screens (6 total)

| # | Screen | Route | Who sees it |
|---|--------|-------|-------------|
| 1 | Landing | `/` | Everyone |
| 2 | Room Setup | `/room/[code]/setup` | Host only (redirects guests to lobby) |
| 3 | Lobby | `/room/[code]/lobby` | Everyone |
| 4 | Voting | `/room/[code]/vote` | Everyone |
| 5 | Match | `/room/[code]/match` | Everyone |
| 6 | No Match | `/room/[code]/done` | Everyone |

---

## Data Model (Prisma schema)

```prisma
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
  id               String    @id @default(uuid())
  code             String    @unique   // e.g. "XKCD-42"
  hostMemberId     String
  streamingServices String[]
  filters          Json?     // {genres[], maxRuntime, minRating, mood}
  status           RoomStatus @default(LOBBY)
  matchedMovieId   String?
  createdAt        DateTime  @default(now())
  expiresAt        DateTime
  members          Member[]
  queue            RoomQueue[]
  votes            Vote[]
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
  room         Room     @relation(fields: [roomId], references: [id])
  user         User?    @relation(fields: [userId], references: [id])
  votes        Vote[]
}

model RoomQueue {
  id              String @id @default(uuid())
  roomId          String
  tmdbMovieId     String
  position        Int
  streamingService String
  watchUrl        String
  room            Room   @relation(fields: [roomId], references: [id])

  @@unique([roomId, tmdbMovieId])
  @@index([roomId, position])
}

model Vote {
  id          String   @id @default(uuid())
  roomId      String
  memberId    String
  tmdbMovieId String
  vote        Boolean  // true=yes, false=no
  votedAt     DateTime @default(now())
  room        Room     @relation(fields: [roomId], references: [id])
  member      Member   @relation(fields: [memberId], references: [id])

  @@unique([roomId, memberId, tmdbMovieId])
  @@index([roomId, tmdbMovieId, vote])
}
```

**Key decisions:**
- Movie metadata is never stored — always fetched fresh from TMDB (no staleness)
- Anonymous users get a `sessionToken` cookie — identical UX to signed-in users
- Rooms expire after 24 hours (`expiresAt`)
- `filters` stored as JSONB for flexibility without schema migrations

---

## API Routes

All under `/app/api/` (Next.js App Router):

```
POST   /api/rooms                         Create room → returns {code}
GET    /api/rooms/[code]                  Get room state {status, members, matchedMovie}
PATCH  /api/rooms/[code]                  Update services/filters (host only)
POST   /api/rooms/[code]/start            Generate queue → transition to VOTING (host only)

POST   /api/rooms/[code]/members          Join room → sets session cookie → returns {memberId}
DELETE /api/rooms/[code]/members/me       Leave room

GET    /api/rooms/[code]/queue            Next unvoted movie for this member (by session)
POST   /api/rooms/[code]/votes            Submit vote {tmdbMovieId, vote: bool} → runs match check

GET    /api/rooms/[code]/poll             Lightweight poll → {status, memberCount, matchedMovie}
                                           Called every 3s during voting
```

---

## Match / Voting Logic

**`POST /api/rooms/[code]/votes` flow:**

1. Validate session token → resolve `memberId`
2. Upsert vote row (idempotent on retry)
3. If `vote = true`, run match check:

```sql
SELECT tmdb_movie_id
FROM votes
WHERE room_id = $roomId
  AND tmdb_movie_id = $movieId
  AND vote = true
GROUP BY tmdb_movie_id
HAVING COUNT(*) = (
  SELECT COUNT(*) FROM members
  WHERE room_id = $roomId
    AND last_seen_at > NOW() - INTERVAL '5 minutes'  -- skip inactive members
)
```

4. If match found → `UPDATE rooms SET status='MATCHED', matched_movie_id=... WHERE id=...`
5. Return `{matched: true, movie: ...}` — client skips polling and jumps to match screen immediately

**`GET /api/rooms/[code]/queue` flow:**

1. Find the lowest-position movie in `room_queue` for this room that this member hasn't voted on yet
2. Fetch metadata from TMDB for that `tmdbMovieId`
3. Return `{movie: {...tmdbFields, watchUrl, streamingService}, remaining: N}`

**Queue generation (`POST /api/rooms/[code]/start`):**

1. Call TMDB `/discover/movie` with streaming services mapped to TMDB `with_watch_providers` IDs
2. Apply filters (genre IDs, max runtime, min vote_average)
3. Paginate up to 60 results, shuffle, store as `RoomQueue` rows
4. Transition room to `VOTING`
5. Return `{queueSize: N}` — show count in lobby before start

---

## Streaming Services (MVP set)

| Display name | TMDB provider ID | JustWatch region |
|---|---|---|
| Netflix | 8 | US |
| Amazon Prime | 9 | US |
| Disney+ | 337 | US |
| HBO Max | 1899 | US |
| Hulu | 15 | US |
| Apple TV+ | 350 | US |

Start US-only. Region expansion is Phase 2.

---

## Build Order

### Phase 1 — Core loop (ship this)
1. Project setup: Next.js + Prisma + PostgreSQL + Tailwind
2. DB schema + migrations
3. Room creation + join (anonymous session cookie flow)
4. Streaming service selection UI (host setup screen)
5. TMDB integration: queue generation
6. Lobby screen (share link, member list)
7. Voting screen (Tinder-style cards, swipe/tap Yes/No)
8. Vote submission + match detection
9. Poll endpoint wired to voting screen
10. Match screen (celebration + Watch Now link)
11. No-match screen (queue exhausted)

### Phase 2 — Polish + retention
- Optional account sign-up (save services + filters)
- Genre / mood / runtime / rating filters UI
- Queue size preview before host starts ("23 movies match")
- Room expiry cleanup cron job
- Open Graph tags for share links

### Phase 3 — Growth
- Match history for signed-in users
- "Skip movies I've already seen" toggle
- Multiple rounds without leaving the room
- Region selection for streaming availability

---

## Product Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| TMDB/JustWatch streaming data stale | Add "report broken link" button; cache TMDB responses server-side (1hr TTL) |
| Solo host starts voting alone | Require minimum 2 active members before Start button enables |
| Member drops mid-session | Match check uses `last_seen_at > NOW() - 5min` to skip inactive members; show "X waiting on Jordan" UI |
| Queue too small (narrow filters) | Show queue size preview in lobby before start; suggest loosening filters if < 5 movies |
| Room code collisions | Generate code with DB uniqueness constraint + retry loop (max 5 attempts) |
| TMDB rate limits (50 req/s free) | Server-side in-memory cache for movie metadata; batch queue generation in one paginated fetch |
| Mobile swipe UX | Voting card component needs real touch events (touchstart/touchend delta), not just button taps |
| Simultaneous match on last vote | Match detection runs inside a DB transaction; idempotent upsert prevents double-match |

---

## Verification Plan

1. Create a room, copy the join link, open in a second browser tab as a guest
2. Host selects Netflix + HBO, leaves filters empty, clicks Start
3. Verify lobby shows 2 members and queue size > 0
4. Both users vote Yes on the same movie → confirm match screen appears in both tabs within ~3s
5. Click Watch Now → confirm link opens correct streaming platform
6. Test no-match path: both users vote No on all movies → confirm no-match screen with suggestions
7. Test dropout: guest closes tab mid-voting → confirm host can still get a match after 5min timeout

---

## File Structure (planned)

```
app/
  page.tsx                    — Landing
  room/
    [code]/
      setup/page.tsx          — Room Setup (host)
      lobby/page.tsx          — Lobby
      vote/page.tsx           — Voting
      match/page.tsx          — Match
      done/page.tsx           — No Match
  api/
    rooms/
      route.ts                — POST /api/rooms
      [code]/
        route.ts              — GET/PATCH
        start/route.ts
        members/route.ts
        queue/route.ts
        votes/route.ts
        poll/route.ts

lib/
  tmdb.ts                     — TMDB API client + cache
  prisma.ts                   — Prisma client singleton
  room-code.ts                — Room code generation
  match.ts                    — Match detection query
  session.ts                  — Session cookie helpers

prisma/
  schema.prisma
  migrations/

components/
  VotingCard.tsx
  StreamingServicePicker.tsx
  MemberList.tsx
  MatchCelebration.tsx
```
