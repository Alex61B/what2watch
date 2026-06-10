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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    if (!room || room.id !== member.roomId) {
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
    const notInClause = excludedIds.length ? excludedIds : ['__none__']

    stage = 'member-queue-find'
    const memberQueueEntry = await prisma.memberQueue.findFirst({
      where: { memberId: member.id, tmdbMovieId: { notIn: notInClause } },
      orderBy: { position: 'asc' },
    })

    if (!memberQueueEntry) {
      return NextResponse.json(null)
    }

    stage = 'room-queue-lookup'
    const nextEntry = await prisma.roomQueue.findUnique({
      where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: memberQueueEntry.tmdbMovieId } },
    })

    if (!nextEntry) {
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
