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
