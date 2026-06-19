/**
 * @jest-environment node
 *
 * Route tests for GET /api/rooms/[code]/queue — the per-member "next card".
 * The card is the highest group-consensus-scoring eligible RoomQueue entry
 * (lib/recommender), falling back to lowest position on cold start (< 5 votes) or
 * no signal. Eligible = not voted on by this member, not vetoed room-wide, not
 * filtered as seen. Covers the guards, the voted/rejected/watched exclusion, the
 * null short-circuits, the heartbeat, the warm score-rank, and the cold fallback.
 */
import { GET as getQueue } from '@/app/api/rooms/[code]/queue/route'
import { prisma } from '@/lib/prisma'
import { getMovieById } from '@/lib/tmdb'
import { sessionCookieName } from '@/lib/session'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    member: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
    room: { findUnique: jest.fn() },
    vote: { findMany: jest.fn() },
    watchedMovie: { findMany: jest.fn() },
    roomQueue: { findMany: jest.fn() },
    event: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn() }))

const jar = new Map<string, string>()
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = jar.get(name)
      return v ? { name, value: v } : undefined
    },
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
  }),
}))

const memberFindUnique = prisma.member.findUnique as jest.Mock
const memberUpdate = prisma.member.update as jest.Mock
const roomFindUnique = prisma.room.findUnique as jest.Mock
const voteFindMany = prisma.vote.findMany as jest.Mock
const watchedFindMany = prisma.watchedMovie.findMany as jest.Mock
const roomQueueFindMany = prisma.roomQueue.findMany as jest.Mock
const eventFindMany = prisma.event.findMany as jest.Mock
const mockMovie = getMovieById as jest.Mock

const entry = (tmdbMovieId: string, position: number, genreIds: number[] = [], rating = 0) => ({
  tmdbMovieId,
  position,
  genreIds,
  rating,
  watchUrl: 'http://w',
  streamingService: 'netflix',
})

const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const req = () => new Request('http://test/queue')
function authAs(code: string, over: Record<string, unknown> = {}) {
  memberFindUnique.mockResolvedValue({ id: 'm1', roomId: 'r1', sessionToken: 'tok-1', userId: null, ...over })
  jar.set(sessionCookieName(code), 'tok-1')
}

beforeEach(() => {
  jar.clear()
  memberFindUnique.mockReset()
  memberUpdate.mockReset().mockResolvedValue({})
  roomFindUnique.mockReset().mockResolvedValue({ id: 'r1', code: 'AAA-11', watchedFilter: false, expiresAt: new Date(Date.now() + 3_600_000) })
  voteFindMany.mockReset().mockResolvedValue([])
  watchedFindMany.mockReset().mockResolvedValue([])
  roomQueueFindMany.mockReset().mockResolvedValue([entry('10', 0)])
  eventFindMany.mockReset().mockResolvedValue([])
  // Echo the requested id so the CHOSEN card is assertable from the response.
  mockMovie.mockReset().mockImplementation(async (id: string) => ({ tmdbId: id, title: `Movie ${id}` }))
})

describe('GET /queue', () => {
  it('401 without a session', async () => {
    expect((await getQueue(req(), ctx('AAA-11'))).status).toBe(401)
  })

  it('401 when the token matches no member', async () => {
    memberFindUnique.mockResolvedValue(null)
    jar.set(sessionCookieName('AAA-11'), 'ghost')
    expect((await getQueue(req(), ctx('AAA-11'))).status).toBe(401)
  })

  it('404 when the member belongs to another room', async () => {
    authAs('AAA-11')
    roomFindUnique.mockResolvedValue({ id: 'rX', code: 'AAA-11', watchedFilter: false, expiresAt: new Date(Date.now() + 3_600_000) })
    expect((await getQueue(req(), ctx('AAA-11'))).status).toBe(404)
  })

  it('410 when the room has expired', async () => {
    authAs('AAA-11')
    roomFindUnique.mockResolvedValue({ id: 'r1', code: 'AAA-11', watchedFilter: false, expiresAt: new Date(Date.now() - 1_000) })
    expect((await getQueue(req(), ctx('AAA-11'))).status).toBe(410)
  })

  it('records a heartbeat (lastSeenAt) on each poll', async () => {
    authAs('AAA-11')
    await getQueue(req(), ctx('AAA-11'))
    expect(memberUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
    })
  })

  it('returns the hydrated next card with watchUrl/streamingService, remaining, and pickedBy', async () => {
    authAs('AAA-11')
    const body = await (await getQueue(req(), ctx('AAA-11'))).json()
    expect(body).toEqual({
      movie: { tmdbId: '10', title: 'Movie 10', watchUrl: 'http://w', streamingService: 'netflix' },
      remaining: 1,
      pickedBy: 'fallback',
    })
  })

  it('cold room (< 5 votes) falls back to the lowest-position card', async () => {
    authAs('AAA-11')
    roomQueueFindMany.mockResolvedValue([entry('p1', 1, [28], 9), entry('p0', 0, [18], 1)])
    const body = await (await getQueue(req(), ctx('AAA-11'))).json()
    expect(body.pickedBy).toBe('fallback')
    expect(body.movie.tmdbId).toBe('p0') // lowest position, despite p1's higher rating
  })

  it('returns null when no eligible card remains in the room queue', async () => {
    authAs('AAA-11')
    roomQueueFindMany.mockResolvedValue([])
    expect(await (await getQueue(req(), ctx('AAA-11'))).json()).toBeNull()
  })

  it('returns null (not 500) when the TMDB fetch fails', async () => {
    authAs('AAA-11')
    mockMovie.mockRejectedValue(new Error('tmdb down'))
    const res = await getQueue(req(), ctx('AAA-11'))
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('excludes the member votes, the room rejects, and watched movies from eligibility', async () => {
    authAs('AAA-11')
    roomQueueFindMany.mockResolvedValue([entry('1', 0), entry('2', 1), entry('3', 2), entry('10', 3)])
    voteFindMany.mockImplementation(async ({ where }: { where: { memberId?: string; vote?: boolean } }) => {
      if (where.memberId) return [{ tmdbMovieId: '1' }] // this member's vote
      if (where.vote === false) return [{ tmdbMovieId: '2' }] // room-wide reject
      return [] // all-votes signal query
    })
    watchedFindMany.mockResolvedValue([{ tmdbMovieId: '3' }])

    const body = await (await getQueue(req(), ctx('AAA-11'))).json()
    // 1/2/3 excluded ⇒ only '10' eligible ⇒ it must be the chosen card.
    expect(body.movie.tmdbId).toBe('10')
  })

  it('with watchedFilter on + a linked user, queries room-wide and cross-room watched history', async () => {
    authAs('AAA-11', { userId: 'user-1' })
    roomFindUnique.mockResolvedValue({ id: 'r1', code: 'AAA-11', watchedFilter: true, expiresAt: new Date(Date.now() + 3_600_000) })

    await getQueue(req(), ctx('AAA-11'))

    expect(watchedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ member: { roomId: 'r1' } }, { member: { userId: 'user-1' } }] },
      }),
    )
  })

  it('warm room ranks the next card by genre score and reports pickedBy:score', async () => {
    authAs('AAA-11')
    // Two eligible cards (drama / action) + five already-voted action seeds that train the signal.
    roomQueueFindMany.mockResolvedValue([
      entry('drama', 0, [18]),
      entry('action', 1, [28]),
      ...Array.from({ length: 5 }, (_, i) => entry(`seed${i}`, 10 + i, [28])),
    ])
    voteFindMany.mockImplementation(async ({ where }: { where: { memberId?: string; vote?: boolean } }) => {
      if (where.memberId) return Array.from({ length: 5 }, (_, i) => ({ tmdbMovieId: `seed${i}` })) // excluded
      if (where.vote === false) return []
      return Array.from({ length: 5 }, (_, i) => ({ tmdbMovieId: `seed${i}`, vote: true })) // 5 YES on action
    })

    const body = await (await getQueue(req(), ctx('AAA-11'))).json()
    expect(body.pickedBy).toBe('score')
    expect(body.movie.tmdbId).toBe('action') // genre 28 favored over drama (18)
  })
})
