import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateSessionToken, setSessionCookie } from '@/lib/session'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

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
  if (room.status !== 'LOBBY' && room.status !== 'VOTING') {
    return NextResponse.json({ error: 'Room is no longer accepting members' }, { status: 409 })
  }

  const sessionToken = generateSessionToken()

  // Create the member and (for a mid-session join) its per-member queue atomically,
  // both derived from a single room-status read taken inside the transaction. This
  // guarantees a late joiner is never left approved-but-queueless, and keeps the
  // approval decision consistent with the queue build if `start` lands concurrently.
  const member = await prisma.$transaction(async (tx) => {
    const current = await tx.room.findUnique({
      where: { id: room.id },
      select: { status: true },
    })
    const status = current?.status ?? room.status
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

    if (status === 'VOTING') {
      const roomMovieIds = await tx.roomQueue
        .findMany({
          where: { roomId: room.id },
          select: { tmdbMovieId: true },
          orderBy: { position: 'asc' },
        })
        .then((rows) => rows.map((r) => r.tmdbMovieId))

      if (roomMovieIds.length > 0) {
        const shuffledForMember = shuffle([...roomMovieIds])
        await tx.memberQueue.createMany({
          data: shuffledForMember.map((tmdbMovieId, position) => ({
            memberId: created.id,
            tmdbMovieId,
            position,
          })),
          skipDuplicates: true,
        })
      }
    }

    // Bump the room version so membership changes invalidate the poll's ETag
    // fast-path — otherwise a host (or proxy) can serve a stale 304 and miss the
    // new pending request until the queue happens to advance.
    await tx.room.update({ where: { id: room.id }, data: { queueVersion: { increment: 1 } } })

    return created
  })

  const response = NextResponse.json({ memberId: member.id })
  setSessionCookie(response, code, sessionToken)
  return response
}
