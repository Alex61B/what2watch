import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken, clearSessionCookie } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'

export async function GET(
  request: Request,
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
      console.warn('[poll] returning 401', { reason: 'unauthorized_no_session', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    console.log('[poll] member lookup', { roomCode, found: !!member })
    if (!member) {
      console.warn('[poll] returning 401', { reason: 'unauthorized_no_member', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[poll] request', {
      roomCode,
      memberId: member.id,
      userId: member.userId,
      timestamp: new Date().toISOString(),
    })

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    console.log('[poll] room lookup', { roomCode, found: !!room })
    if (!room) {
      console.warn('[poll] returning 404', { reason: 'room_not_found', roomCode })
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }
    if (room.id !== member.roomId) {
      // The session cookie for this room code resolves to a member of a
      // different room — a stale/forged cookie. Clear it and signal clearly
      // instead of masquerading as a missing room.
      console.warn('[poll] returning 403', {
        reason: 'wrong_room',
        roomCode,
        memberId: member.id,
        memberRoomId: member.roomId,
        foundRoomId: room.id,
      })
      const res = NextResponse.json(
        { error: 'This session belongs to a different room', reason: 'wrong_room' },
        { status: 403 }
      )
      clearSessionCookie(res, code)
      return res
    }

    stage = 'etag-check'
    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch && ifNoneMatch.replace(/"/g, '') === String(room.queueVersion)) {
      await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })
      console.log('[poll] 304', { roomId: room.id, queueVersion: room.queueVersion, memberId: member.id })
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: `"${room.queueVersion}"` },
      })
    }

    stage = 'heartbeat'
    await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

    stage = 'member-count'
    const memberCount = await prisma.member.count({
      where: { roomId: room.id, leftAt: null },
    })

    stage = 'member-list'
    const members = await prisma.member.findMany({
      where: { roomId: room.id, leftAt: null },
      select: { id: true, displayName: true, isHost: true },
      orderBy: { joinedAt: 'asc' },
    })

    stage = 'matched-movie'
    let matchedMovie = null
    if (room.matchedMovieId) {
      try {
        const movie = await getMovieById(room.matchedMovieId)
        const queueEntry = await prisma.roomQueue.findUnique({
          where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: room.matchedMovieId } },
        })
        matchedMovie = { ...movie, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService }
      } catch (err) {
        console.error('[poll] matched movie tmdb fetch failed', {
          roomId: room.id,
          matchedMovieId: room.matchedMovieId,
          message: err instanceof Error ? err.message : String(err),
        })
        matchedMovie = { tmdbId: room.matchedMovieId }
      }
    }

    stage = 'rejected-ids'
    const rejectedMovieIds = await prisma.vote.findMany({
      where: { roomId: room.id, vote: false },
      select: { tmdbMovieId: true },
      distinct: ['tmdbMovieId'],
    }).then(rows => rows.map(r => r.tmdbMovieId))

    stage = 'current-entry'
    const queueLength = await prisma.roomQueue.count({ where: { roomId: room.id } })
    const currentEntry = await prisma.roomQueue.findFirst({
      where: { roomId: room.id, position: room.currentPosition },
      select: { tmdbMovieId: true, watchUrl: true, streamingService: true },
    })
    console.log('[queue]', {
      roomId: room.id,
      currentPosition: room.currentPosition,
      queueVersion: room.queueVersion,
      queueLength,
      op: 'poll_read',
    })

    stage = 'current-movie-tmdb'
    let currentMovie = null
    if (currentEntry) {
      try {
        const movie = await getMovieById(currentEntry.tmdbMovieId)
        currentMovie = { ...movie, watchUrl: currentEntry.watchUrl, streamingService: currentEntry.streamingService }
      } catch (err) {
        console.error('[poll] current movie tmdb fetch failed', {
          roomId: room.id,
          tmdbMovieId: currentEntry.tmdbMovieId,
          message: err instanceof Error ? err.message : String(err),
        })
        currentMovie = {
          tmdbId: currentEntry.tmdbMovieId,
          watchUrl: currentEntry.watchUrl,
          streamingService: currentEntry.streamingService,
        }
      }
    }

    // TEMP DEBUG: trace exactly what each member's poll resolves to (host vs. 2nd user).
    console.log('[poll] response', {
      roomCode,
      memberId: member.id,
      isHost: member.isHost,
      userId: member.userId,
      status: room.status,
      currentPosition: room.currentPosition,
      queueVersion: room.queueVersion,
      currentMovieId: currentMovie?.tmdbId ?? null,
      currentMovieTitle: (currentMovie as { title?: string } | null)?.title ?? null,
      memberCount,
    })

    return NextResponse.json(
      {
        status: room.status,
        name: room.name,
        memberCount,
        members,
        matchedMovie,
        rejectedMovieIds,
        watchedFilter: room.watchedFilter,
        currentPosition: room.currentPosition,
        queueVersion: room.queueVersion,
        currentMovie,
        isHost: member.isHost,
      },
      {
        headers: { ETag: `"${room.queueVersion}"` },
      }
    )
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[poll] fatal error', {
      stage,
      roomCode,
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
    return NextResponse.json(
      { error: error.message, stack: error.stack, name: error.name, stage },
      { status: 500 }
    )
  }
}
