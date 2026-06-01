import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'

export async function GET(
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
      console.warn('[queue-route] returning 401', { reason: 'unauthorized_no_session', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    console.log('[queue-route] member lookup', { roomCode, found: !!member })
    if (!member) {
      console.warn('[queue-route] returning 401', { reason: 'unauthorized_no_member', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[queue-route] request', {
      roomCode,
      memberId: member.id,
      userId: member.userId,
      timestamp: new Date().toISOString(),
    })

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    console.log('[queue-route] room lookup', { roomCode, found: !!room })
    if (!room || room.id !== member.roomId) {
      console.warn('[queue-route] returning 404', {
        reason: 'room_not_found',
        roomCode,
        memberId: member.id,
        memberRoomId: member.roomId,
        foundRoomId: room?.id ?? null,
      })
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    stage = 'heartbeat'
    await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

    stage = 'excluded-ids'
    const votedIds = await prisma.vote.findMany({
      where: { roomId: room.id, memberId: member.id },
      select: { tmdbMovieId: true },
    }).then(rows => rows.map(r => r.tmdbMovieId))

    const rejectedIds = await prisma.vote.findMany({
      where: { roomId: room.id, vote: false },
      select: { tmdbMovieId: true },
      distinct: ['tmdbMovieId'],
    }).then(rows => rows.map(r => r.tmdbMovieId))

    let watchedIds: string[]
    if (room.watchedFilter) {
      const where = member.userId
        ? { OR: [{ member: { roomId: room.id } }, { member: { userId: member.userId } }] }
        : { member: { roomId: room.id } }
      watchedIds = await prisma.watchedMovie.findMany({
        where,
        select: { tmdbMovieId: true },
        distinct: ['tmdbMovieId'],
      }).then(rows => rows.map(r => r.tmdbMovieId))
    } else {
      watchedIds = await prisma.watchedMovie.findMany({
        where: { memberId: member.id },
        select: { tmdbMovieId: true },
      }).then(rows => rows.map(r => r.tmdbMovieId))
    }

    const excludedIds = [...new Set([...votedIds, ...rejectedIds, ...watchedIds])]
    console.log('[queue-route] excluded', {
      roomId: room.id,
      memberId: member.id,
      votedCount: votedIds.length,
      rejectedCount: rejectedIds.length,
      watchedCount: watchedIds.length,
      totalExcluded: excludedIds.length,
    })
    const notInClause = excludedIds.length ? excludedIds : ['__none__']

    stage = 'member-queue-find'
    const memberQueueEntry = await prisma.memberQueue.findFirst({
      where: { memberId: member.id, tmdbMovieId: { notIn: notInClause } },
      orderBy: { position: 'asc' },
    })

    if (!memberQueueEntry) {
      console.warn('[queue-route] returning 200 null', {
        reason: 'no_eligible_movie_in_member_queue',
        roomId: room.id,
        memberId: member.id,
        excludedCount: excludedIds.length,
      })
      return NextResponse.json(null)
    }

    stage = 'room-queue-lookup'
    const nextEntry = await prisma.roomQueue.findUnique({
      where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: memberQueueEntry.tmdbMovieId } },
    })

    if (!nextEntry) {
      console.warn('[queue-route] returning 200 null', {
        reason: 'member_queue_entry_missing_from_room_queue',
        roomId: room.id,
        memberId: member.id,
        tmdbMovieId: memberQueueEntry.tmdbMovieId,
      })
      return NextResponse.json(null)
    }

    stage = 'remaining-count'
    const remaining = await prisma.memberQueue.count({
      where: { memberId: member.id, tmdbMovieId: { notIn: notInClause } },
    })

    stage = 'tmdb-fetch'
    let movie
    try {
      movie = await getMovieById(nextEntry.tmdbMovieId)
    } catch (err) {
      console.error('[queue-route] tmdb fetch failed, returning null', {
        roomId: room.id,
        tmdbMovieId: nextEntry.tmdbMovieId,
        message: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(null)
    }

    console.log('[queue-route] success', {
      roomId: room.id,
      memberId: member.id,
      tmdbMovieId: nextEntry.tmdbMovieId,
      remaining,
    })

    return NextResponse.json({
      movie: { ...movie, watchUrl: nextEntry.watchUrl, streamingService: nextEntry.streamingService },
      remaining,
    })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[queue-route] fatal error', {
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
