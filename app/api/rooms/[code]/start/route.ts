import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { auth } from '@/auth'
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
  let stage = 'init'
  let roomCode: string | undefined
  try {
    stage = 'params'
    const { code } = await params
    roomCode = code

    stage = 'env-check'
    const envReport = {
      hasTmdbKey: Boolean(process.env.TMDB_API_KEY) && process.env.TMDB_API_KEY !== 'your_tmdb_api_key_here',
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasAuthSecret: Boolean(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    }
    console.log('[start] env', envReport)

    stage = 'session'
    const sessionToken = await getSessionToken()
    if (!sessionToken) {
      console.warn('[start] returning 401', { reason: 'unauthorized_no_session', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    console.log('[start] member lookup', { roomCode, found: !!member, isHost: !!member?.isHost })
    if (!member?.isHost) {
      console.warn('[start] returning 403', {
        reason: 'host_only',
        roomCode,
        memberId: member?.id ?? null,
      })
      return NextResponse.json({ error: 'Only the host can start the session' }, { status: 403 })
    }

    console.log('[start] request', {
      roomCode,
      memberId: member.id,
      userId: member.userId,
      timestamp: new Date().toISOString(),
    })

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({
      where: { code },
      include: { members: { where: { leftAt: null } } },
    })
    console.log('[start] room lookup', {
      roomCode,
      found: !!room,
      status: room?.status ?? null,
      memberCount: room?.members.length ?? 0,
    })

    if (!room || room.id !== member.roomId) {
      console.warn('[start] returning 404', {
        reason: 'room_not_found',
        roomCode,
        memberRoomId: member.roomId,
        foundRoomId: room?.id ?? null,
      })
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }
    if (room.status !== 'LOBBY') {
      console.warn('[start] returning 409', {
        reason: 'room_wrong_state',
        roomCode,
        actual: room.status,
        required: 'LOBBY',
      })
      return NextResponse.json({ error: 'Room has already started' }, { status: 409 })
    }
    if (room.members.length < 2) {
      console.warn('[start] returning 400', {
        reason: 'not_enough_members',
        roomCode,
        memberCount: room.members.length,
      })
      return NextResponse.json({ error: 'Need at least 2 members to start' }, { status: 400 })
    }
    if (room.streamingServices.length === 0) {
      console.warn('[start] returning 400', { reason: 'no_streaming_services', roomCode })
      return NextResponse.json({ error: 'Select at least one streaming service' }, { status: 400 })
    }

    stage = 'validate-services'
    const validServiceIds = STREAMING_SERVICES.map(s => s.id)
    const serviceIds = room.streamingServices.filter(
      (s): s is ServiceId => validServiceIds.includes(s as ServiceId)
    )
    if (serviceIds.length === 0) {
      console.warn('[start] returning 400', {
        reason: 'no_valid_streaming_services',
        roomCode,
        provided: room.streamingServices,
      })
      return NextResponse.json({ error: 'No valid streaming services found' }, { status: 400 })
    }

    const filters = (room.filters ?? {}) as { genres?: number[]; maxRuntime?: number; minRating?: number }

    stage = 'tmdb-discover'
    console.log('[start] calling discoverMovies', { roomId: room.id, serviceIds, filters })
    const movies = await discoverMovies(serviceIds, filters, 60)
    console.log('[start] discoverMovies returned', { roomId: room.id, count: movies.length })

    if (movies.length === 0) {
      console.warn('[start] returning 422', {
        reason: 'no_movies_found',
        roomCode,
        serviceIds,
        filters,
      })
      return NextResponse.json(
        { error: 'No movies found for these services and filters. Try broadening your filters.' },
        { status: 422 }
      )
    }

    stage = 'shuffle-and-persist'
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
    console.log('[queue]', {
      roomId: room.id,
      currentPosition: 0,
      queueVersion: 0,
      queueLength: shuffled.length,
      op: 'queue_initialized',
    })

    stage = 'member-queues'
    const movieIds = shuffled.map(m => m.tmdbId)
    const memberQueueRows = room.members.flatMap(m =>
      shuffle([...movieIds]).map((tmdbMovieId, position) => ({
        memberId: m.id,
        tmdbMovieId,
        position,
      }))
    )
    if (memberQueueRows.length > 0) {
      await prisma.memberQueue.createMany({ data: memberQueueRows, skipDuplicates: true })
    }

    stage = 'save-prefs'
    try {
      const session = await auth()
      if (session?.user?.id) {
        await prisma.user.update({
          where: { id: session.user.id },
          data: {
            savedServices: serviceIds,
            savedFilters: filters,
          },
        })
      }
    } catch (prefErr) {
      console.warn('[start] non-fatal: failed to save user prefs', {
        roomId: room.id,
        message: prefErr instanceof Error ? prefErr.message : String(prefErr),
      })
    }

    console.log('[start] success', { roomId: room.id, queueSize: shuffled.length })
    return NextResponse.json({ queueSize: shuffled.length })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[start] fatal error', {
      stage,
      roomCode,
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
    return NextResponse.json(
      {
        error: error.message,
        stack: error.stack,
        name: error.name,
        stage,
      },
      { status: 500 }
    )
  }
}
