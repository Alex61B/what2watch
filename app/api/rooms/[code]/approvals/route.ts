import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'

// Host accepts or rejects a pending late-joiner.
// POST { memberId: string, action: 'accept' | 'reject' }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params

  const sessionToken = await getSessionToken(code)
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const host = await prisma.member.findUnique({ where: { sessionToken } })
  if (!host?.isHost) {
    return NextResponse.json({ error: 'Only the host can approve members' }, { status: 403 })
  }

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room || room.id !== host.roomId) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const { memberId, action } = body
  if (typeof memberId !== 'string' || (action !== 'accept' && action !== 'reject')) {
    return NextResponse.json(
      { error: "memberId (string) and action ('accept' | 'reject') are required" },
      { status: 400 }
    )
  }

  const target = await prisma.member.findUnique({ where: { id: memberId } })
  if (!target || target.roomId !== room.id || target.leftAt || target.approved) {
    return NextResponse.json({ error: 'No pending request for that member' }, { status: 404 })
  }

  if (action === 'accept') {
    await prisma.member.update({ where: { id: target.id }, data: { approved: true } })
  } else {
    await prisma.member.update({ where: { id: target.id }, data: { leftAt: new Date() } })
  }

  return NextResponse.json({ ok: true })
}
