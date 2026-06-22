import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateSessionToken, setSessionCookie } from '@/lib/session'
import { roomExpired, expiredRoomResponse, MAX_ROOM_MEMBERS } from '@/lib/room'
import { checkRateLimit, getClientIp, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit-db'

// Sentinel thrown inside the join transaction when the room is at capacity; caught below → 409.
class RoomFullError extends Error {}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params

  const rl = await checkRateLimit('room-join', getClientIp(request), RATE_LIMITS.roomJoin)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSeconds)

  const body = await request.json().catch(() => ({}))
  const displayName = body?.displayName

  if (!displayName?.trim()) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
  }

  const room = await prisma.room.findUnique({ where: { code } })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (roomExpired(room)) return expiredRoomResponse()
  if (room.status !== 'LOBBY' && room.status !== 'VOTING') {
    return NextResponse.json({ error: 'Room is no longer accepting members' }, { status: 409 })
  }

  const sessionToken = generateSessionToken()

  // Create the member from a single room-status read taken inside the transaction, so
  // the approval decision stays consistent if `start` lands concurrently.
  const member = await prisma.$transaction(async (tx) => {
    const current = await tx.room.findUnique({
      where: { id: room.id },
      select: { status: true },
    })
    const status = current?.status ?? room.status

    // M-join: cap active members. Counted inside the transaction so two concurrent joins
    // can't both pass the check; an empty (leftAt) seat frees capacity.
    const activeCount = await tx.member.count({ where: { roomId: room.id, leftAt: null } })
    if (activeCount >= MAX_ROOM_MEMBERS) throw new RoomFullError()

    // Joining mid-session (VOTING) requires host approval; lobby joins auto-approve.
    const approved = status !== 'VOTING'

    const created = await tx.member.create({
      data: {
        roomId: room.id,
        displayName: displayName.trim(),
        sessionToken,
        isHost: false,
        approved,
      },
    })

    // Bump the room version so membership changes invalidate the poll's ETag
    // fast-path — otherwise a host (or proxy) can serve a stale 304 and miss the
    // new pending request until the queue happens to advance.
    await tx.room.update({ where: { id: room.id }, data: { queueVersion: { increment: 1 } } })

    return created
  }).catch((err) => {
    if (err instanceof RoomFullError) return null
    throw err
  })

  if (!member) {
    return NextResponse.json({ error: 'Room is full' }, { status: 409 })
  }

  const response = NextResponse.json({ memberId: member.id })
  setSessionCookie(response, code, sessionToken)
  return response
}
