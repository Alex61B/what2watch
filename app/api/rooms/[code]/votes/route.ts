import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { checkForMatch } from '@/lib/match'
import { getMovieById } from '@/lib/tmdb'
import { resolveMemberUserId } from '@/lib/link'
import { addPreference } from '@/lib/preferences'
import { roomExpired, expiredRoomResponse } from '@/lib/room'
import { logServerError, serverError } from '@/lib/api-error'

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
    if (roomExpired(room)) return expiredRoomResponse()
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

    stage = 'movie-in-queue'
    // Each member votes on their own card (from /queue), so there's no shared
    // "current card" to validate against — just confirm the movie is part of this
    // room's queue so we never persist a vote for a movie that isn't in play.
    const queueEntryForVote = await prisma.roomQueue.findUnique({
      where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId } },
      select: { tmdbMovieId: true },
    })
    if (!queueEntryForVote) {
      return NextResponse.json({ error: 'Movie is not in this room' }, { status: 409 })
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

    // A NO just records the down-vote. It's now a room-wide reject, so it drops
    // out of every member's upcoming deck — but it never moves anyone off the card
    // they're currently viewing (each member advances only on their own vote).
    if (!vote) {
      return NextResponse.json({ matched: false })
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

    return NextResponse.json({ matched: true, movie: matchedMovie })
  } catch (err) {
    logServerError('[votes]', { stage, roomCode }, err)
    return serverError(500)
  }
}
