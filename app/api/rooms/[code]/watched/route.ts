import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'

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

  const body = await request.json().catch(() => ({}))
  const { tmdbMovieId } = body
  if (!tmdbMovieId || typeof tmdbMovieId !== 'string') {
    return NextResponse.json({ error: 'tmdbMovieId (string) is required' }, { status: 400 })
  }

  await prisma.watchedMovie.upsert({
    where: { memberId_tmdbMovieId: { memberId: member.id, tmdbMovieId } },
    create: { memberId: member.id, tmdbMovieId },
    update: {},
  })

  return NextResponse.json({ ok: true })
}
