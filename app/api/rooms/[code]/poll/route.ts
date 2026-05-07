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
  if (!room || room.id !== member.roomId) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  // Heartbeat — keep member active
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

  return NextResponse.json({ status: room.status, memberCount, matchedMovie })
}
