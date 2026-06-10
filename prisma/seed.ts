/**
 * Dev seed — login-able test profiles + sample social/list data.
 *
 * Creates 4 credential-login users (password `password123`) with saved streaming
 * services + filters, a shared MovieCache (fetched live from TMDB so posters are
 * real), per-user watchlist / seen-before lists with deliberate overlaps, and a
 * friendship graph. Everything is upserted, so the script is safe to re-run.
 *
 * Run (no package.json changes required):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
 *     npx ts-node --transpile-only prisma/seed.ts
 *
 * Requires DATABASE_URL (always) and TMDB_API_KEY (for real posters) in .env.local.
 */
import { config } from 'dotenv'
import bcrypt from 'bcryptjs'
import type { Prisma } from '@prisma/client'

// Load .env.local before anything imports lib/prisma (it builds the pg Pool from
// DATABASE_URL at module-eval time). lib/prisma is therefore dynamically imported
// inside main(), after this runs.
config({ path: '.env.local' })

const PASSWORD = 'password123'

// TMDB v4 read access — same auth + image base the app uses (lib/tmdb.ts).
const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

interface SeedUser {
  email: string
  displayName: string
  savedServices: string[]
  savedFilters: Prisma.InputJsonValue // DiscoverFilters shape: genres/maxRuntime/minRating/maxRating/depth
  watchlist: string[] // tmdb ids
  seen: string[] // tmdb ids
}

// Canonical TMDB ids; titles/posters/etc. are sourced live so only ids must be right.
// 27205 Inception · 157336 Interstellar · 155 Dark Knight · 603 Matrix · 680 Pulp Fiction
// 13 Forrest Gump · 550 Fight Club · 278 Shawshank · 238 Godfather · 19995 Avatar
// 24428 Avengers · 122 LOTR: Return of the King
const MOVIE_IDS = [
  '27205', '157336', '155', '603', '680', '13',
  '550', '278', '238', '19995', '24428', '122',
]

// Lists are arranged so every ACCEPTED friendship has overlapping titles
// (watchlist↔watchlist and watchlist↔seen) for the friend-comparison view.
const USERS: SeedUser[] = [
  {
    email: 'alice@test.dev',
    displayName: 'Alice',
    savedServices: ['netflix', 'prime', 'hbo'],
    savedFilters: { genres: [878, 18], minRating: 7, depth: 3 }, // Sci-Fi, Drama
    watchlist: ['27205', '157336', '603', '550'],
    seen: ['155', '278', '238'],
  },
  {
    email: 'bob@test.dev',
    displayName: 'Bob',
    savedServices: ['netflix', 'disney', 'hulu'],
    savedFilters: { genres: [28, 12], minRating: 6, maxRuntime: 150, depth: 2 }, // Action, Adventure
    watchlist: ['155', '19995', '24428', '122'],
    seen: ['603', '680', '13'],
  },
  {
    email: 'carol@test.dev',
    displayName: 'Carol',
    savedServices: ['prime', 'apple'],
    savedFilters: { genres: [18, 10749], minRating: 7.5, depth: 4 }, // Drama, Romance
    watchlist: ['278', '13', '680', '157336'],
    seen: ['27205', '550', '122'],
  },
  {
    email: 'dave@test.dev',
    displayName: 'Dave',
    savedServices: ['netflix', 'hbo', 'disney', 'hulu'],
    savedFilters: { genres: [27, 53, 80], depth: 1 }, // Horror, Thriller, Crime
    watchlist: ['238', '603', '24428'],
    seen: ['19995', '155', '13'],
  },
]

// requester → receiver. Alice/Bob/Carol are a mutual ACCEPTED trio; Carol↔Dave
// ACCEPTED; Dave→Alice left PENDING so the incoming-request UI has something to show.
const FRIENDSHIPS: { requester: string; receiver: string; status: 'ACCEPTED' | 'PENDING' }[] = [
  { requester: 'alice@test.dev', receiver: 'bob@test.dev', status: 'ACCEPTED' },
  { requester: 'alice@test.dev', receiver: 'carol@test.dev', status: 'ACCEPTED' },
  { requester: 'bob@test.dev', receiver: 'carol@test.dev', status: 'ACCEPTED' },
  { requester: 'carol@test.dev', receiver: 'dave@test.dev', status: 'ACCEPTED' },
  { requester: 'dave@test.dev', receiver: 'alice@test.dev', status: 'PENDING' },
]

interface FetchedMovie {
  tmdbMovieId: string
  title: string
  posterUrl: string
  year: number
  overview: string
  rating: number
}

async function fetchMovie(id: string): Promise<FetchedMovie | null> {
  const key = process.env.TMDB_API_KEY
  if (!key || key === 'your_tmdb_api_key_here') {
    console.warn(`  ⚠ TMDB_API_KEY not set — skipping MovieCache for ${id}`)
    return null
  }
  try {
    const res = await fetch(`${TMDB_BASE}/movie/${id}?language=en-US`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) {
      console.warn(`  ⚠ TMDB ${id} → HTTP ${res.status}; no MovieCache row written`)
      return null
    }
    const d = (await res.json()) as {
      title: string
      poster_path: string | null
      release_date: string
      overview: string
      vote_average: number
    }
    return {
      tmdbMovieId: id,
      title: d.title,
      posterUrl: d.poster_path ? `${TMDB_IMAGE_BASE}${d.poster_path}` : '',
      year: d.release_date ? Number(d.release_date.slice(0, 4)) : 0,
      overview: d.overview ?? '',
      rating: d.vote_average ?? 0,
    }
  } catch (err) {
    console.warn(`  ⚠ TMDB ${id} fetch failed (${(err as Error).message}); no MovieCache row`)
    return null
  }
}

async function main() {
  // Dynamic import: env must be loaded first (see note above).
  const { prisma } = await import('../lib/prisma')

  const passwordHash = await bcrypt.hash(PASSWORD, 12) // cost 12 — matches app/api/auth/signup

  console.log('Seeding test profiles…\n')

  // 1) Users
  const userIdByEmail = new Map<string, string>()
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        displayName: u.displayName,
        savedServices: u.savedServices,
        savedFilters: u.savedFilters,
        passwordHash,
      },
      create: {
        email: u.email,
        displayName: u.displayName,
        savedServices: u.savedServices,
        savedFilters: u.savedFilters,
        passwordHash,
      },
    })
    userIdByEmail.set(u.email, user.id)
    console.log(`  ✓ user ${u.displayName} <${u.email}>`)
  }

  // 2) MovieCache (real metadata + posters from TMDB)
  console.log('\nFetching movie metadata from TMDB…')
  for (const id of MOVIE_IDS) {
    const m = await fetchMovie(id)
    if (!m) continue
    await prisma.movieCache.upsert({
      where: { tmdbMovieId: m.tmdbMovieId },
      update: {
        title: m.title,
        posterUrl: m.posterUrl,
        year: m.year,
        overview: m.overview,
        rating: m.rating,
      },
      create: m,
    })
    console.log(`  ✓ ${m.title} (${m.year || 'n/a'})`)
  }

  // 3) Watchlist / seen-before preferences
  console.log('\nSeeding watchlists & seen lists…')
  for (const u of USERS) {
    const userId = userIdByEmail.get(u.email)!
    const rows: { tmdbMovieId: string; type: 'WATCHLIST' | 'SEEN_BEFORE' }[] = [
      ...u.watchlist.map((tmdbMovieId) => ({ tmdbMovieId, type: 'WATCHLIST' as const })),
      ...u.seen.map((tmdbMovieId) => ({ tmdbMovieId, type: 'SEEN_BEFORE' as const })),
    ]
    for (const r of rows) {
      await prisma.userMoviePreference.upsert({
        where: { userId_tmdbMovieId_type: { userId, tmdbMovieId: r.tmdbMovieId, type: r.type } },
        update: {},
        create: { userId, tmdbMovieId: r.tmdbMovieId, type: r.type },
      })
    }
    console.log(`  ✓ ${u.displayName}: ${u.watchlist.length} watchlist, ${u.seen.length} seen`)
  }

  // 4) Friendships
  console.log('\nSeeding friendships…')
  for (const f of FRIENDSHIPS) {
    const requesterId = userIdByEmail.get(f.requester)!
    const receiverId = userIdByEmail.get(f.receiver)!
    await prisma.friendship.upsert({
      where: { requesterId_receiverId: { requesterId, receiverId } },
      update: { status: f.status },
      create: { requesterId, receiverId, status: f.status },
    })
    console.log(`  ✓ ${f.requester} → ${f.receiver} (${f.status})`)
  }

  console.log('\n✅ Seed complete. Log in with any of:')
  for (const u of USERS) console.log(`     ${u.email}  /  ${PASSWORD}`)
  console.log('\n   (Open separate browsers/incognito windows to be different users in one room.)')

  await prisma.$disconnect()
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\n❌ Seed failed:', err)
    process.exit(1)
  })
