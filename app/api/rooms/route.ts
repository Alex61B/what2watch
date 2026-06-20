import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRoomCode, isValidRoomCode } from '@/lib/room-code'
import { generateSessionToken, setSessionCookie } from '@/lib/session'
import { checkRateLimit, getClientIp, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit-db'

// Normalize an optional free-text room name: trim, empty → null, cap length.
function normalizeRoomName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 60)
}

export async function POST(request: Request) {
  const rl = await checkRateLimit('room-create', getClientIp(request), RATE_LIMITS.roomCreate)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSeconds)

  const body = await request.json()
  const displayName = body?.displayName
  const name = normalizeRoomName(body?.name)

  if (!displayName?.trim()) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
  }

  // Honor a valid client-supplied code (the landing page pre-generates one so its
  // Copy Link / Share point at the room that will actually be created); otherwise
  // generate one. The INSERT is the source of truth: if the code was taken between
  // generation and insert, the unique constraint throws P2002 and we regenerate and
  // retry. (The old check-then-insert could 500 on a concurrent collision.)
  const requested = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
  let code = isValidRoomCode(requested) ? requested : generateRoomCode()

  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  let member: { id: string } | null = null
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      // Create room and host member in one transaction.
      member = await prisma.$transaction(async (tx) => {
        const room = await tx.room.create({
          data: { code, name, streamingServices: [], expiresAt },
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
      break
    } catch (err) {
      // Unique-constraint violation on `code` — someone took it first. Regenerate
      // and retry; anything else is a real error.
      if ((err as { code?: string }).code === 'P2002') {
        code = generateRoomCode()
        continue
      }
      throw err
    }
  }

  if (!member) {
    return NextResponse.json({ error: 'Failed to generate unique room code' }, { status: 500 })
  }

  const response = NextResponse.json({ code, memberId: member.id })
  setSessionCookie(response, code, sessionToken)
  return response
}
