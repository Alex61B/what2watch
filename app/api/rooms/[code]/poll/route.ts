import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken, clearSessionCookie } from '@/lib/session'
import { getMovieById, getWatchProviders } from '@/lib/tmdb'

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }
    if (room.id !== member.roomId) {
      // The session cookie for this room code resolves to a member of a
      // different room — a stale/forged cookie. Clear it and signal clearly
      // instead of masquerading as a missing room.
      const res = NextResponse.json(
        { error: 'This session belongs to a different room', reason: 'wrong_room' },
        { status: 403 }
      )
      clearSessionCookie(res, code)
      return res
    }

    stage = 'etag-check'
    // The host and not-yet-approved members must always get a full response:
    // membership/approval changes don't bump queueVersion, so the 304 fast-path
    // would otherwise hide pending requests (host) or the approval flip (joiner).
    const canShortCircuit = member.approved && !member.isHost
    const ifNoneMatch = request.headers.get('if-none-match')
    if (canShortCircuit && ifNoneMatch && ifNoneMatch.replace(/"/g, '') === String(room.queueVersion)) {
      await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: `"${room.queueVersion}"`, 'Cache-Control': 'no-store' },
      })
    }

    stage = 'heartbeat'
    await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

    stage = 'member-count'
    const memberCount = await prisma.member.count({
      where: { roomId: room.id, leftAt: null, approved: true },
    })

    stage = 'member-list'
    const members = await prisma.member.findMany({
      where: { roomId: room.id, leftAt: null, approved: true },
      select: { id: true, displayName: true, isHost: true },
      orderBy: { joinedAt: 'asc' },
    })

    stage = 'pending-members'
    // Late joiners (joined during VOTING) awaiting the host's decision.
    const pendingMembers = await prisma.member.findMany({
      where: { roomId: room.id, leftAt: null, approved: false },
      select: { id: true, displayName: true },
      orderBy: { joinedAt: 'asc' },
    })
    // Flags for the requesting member's own approval state.
    const pendingApproval = !member.approved && !member.leftAt
    const notAdmitted = !member.approved && !!member.leftAt

    stage = 'matched-movie'
    let matchedMovie = null
    if (room.matchedMovieId) {
      try {
        const movie = await getMovieById(room.matchedMovieId)
        const queueEntry = await prisma.roomQueue.findUnique({
          where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: room.matchedMovieId } },
        })
        let watchProviders = { providers: [], link: null } as Awaited<ReturnType<typeof getWatchProviders>>
        try {
          watchProviders = await getWatchProviders(room.matchedMovieId)
        } catch (provErr) {
          console.error('[poll] watch providers fetch failed (non-fatal)', {
            roomId: room.id,
            matchedMovieId: room.matchedMovieId,
            message: provErr instanceof Error ? provErr.message : String(provErr),
          })
        }
        matchedMovie = { ...movie, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService, watchProviders }
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
    const currentEntry = await prisma.roomQueue.findFirst({
      where: { roomId: room.id, position: room.currentPosition },
      select: { tmdbMovieId: true, watchUrl: true, streamingService: true },
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

    return NextResponse.json(
      {
        status: room.status,
        name: room.name,
        memberCount,
        members,
        pendingMembers,
        pendingApproval,
        notAdmitted,
        matchedMovie,
        rejectedMovieIds,
        watchedFilter: room.watchedFilter,
        currentPosition: room.currentPosition,
        queueVersion: room.queueVersion,
        currentMovie,
        isHost: member.isHost,
      },
      {
        headers: { ETag: `"${room.queueVersion}"`, 'Cache-Control': 'no-store' },
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
