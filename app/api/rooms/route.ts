import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRoomCode } from '@/lib/room-code'
import { generateSessionToken, setSessionCookie } from '@/lib/session'

// Normalize an optional free-text room name: trim, empty → null, cap length.
function normalizeRoomName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 60)
}

export async function POST(request: Request) {
  const body = await request.json()
  const displayName = body?.displayName
  const name = normalizeRoomName(body?.name)

  if (!displayName?.trim()) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
  }

  // Generate unique room code with up to 5 retries
  let code: string | null = null
  for (let i = 0; i < 5; i++) {
    const candidate = generateRoomCode()
    const existing = await prisma.room.findUnique({ where: { code: candidate } })
    if (!existing) { code = candidate; break }
  }
  if (!code) {
    return NextResponse.json({ error: 'Failed to generate unique room code' }, { status: 500 })
  }

  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  // Create room and host member in one transaction
  const member = await prisma.$transaction(async (tx) => {
    const room = await tx.room.create({
      data: {
        code,
        name,
        streamingServices: [],
        expiresAt,
      },
    })
    return tx.member.create({
      data: {
        roomId: room.id,
        displayName: displayName.trim(),
        sessionToken,
        isHost: true,
      },
    })
  })

  const response = NextResponse.json({ code, memberId: member.id })
  setSessionCookie(response, code, sessionToken)
  return response
}
