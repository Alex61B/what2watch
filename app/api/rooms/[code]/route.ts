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
        where: { leftAt: null },
        select: { id: true, displayName: true, isHost: true, lastSeenAt: true },
        orderBy: { joinedAt: 'asc' },
      },
    },
  })

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const sessionToken = await getSessionToken()
  const currentMember = sessionToken
    ? await prisma.member.findFirst({
        where: { sessionToken, roomId: room.id },
        select: { id: true, isHost: true },
      })
    : null

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
    status: room.status,
    streamingServices: room.streamingServices,
    filters: room.filters,
    watchedFilter: room.watchedFilter,
    members: room.members,
    matchedMovie,
    isCurrentUserHost: currentMember?.isHost ?? false,
    currentMemberId: currentMember?.id ?? null,
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
  if (!member?.isHost) {
    return NextResponse.json({ error: 'Only the host can update the room' }, { status: 403 })
  }

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room || room.id !== member.roomId) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const updateData: Record<string, unknown> = {}
  if (Array.isArray(body.streamingServices)) updateData.streamingServices = body.streamingServices
  if (body.filters !== undefined) updateData.filters = body.filters
  if (typeof body.watchedFilter === 'boolean') updateData.watchedFilter = body.watchedFilter

  const updated = await prisma.room.update({
    where: { id: room.id },
    data: updateData,
  })

  return NextResponse.json({
    streamingServices: updated.streamingServices,
    filters: updated.filters,
    watchedFilter: updated.watchedFilter,
  })
}
