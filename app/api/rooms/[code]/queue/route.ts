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

  // Find movies this member has already voted on
  const votedIds = await prisma.vote.findMany({
    where: { roomId: room.id, memberId: member.id },
    select: { tmdbMovieId: true },
  }).then(rows => rows.map(r => r.tmdbMovieId))

  // Next unvoted movie in queue order
  const nextEntry = await prisma.roomQueue.findFirst({
    where: { roomId: room.id, tmdbMovieId: { notIn: votedIds.length ? votedIds : ['__none__'] } },
    orderBy: { position: 'asc' },
  })

  if (!nextEntry) {
    const total = await prisma.roomQueue.count({ where: { roomId: room.id } })
    return NextResponse.json({ movie: null, remaining: 0, total })
  }

  const remaining = await prisma.roomQueue.count({
    where: { roomId: room.id, tmdbMovieId: { notIn: votedIds.length ? votedIds : ['__none__'] } },
  })

  let movie
  try {
    movie = await getMovieById(nextEntry.tmdbMovieId)
  } catch {
    // TMDB unavailable — skip this movie by returning null with remaining count
    return NextResponse.json({ movie: null, remaining, tmdbError: true })
  }

  return NextResponse.json({
    movie: { ...movie, watchUrl: nextEntry.watchUrl, streamingService: nextEntry.streamingService },
    remaining,
  })
}
