import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'
import { getMovieById } from '@/lib/tmdb'
import { buildRoomSignal, pickNext, scoreCandidate, type Candidate } from '@/lib/recommender'
import { roomExpired, expiredRoomResponse } from '@/lib/room'
import { logServerError, serverError } from '@/lib/api-error'

// card_decided events carry the room CODE (not id) and no memberId, so dwell aggregates per
// (code, movieId) over YES events only (matches the YES-only dwell weighting). A miss → empty
// map ⇒ votes-only weighting; it can never zero the signal.
async function loadDwellByMovie(roomCode: string): Promise<Map<string, number>> {
  const events = await prisma.event.findMany({
    where: { roomId: roomCode, type: 'card_decided' },
    select: { props: true },
  })
  const acc = new Map<string, { total: number; n: number }>()
  for (const e of events) {
    const p = e.props as { movieId?: unknown; vote?: unknown; dwellMs?: unknown } | null
    if (!p || p.vote !== true) continue
    const movieId = typeof p.movieId === 'string' ? p.movieId : null
    const dwellMs = typeof p.dwellMs === 'number' ? p.dwellMs : null
    if (!movieId || dwellMs === null) continue
    const cur = acc.get(movieId) ?? { total: 0, n: 0 }
    cur.total += dwellMs
    cur.n += 1
    acc.set(movieId, cur)
  }
  const avg = new Map<string, number>()
  for (const [m, { total, n }] of acc) avg.set(m, total / n)
  return avg
}

export async function GET(
  _request: Request,
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
    if (roomExpired(room)) return expiredRoomResponse()

    stage = 'heartbeat'
    await prisma.member.update({ where: { id: member.id }, data: { lastSeenAt: new Date() } })

    stage = 'excluded-ids'
    const votedIds = await prisma.vote.findMany({
      where: { roomId: room.id, memberId: member.id },
      select: { tmdbMovieId: true },
    }).then(rows => rows.map(r => r.tmdbMovieId))

    const rejectedIds = await prisma.vote.findMany({
      where: { roomId: room.id, vote: false },
      select: { tmdbMovieId: true },
      distinct: ['tmdbMovieId'],
    }).then(rows => rows.map(r => r.tmdbMovieId))

    let watchedIds: string[]
    if (room.watchedFilter) {
      const where = member.userId
        ? { OR: [{ member: { roomId: room.id } }, { member: { userId: member.userId } }] }
        : { member: { roomId: room.id } }
      watchedIds = await prisma.watchedMovie.findMany({
        where,
        select: { tmdbMovieId: true },
        distinct: ['tmdbMovieId'],
      }).then(rows => rows.map(r => r.tmdbMovieId))
    } else {
      watchedIds = await prisma.watchedMovie.findMany({
        where: { memberId: member.id },
        select: { tmdbMovieId: true },
      }).then(rows => rows.map(r => r.tmdbMovieId))
    }

    const excludedIds = [...new Set([...votedIds, ...rejectedIds, ...watchedIds])]
    const excludedSet = new Set(excludedIds)

    // Re-rank: the member's next card is the highest group-consensus-scoring eligible entry
    // (not simply the lowest position). Eligible = in the room queue, not voted on by this
    // member, not vetoed room-wide, not filtered as seen. Falls back to lowest position on
    // cold start / no signal. See lib/recommender.ts.
    stage = 'room-queue-load'
    const allQueue = await prisma.roomQueue.findMany({
      where: { roomId: room.id },
      select: {
        tmdbMovieId: true,
        position: true,
        genreIds: true,
        rating: true,
        watchUrl: true,
        streamingService: true,
      },
    })
    const eligible = allQueue.filter((q) => !excludedSet.has(q.tmdbMovieId))
    if (eligible.length === 0) {
      return NextResponse.json(null)
    }

    stage = 'signal'
    const genreMap = new Map(allQueue.map((q) => [q.tmdbMovieId, q.genreIds]))
    const roomVotes = await prisma.vote.findMany({
      where: { roomId: room.id },
      select: { tmdbMovieId: true, vote: true },
    })
    const dwellByMovie = await loadDwellByMovie(room.code)
    const signal = buildRoomSignal(
      roomVotes.map((v) => ({
        genreIds: genreMap.get(v.tmdbMovieId) ?? [],
        vote: v.vote,
        dwellMs: dwellByMovie.get(v.tmdbMovieId),
      })),
    )

    stage = 'rank'
    const candidates: Candidate[] = eligible.map((q) => ({
      tmdbMovieId: q.tmdbMovieId,
      position: q.position,
      genreIds: q.genreIds,
      rating: q.rating,
    }))
    const chosen = pickNext(candidates, signal)
    const pickedBy: 'score' | 'fallback' = chosen ? 'score' : 'fallback'
    const chosenId =
      chosen?.tmdbMovieId ?? eligible.reduce((a, b) => (b.position < a.position ? b : a)).tmdbMovieId
    const nextEntry = eligible.find((q) => q.tmdbMovieId === chosenId)!
    const remaining = eligible.length

    console.log('[queue] picked', {
      roomId: room.id,
      pickedBy,
      voteCount: signal.voteCount,
      dwellMatches: dwellByMovie.size,
      topScore: chosen ? Number(scoreCandidate(chosen, signal).toFixed(3)) : null,
    })

    stage = 'tmdb-fetch'
    let movie
    try {
      movie = await getMovieById(nextEntry.tmdbMovieId)
    } catch (err) {
      console.error('[queue-route] tmdb fetch failed, returning null', {
        roomId: room.id,
        tmdbMovieId: nextEntry.tmdbMovieId,
        message: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(null)
    }

    return NextResponse.json({
      movie: { ...movie, watchUrl: nextEntry.watchUrl, streamingService: nextEntry.streamingService },
      remaining,
      pickedBy,
    })
  } catch (err) {
    logServerError('[queue-route]', { stage, roomCode }, err)
    return serverError(500)
  }
}
