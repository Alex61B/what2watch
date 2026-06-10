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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (member.leftAt || !member.approved) {
      return NextResponse.json({ error: 'You are not an approved member of this room' }, { status: 403 })
    }

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    if (!room || room.id !== member.roomId) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }
    if (room.status !== 'VOTING') {
      return NextResponse.json({ error: 'Room is not in voting state' }, { status: 409 })
    }

    stage = 'body-parse'
    const body = await request.json().catch(() => ({}))
    const { tmdbMovieId, vote } = body
    if (!tmdbMovieId || typeof vote !== 'boolean') {
      return NextResponse.json(
        { error: 'tmdbMovieId (string) and vote (boolean) are required' },
        { status: 400 }
      )
    }

    stage = 'staleness-check'
    // Re-read the room's live position/version: it may have advanced while we were
    // parsing the body. Validate the vote against the card that's actually current
    // now, and run the CAS advance below against these fresh values.
    const fresh = await prisma.room.findUnique({
      where: { id: room.id },
      select: { currentPosition: true, queueVersion: true, status: true },
    })
    if (!fresh || fresh.status !== 'VOTING') {
      return NextResponse.json({ error: 'Room is not in voting state' }, { status: 409 })
    }
    const currentEntry = await prisma.roomQueue.findFirst({
      where: { roomId: room.id, position: fresh.currentPosition },
      select: { tmdbMovieId: true },
    })

    if (!currentEntry || currentEntry.tmdbMovieId !== tmdbMovieId) {
      return NextResponse.json(
        {
          error: 'Stale vote',
          currentPosition: fresh.currentPosition,
          queueVersion: fresh.queueVersion,
          currentMovieId: currentEntry?.tmdbMovieId ?? null,
        },
        { status: 409 }
      )
    }

    stage = 'vote-upsert'
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
      const advance = await advanceQueueAtomic(room.id, fresh.currentPosition, fresh.queueVersion)
      return NextResponse.json({ matched: false, advance })
    }

    stage = 'check-match'
    const matchedMovieId = await checkForMatch(room.id, tmdbMovieId)
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
