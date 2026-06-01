import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { resolveMemberUserId } from '@/lib/link'
import { addPreference } from '@/lib/preferences'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  let stage = 'init'
  let roomCode: string | undefined
  try {
    stage = 'params'
    const { code } = await params
    roomCode = code

    stage = 'session'
    const sessionToken = await getSessionToken(code)
    if (!sessionToken) {
      console.warn('[watched] returning 401', { reason: 'unauthorized_no_session', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    console.log('[watched] member lookup', { roomCode, found: !!member })
    if (!member) {
      console.warn('[watched] returning 401', { reason: 'unauthorized_no_member', roomCode })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[watched] request', {
      roomCode,
      memberId: member.id,
      userId: member.userId,
      timestamp: new Date().toISOString(),
    })

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    console.log('[watched] room lookup', { roomCode, found: !!room })
    if (!room || room.id !== member.roomId) {
      console.warn('[watched] returning 404', {
        reason: 'room_not_found',
        roomCode,
        memberId: member.id,
        memberRoomId: member.roomId,
        foundRoomId: room?.id ?? null,
      })
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    stage = 'body-parse'
    const body = await request.json().catch(() => ({}))
    const { tmdbMovieId } = body
    if (!tmdbMovieId || typeof tmdbMovieId !== 'string') {
      console.warn('[watched] returning 400', {
        reason: 'bad_request_missing_field',
        roomCode,
        hasTmdbMovieId: typeof tmdbMovieId === 'string',
      })
      return NextResponse.json({ error: 'tmdbMovieId (string) is required' }, { status: 400 })
    }

    stage = 'upsert'
    await prisma.watchedMovie.upsert({
      where: { memberId_tmdbMovieId: { memberId: member.id, tmdbMovieId } },
      create: { memberId: member.id, tmdbMovieId },
      update: {},
    })
    console.log('[watched] upsert', {
      roomId: room.id,
      memberId: member.id,
      tmdbMovieId,
    })

    try {
      const userId = await resolveMemberUserId(member)
      if (userId) await addPreference(userId, tmdbMovieId, 'SEEN_BEFORE', room.id)
    } catch (hookErr) {
      console.error('[watched] seen-before hook failed (non-fatal)', {
        roomCode,
        memberId: member.id,
        message: hookErr instanceof Error ? hookErr.message : String(hookErr),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[watched] fatal error', {
      stage,
      roomCode,
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
    return NextResponse.json(
      { error: error.message, stack: error.stack, name: error.name, stage },
      { status: 500 }
    )
  }
}
