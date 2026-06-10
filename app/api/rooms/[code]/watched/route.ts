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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'member-lookup'
    const member = await prisma.member.findUnique({ where: { sessionToken } })
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    stage = 'room-lookup'
    const room = await prisma.room.findUnique({ where: { code } })
    if (!room || room.id !== member.roomId) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    stage = 'body-parse'
    const body = await request.json().catch(() => ({}))
    const { tmdbMovieId } = body
    if (!tmdbMovieId || typeof tmdbMovieId !== 'string') {
      return NextResponse.json({ error: 'tmdbMovieId (string) is required' }, { status: 400 })
    }

    stage = 'upsert'
    await prisma.watchedMovie.upsert({
      where: { memberId_tmdbMovieId: { memberId: member.id, tmdbMovieId } },
      create: { memberId: member.id, tmdbMovieId },
      update: {},
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

    // "Skip the Reruns" removal is now handled by the per-member deck: the
    // WatchedMovie row above is excluded from /queue (room-wide when watchedFilter
    // is ON, otherwise just for this member), so a seen movie drops out of decks
    // without advancing any shared position. When OFF, the seen flag is recorded
    // only — the movie stays in the deck and votes proceed normally.
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
