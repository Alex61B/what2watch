import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const sessionToken = await getSessionToken()
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room || room.id !== member.roomId) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && ifNoneMatch.replace(/"/g, '') === String(room.queueVersion)) {
    await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: `"${room.queueVersion}"` },
    })
  }

  await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

  const memberCount = await prisma.member.count({
    where: { roomId: room.id, leftAt: null },
  })

  let matchedMovie = null
  if (room.matchedMovieId) {
    try {
      const movie = await getMovieById(room.matchedMovieId)
      const queueEntry = await prisma.roomQueue.findUnique({
        where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: room.matchedMovieId } },
      })
      matchedMovie = { ...movie, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService }
    } catch {
      matchedMovie = { tmdbId: room.matchedMovieId }
    }
  }

  const rejectedMovieIds = await prisma.vote.findMany({
    where: { roomId: room.id, vote: false },
    select: { tmdbMovieId: true },
    distinct: ['tmdbMovieId'],
  }).then(rows => rows.map(r => r.tmdbMovieId))

  const currentEntry = await prisma.roomQueue.findFirst({
    where: { roomId: room.id, position: room.currentPosition },
    select: { tmdbMovieId: true, watchUrl: true, streamingService: true },
  })

  let currentMovie = null
  if (currentEntry) {
    try {
      const movie = await getMovieById(currentEntry.tmdbMovieId)
      currentMovie = { ...movie, watchUrl: currentEntry.watchUrl, streamingService: currentEntry.streamingService }
    } catch {
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
      memberCount,
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
}
