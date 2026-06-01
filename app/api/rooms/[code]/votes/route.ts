import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { checkForMatch } from '@/lib/match'
import { getMovieById } from '@/lib/tmdb'
import { advanceQueueAtomic } from '@/lib/queue'
import { resolveMemberUserId } from '@/lib/link'
import { addPreference } from '@/lib/preferences'

export async function POST(
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
      console.warn('[votes] returning 401', { reason: 'unauthorized_no_session', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    console.log('[votes] member lookup', { roomCode, found: !!member })
    if (!member) {
      console.warn('[votes] returning 401', { reason: 'unauthorized_no_member', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[votes] request', {
      roomCode,
      memberId: member.id,
      userId: member.userId,
      timestamp: new Date().toISOString(),
    })

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    console.log('[votes] room lookup', { roomCode, found: !!room, status: room?.status ?? null })
    if (!room || room.id !== member.roomId) {
      console.warn('[votes] returning 404', {
        reason: 'room_not_found',
        roomCode,
        memberId: member.id,
        memberRoomId: member.roomId,
        foundRoomId: room?.id ?? null,
      })
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }
    if (room.status !== 'VOTING') {
      console.warn('[votes] returning 409', {
        reason: 'room_wrong_state',
        roomCode,
        actual: room.status,
        required: 'VOTING',
      })
      return NextResponse.json({ error: 'Room is not in voting state' }, { status: 409 })
    }

    stage = 'body-parse'
    const body = await request.json().catch(() => ({}))
    const { tmdbMovieId, vote } = body
    if (!tmdbMovieId || typeof vote !== 'boolean') {
      console.warn('[votes] returning 400', {
        reason: 'bad_request_missing_field',
        roomCode,
        hasTmdbMovieId: typeof tmdbMovieId === 'string',
        voteType: typeof vote,
      })
      return NextResponse.json(
        { error: 'tmdbMovieId (string) and vote (boolean) are required' },
        { status: 400 }
      )
    }

    stage = 'staleness-check'
    const currentEntry = await prisma.roomQueue.findFirst({
      where: { roomId: room.id, position: room.currentPosition },
      select: { tmdbMovieId: true },
    })
    const queueLength = await prisma.roomQueue.count({ where: { roomId: room.id } })
    console.log('[queue]', {
      roomId: room.id,
      currentPosition: room.currentPosition,
      queueVersion: room.queueVersion,
      queueLength,
      op: 'vote_staleness_check',
    })

    if (!currentEntry || currentEntry.tmdbMovieId !== tmdbMovieId) {
      console.warn('[votes] returning 409', {
        reason: 'stale_vote',
        roomCode,
        memberId: member.id,
        submittedMovieId: tmdbMovieId,
        currentMovieId: currentEntry?.tmdbMovieId ?? null,
        currentPosition: room.currentPosition,
        queueVersion: room.queueVersion,
      })
      return NextResponse.json(
        {
          error: 'Stale vote',
          currentPosition: room.currentPosition,
          queueVersion: room.queueVersion,
          currentMovieId: currentEntry?.tmdbMovieId ?? null,
        },
        { status: 409 }
      )
    }

    stage = 'vote-upsert'
    console.log('[vote]', {
      roomId: room.id,
      movieId: tmdbMovieId,
      vote,
      memberId: member.id,
    })
    await prisma.vote.upsert({
      where: { roomId_memberId_tmdbMovieId: { roomId: room.id, memberId: member.id, tmdbMovieId } },
      create: { roomId: room.id, memberId: member.id, tmdbMovieId, vote },
      update: { vote },
    })

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
      stage = 'advance-no'
      const advance = await advanceQueueAtomic(room.id, room.currentPosition, room.queueVersion)
      console.log('[votes] advance', {
        roomId: room.id,
        trigger: 'no',
        result: advance.advanced ? 'advanced' : advance.reason.toLowerCase(),
        memberId: member.id,
      })
      return NextResponse.json({ matched: false, advance })
    }

    stage = 'check-match'
    const matchedMovieId = await checkForMatch(room.id, tmdbMovieId)
    console.log('[votes] match check', {
      roomId: room.id,
      tmdbMovieId,
      matched: !!matchedMovieId,
    })
    if (!matchedMovieId) return NextResponse.json({ matched: false })

    stage = 'match-fetch'
    const queueEntry = await prisma.roomQueue.findUnique({
      where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: matchedMovieId } },
    })

    let matchedMovie = null
    try {
      const movie = await getMovieById(matchedMovieId)
      matchedMovie = { ...movie, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService }
    } catch (err) {
      console.error('[votes] matched movie tmdb fetch failed', {
        roomId: room.id,
        matchedMovieId,
        message: err instanceof Error ? err.message : String(err),
      })
      matchedMovie = { tmdbId: matchedMovieId, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService }
    }

    stage = 'advance-match'
    const advance = await advanceQueueAtomic(room.id, room.currentPosition, room.queueVersion)
    console.log('[votes] advance', {
      roomId: room.id,
      trigger: 'match',
      result: advance.advanced ? 'advanced' : advance.reason.toLowerCase(),
      memberId: member.id,
      matchedMovieId,
    })

    return NextResponse.json({ matched: true, movie: matchedMovie, advance })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[votes] fatal error', {
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
