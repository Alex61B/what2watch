import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { checkForMatch } from '@/lib/match'
import { getMovieById } from '@/lib/tmdb'
import { advanceQueueAtomic } from '@/lib/queue'

export async function POST(
  request: Request,
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
  if (room.status !== 'VOTING') {
    return NextResponse.json({ error: 'Room is not in voting state' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({}))
  const { tmdbMovieId, vote } = body
  if (!tmdbMovieId || typeof vote !== 'boolean') {
    return NextResponse.json(
      { error: 'tmdbMovieId (string) and vote (boolean) are required' },
      { status: 400 }
    )
  }

  const currentEntry = await prisma.roomQueue.findFirst({
    where: { roomId: room.id, position: room.currentPosition },
    select: { tmdbMovieId: true },
  })

  if (!currentEntry || currentEntry.tmdbMovieId !== tmdbMovieId) {
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

  await prisma.vote.upsert({
    where: { roomId_memberId_tmdbMovieId: { roomId: room.id, memberId: member.id, tmdbMovieId } },
    create: { roomId: room.id, memberId: member.id, tmdbMovieId, vote },
    update: { vote },
  })

  await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

  if (!vote) {
    const advance = await advanceQueueAtomic(room.id, room.currentPosition, room.queueVersion)
    return NextResponse.json({ matched: false, advance })
  }

  const matchedMovieId = await checkForMatch(room.id, tmdbMovieId)
  if (!matchedMovieId) return NextResponse.json({ matched: false })

  const queueEntry = await prisma.roomQueue.findUnique({
    where: { roomId_tmdbMovieId: { roomId: room.id, tmdbMovieId: matchedMovieId } },
  })

  let matchedMovie = null
  try {
    const movie = await getMovieById(matchedMovieId)
    matchedMovie = { ...movie, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService }
  } catch {
    matchedMovie = { tmdbId: matchedMovieId, watchUrl: queueEntry?.watchUrl, streamingService: queueEntry?.streamingService }
  }

  const advance = await advanceQueueAtomic(room.id, room.currentPosition, room.queueVersion)

  return NextResponse.json({ matched: true, movie: matchedMovie, advance })
}
