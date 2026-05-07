import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateSessionToken } from '@/lib/session'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const body = await request.json().catch(() => ({}))
  const displayName = body?.displayName

  if (!displayName?.trim()) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
  }

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (room.status !== 'LOBBY') {
    return NextResponse.json({ error: 'Room is no longer accepting members' }, { status: 409 })
  }

  const sessionToken = generateSessionToken()
  const member = await prisma.member.create({
    data: {
      roomId: room.id,
      displayName: displayName.trim(),
      sessionToken,
      isHost: false,
    },
  })

  const response = NextResponse.json({ memberId: member.id })
  response.cookies.set('w2w_session', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return response
}
