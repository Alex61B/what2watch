import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateSessionToken, setSessionCookie, sessionCookieName } from '@/lib/session'

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
  const member = await prisma.member.create({
    data: {
      roomId: room.id,
      displayName: displayName.trim(),
      sessionToken,
      isHost: false,
    },
  })

  // If voting has already started, create a per-member queue for this late joiner
  if (room.status === 'VOTING') {
    const roomMovieIds = await prisma.roomQueue.findMany({
      where: { roomId: room.id },
      select: { tmdbMovieId: true },
      orderBy: { position: 'asc' },
    }).then(rows => rows.map(r => r.tmdbMovieId))

    if (roomMovieIds.length > 0) {
      const shuffledForMember = shuffle([...roomMovieIds])
      await prisma.memberQueue.createMany({
        data: shuffledForMember.map((tmdbMovieId, position) => ({
          memberId: member.id,
          tmdbMovieId,
          position,
        })),
        skipDuplicates: true,
      })
    }
  }

  const memberCount = await prisma.member.count({ where: { roomId: room.id, leftAt: null } })
  console.log('[join] member created', {
    roomCode: code,
    foundRoomId: room.id,
    roomStatus: room.status,
    memberId: member.id,
    memberRoomId: member.roomId,
    memberCount,
    cookie: sessionCookieName(code),
    tokenPrefix: sessionToken.slice(0, 8),
  })

  const response = NextResponse.json({ memberId: member.id })
  setSessionCookie(response, code, sessionToken)
  return response
}
