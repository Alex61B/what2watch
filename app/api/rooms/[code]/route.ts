import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'
import { roomExpired, expiredRoomResponse } from '@/lib/room'
import { checkRateLimit, getClientIp, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit-db'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params

  // M1: throttle enumeration per IP. Checked before the DB lookup so probing non-existent codes is
  // also limited (otherwise 404s would be a free oracle for guessing the short code space).
  const rl = await checkRateLimit('room-get', getClientIp(request), RATE_LIMITS.roomGet)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSeconds)

  const room = await prisma.room.findUnique({
    where: { code },
    include: {
      members: {
        where: { leftAt: null },
        select: { id: true, displayName: true, isHost: true, lastSeenAt: true },
        orderBy: { joinedAt: 'asc' },
      },
    },
  })

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const sessionToken = await getSessionToken(code)
  const currentMember = sessionToken
    ? await prisma.member.findFirst({
        where: { sessionToken, roomId: room.id },
        select: { id: true, isHost: true },
      })
    : null

  // M1: non-members (incl. the pre-join share-link lobby) get existence + name + status only.
  // The roster, lastSeenAt, matched movie, and room config are members-only.
  if (!currentMember) {
    return NextResponse.json({
      code: room.code,
      name: room.name,
      status: room.status,
      expired: roomExpired(room),
      isCurrentUserHost: false,
      currentMemberId: null,
    })
  }

  let matchedMovie = null
  if (room.matchedMovieId) {
    try {
      const movie = await getMovieById(room.matchedMovieId)
      const queueEntry = await prisma.roomQueue.findUnique({
        where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: room.matchedMovieId } },
      })
      matchedMovie = { ...movie, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService }
    } catch {
      // TMDB fetch failed — return room state without matched movie details
    }
  }

  return NextResponse.json({
    code: room.code,
    name: room.name,
    status: room.status,
    streamingServices: room.streamingServices,
    filters: room.filters,
    watchedFilter: room.watchedFilter,
    members: room.members,
    matchedMovie,
    expired: roomExpired(room),
    isCurrentUserHost: currentMember.isHost,
    currentMemberId: currentMember.id,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken(code)
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member?.isHost) {
    return NextResponse.json({ error: 'Only the host can update the room' }, { status: 403 })
  }

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room || room.id !== member.roomId) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (roomExpired(room)) return expiredRoomResponse()

  const body = await request.json().catch(() => ({}))
  const updateData: Record<string, unknown> = {}
  if (Array.isArray(body.streamingServices)) updateData.streamingServices = body.streamingServices
  if (body.filters !== undefined) updateData.filters = body.filters
  if (typeof body.watchedFilter === 'boolean') updateData.watchedFilter = body.watchedFilter
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim()
    updateData.name = trimmed ? trimmed.slice(0, 60) : null
  }

  const updated = await prisma.room.update({
    where: { id: room.id },
    data: updateData,
  })

  return NextResponse.json({
    name: updated.name,
    streamingServices: updated.streamingServices,
    filters: updated.filters,
    watchedFilter: updated.watchedFilter,
  })
}
