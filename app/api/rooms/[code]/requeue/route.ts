import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { discoverMovies, STREAMING_SERVICES, type ServiceId, type DiscoverFilters } from '@/lib/tmdb'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Host-only mid-session requeue. After the host edits the room's filters
 * (persisted via PATCH /api/rooms/[code]), this re-discovers movies with the new
 * filters and rebuilds the queue AFTER the current card so the change applies to
 * what's left to vote on — without disturbing the movie the room is currently on
 * or any votes already cast. Bumps queueVersion so every client re-syncs.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  let stage = 'init'
  let roomCode: string | undefined
  try {
    stage = 'params'
    const { code } = await params
    roomCode = code

    stage = 'session'
    const sessionToken = await getSessionToken(code)
    if (!sessionToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    if (!member?.isHost) {
      return NextResponse.json({ error: 'Only the host can change filters' }, { status: 403 })
    }

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    if (!room || room.id !== member.roomId) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }
    if (room.status !== 'VOTING' && room.status !== 'DRAINED') {
      return NextResponse.json({ error: 'Room is not in a votable state' }, { status: 409 })
    }

    stage = 'validate-services'
    const validServiceIds = STREAMING_SERVICES.map((s) => s.id)
    const serviceIds = room.streamingServices.filter(
      (s): s is ServiceId => validServiceIds.includes(s as ServiceId)
    )
    if (serviceIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one streaming service' }, { status: 400 })
    }

    const filters = (room.filters ?? {}) as DiscoverFilters

    // New movies are appended after the current card (VOTING) or fill the empty
    // current slot to resume a drained room (DRAINED).
    const startPos = room.status === 'DRAINED' ? room.currentPosition : room.currentPosition + 1

    stage = 'excluded-ids'
    const rejectedIds = await prisma.vote
      .findMany({
        where: { roomId: room.id, vote: false },
        select: { tmdbMovieId: true },
        distinct: ['tmdbMovieId'],
      })
      .then((rows) => rows.map((r) => r.tmdbMovieId))

    // Movies already kept in the queue (current card + history) must not be
    // re-added (unique constraint) and shouldn't reappear.
    const keptIds = await prisma.roomQueue
      .findMany({
        where: { roomId: room.id, position: { lt: startPos } },
        select: { tmdbMovieId: true },
      })
      .then((rows) => rows.map((r) => r.tmdbMovieId))

    let watchedIds: string[] = []
    if (room.watchedFilter) {
      watchedIds = await prisma.watchedMovie
        .findMany({
          where: { member: { roomId: room.id } },
          select: { tmdbMovieId: true },
          distinct: ['tmdbMovieId'],
        })
        .then((rows) => rows.map((r) => r.tmdbMovieId))
    }

    const excluded = new Set([...rejectedIds, ...keptIds, ...watchedIds])

    stage = 'tmdb-discover'
    const discovered = await discoverMovies(serviceIds, filters, 60)
    const fresh = shuffle(discovered.filter((m) => !excluded.has(m.tmdbId)))

    if (fresh.length === 0) {
      return NextResponse.json({ requeued: false, added: 0 })
    }

    stage = 'rebuild'
    await prisma.$transaction([
      prisma.roomQueue.deleteMany({
        where: { roomId: room.id, position: { gte: startPos } },
      }),
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
      prisma.room.update({
        where: { id: room.id },
        data: {
          status: 'VOTING',
          queueVersion: { increment: 1 },
          // If the room had drained, currentPosition already points at startPos.
          ...(room.status === 'DRAINED' ? { currentPosition: startPos } : {}),
        },
      }),
    ])

    return NextResponse.json({ requeued: true, added: fresh.length })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[requeue] fatal error', {
      stage,
      roomCode,
      name: error.name,
      message: error.message,
    })
    return NextResponse.json({ error: error.message, stage }, { status: 500 })
  }
}
