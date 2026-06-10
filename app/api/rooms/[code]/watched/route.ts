import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { resolveMemberUserId } from '@/lib/link'
import { addPreference } from '@/lib/preferences'
import { advanceQueueAtomic } from '@/lib/queue'

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

    // "Skip the Reruns" behaviour: when the room's watchedFilter is ON, marking
    // a movie seen removes it from the remaining queue for the WHOLE room,
    // mid-session. In the shared veto queue that means advancing past it (only
    // if it's the movie the room is currently on). When OFF, the seen-it flag is
    // recorded only — the movie stays in the queue and votes proceed normally.
    stage = 'skip-reruns-advance'
    let removed = false
    let advance: Awaited<ReturnType<typeof advanceQueueAtomic>> | null = null
    if (room.watchedFilter) {
      // Re-read live position/version (the room may have advanced while we parsed
      // the body / wrote the watched row) so we only skip the card that's actually
      // current and run the CAS advance against fresh values.
      const fresh = await prisma.room.findUnique({
        where: { id: room.id },
        select: { currentPosition: true, queueVersion: true },
      })
      if (fresh) {
        const currentEntry = await prisma.roomQueue.findFirst({
          where: { roomId: room.id, position: fresh.currentPosition },
          select: { tmdbMovieId: true },
        })
        if (currentEntry?.tmdbMovieId === tmdbMovieId) {
          advance = await advanceQueueAtomic(room.id, fresh.currentPosition, fresh.queueVersion)
          removed = advance.advanced
        }
      }
    }

    return NextResponse.json({ ok: true, removed, advance })
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
