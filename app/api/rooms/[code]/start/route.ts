import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { discoverMovies, STREAMING_SERVICES, type ServiceId } from '@/lib/tmdb'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken()
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member?.isHost) {
    return NextResponse.json({ error: 'Only the host can start the session' }, { status: 403 })
  }

  const room = await prisma.room.findUnique({
    where: { code },
    include: { members: { where: { leftAt: null } } },
  })

  if (!room || room.id !== member.roomId) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (room.status !== 'LOBBY') {
    return NextResponse.json({ error: 'Room has already started' }, { status: 409 })
  }
  if (room.members.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 members to start' }, { status: 400 })
  }
  if (room.streamingServices.length === 0) {
    return NextResponse.json({ error: 'Select at least one streaming service' }, { status: 400 })
  }

  // Validate that all service IDs are known ServiceIds
  const validServiceIds = STREAMING_SERVICES.map(s => s.id)
  const serviceIds = room.streamingServices.filter(
    (s): s is ServiceId => validServiceIds.includes(s as ServiceId)
  )

  const filters = (room.filters ?? {}) as { genres?: number[]; maxRuntime?: number; minRating?: number }

  let movies
  try {
    movies = await discoverMovies(serviceIds, filters, 60)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Failed to fetch movies: ${message}` }, { status: 502 })
  }

  if (movies.length === 0) {
    return NextResponse.json(
      { error: 'No movies found for these services and filters. Try broadening your filters.' },
      { status: 422 }
    )
  }

  const shuffled = shuffle(movies)

  await prisma.$transaction([
    prisma.room.update({ where: { id: room.id }, data: { status: 'VOTING' } }),
    prisma.roomQueue.createMany({
      data: shuffled.map((movie, position) => ({
        roomId: room.id,
        tmdbMovieId: movie.tmdbId,
        position,
        streamingService: serviceIds[0],
        watchUrl: `https://www.themoviedb.org/movie/${movie.tmdbId}`,
      })),
      skipDuplicates: true,
    }),
  ])

  return NextResponse.json({ queueSize: shuffled.length })
}
