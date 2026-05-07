import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken()
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room || room.id !== member.roomId) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  // Update lastSeenAt so inactive-member detection works
  await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

  // Movies this member has already voted on
  const votedIds = await prisma.vote.findMany({
    where: { roomId: room.id, memberId: member.id },
    select: { tmdbMovieId: true },
  }).then(rows => rows.map(r => r.tmdbMovieId))

  // Globally rejected: any NO vote by any member in this room
  const rejectedIds = await prisma.vote.findMany({
    where: { roomId: room.id, vote: false },
    select: { tmdbMovieId: true },
    distinct: ['tmdbMovieId'],
  }).then(rows => rows.map(r => r.tmdbMovieId))

  // Watched: conditional based on room.watchedFilter setting
  let watchedIds: string[]
  if (room.watchedFilter) {
    // Room-wide: exclude movies watched by anyone in this room
    const roomWatched = await prisma.watchedMovie.findMany({
      where: { member: { roomId: room.id } },
      select: { tmdbMovieId: true },
      distinct: ['tmdbMovieId'],
    }).then(rows => rows.map(r => r.tmdbMovieId))

    // Cross-room: if logged in, also exclude movies watched in any previous room
    const crossRoomWatched = member.userId
      ? await prisma.watchedMovie.findMany({
          where: { member: { userId: member.userId } },
          select: { tmdbMovieId: true },
          distinct: ['tmdbMovieId'],
        }).then(rows => rows.map(r => r.tmdbMovieId))
      : []

    watchedIds = [...new Set([...roomWatched, ...crossRoomWatched])]
  } else {
    // Personal only: exclude movies only this member has marked watched
    watchedIds = await prisma.watchedMovie.findMany({
      where: { memberId: member.id },
      select: { tmdbMovieId: true },
    }).then(rows => rows.map(r => r.tmdbMovieId))
  }

  const excludedIds = [...new Set([...votedIds, ...rejectedIds, ...watchedIds])]
  const notInClause = excludedIds.length ? excludedIds : ['__none__']

  // Next movie in THIS member's personal shuffled order
  const memberQueueEntry = await prisma.memberQueue.findFirst({
    where: { memberId: member.id, tmdbMovieId: { notIn: notInClause } },
    orderBy: { position: 'asc' },
  })

  if (!memberQueueEntry) {
    // Return JSON null so the client's `current === null` guard fires correctly
    return NextResponse.json(null)
  }

  // Get streaming metadata from the shared RoomQueue
  const nextEntry = await prisma.roomQueue.findUnique({
    where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: memberQueueEntry.tmdbMovieId } },
  })

  if (!nextEntry) {
    return NextResponse.json(null)
  }

  const remaining = await prisma.memberQueue.count({
    where: { memberId: member.id, tmdbMovieId: { notIn: notInClause } },
  })

  let movie
  try {
    movie = await getMovieById(nextEntry.tmdbMovieId)
  } catch {
    // TMDB unavailable — return null so client advances
    return NextResponse.json(null)
  }

  return NextResponse.json({
    movie: { ...movie, watchUrl: nextEntry.watchUrl, streamingService: nextEntry.streamingService },
    remaining,
  })
}
