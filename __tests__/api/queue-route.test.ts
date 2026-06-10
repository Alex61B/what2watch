/**
 * @jest-environment node
 *
 * Route tests for GET /api/rooms/[code]/queue — the per-member "next card".
 * The card is sourced from RoomQueue (lowest position the member hasn't voted on,
 * nobody has vetoed, and isn't filtered as seen), so each member advances
 * independently and a host requeue is picked up. Covers the guards, the
 * voted/rejected/watched exclusion (incl. the watchedFilter OR-clause for a
 * linked user), the null short-circuits (no eligible card, TMDB failure), the
 * heartbeat, and the hydrated success shape.
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
    roomQueue: { findFirst: jest.fn(), count: jest.fn() },
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
const roomQueueFindFirst = prisma.roomQueue.findFirst as jest.Mock
const roomQueueCount = prisma.roomQueue.count as jest.Mock
const mockMovie = getMovieById as jest.Mock

const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const req = () => new Request('http://test/queue')
function authAs(code: string, over: Record<string, unknown> = {}) {
  memberFindUnique.mockResolvedValue({ id: 'm1', roomId: 'r1', sessionToken: 'tok-1', userId: null, ...over })
  jar.set(sessionCookieName(code), 'tok-1')
}

beforeEach(() => {
  jar.clear()
  memberFindUnique.mockReset()
  memberUpdate.mockReset()
  memberUpdate.mockResolvedValue({})
  roomFindUnique.mockReset()
  roomFindUnique.mockResolvedValue({ id: 'r1', code: 'AAA-11', watchedFilter: false })
  voteFindMany.mockReset()
  voteFindMany.mockResolvedValue([])
  watchedFindMany.mockReset()
  watchedFindMany.mockResolvedValue([])
  roomQueueFindFirst.mockReset()
  roomQueueFindFirst.mockResolvedValue({ tmdbMovieId: '10', watchUrl: 'http://w', streamingService: 'netflix' })
  roomQueueCount.mockReset()
  roomQueueCount.mockResolvedValue(5)
  mockMovie.mockReset()
  mockMovie.mockResolvedValue({ tmdbId: '10', title: 'Parasite' })
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
    roomFindUnique.mockResolvedValue({ id: 'rX', code: 'AAA-11', watchedFilter: false })
    expect((await getQueue(req(), ctx('AAA-11'))).status).toBe(404)
  })

  it('records a heartbeat (lastSeenAt) on each poll', async () => {
    authAs('AAA-11')
    await getQueue(req(), ctx('AAA-11'))
    expect(memberUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
    })
  })

  it('returns the hydrated next card with watchUrl/streamingService and the remaining count', async () => {
    authAs('AAA-11')
    const body = await (await getQueue(req(), ctx('AAA-11'))).json()
    expect(body).toEqual({
      movie: { tmdbId: '10', title: 'Parasite', watchUrl: 'http://w', streamingService: 'netflix' },
      remaining: 5,
    })
  })

  it('orders the next card by room-queue position', async () => {
    authAs('AAA-11')
    await getQueue(req(), ctx('AAA-11'))
    expect(roomQueueFindFirst.mock.calls[0][0]).toMatchObject({ orderBy: { position: 'asc' } })
  })

  it('returns null when no eligible card remains in the room queue', async () => {
    authAs('AAA-11')
    roomQueueFindFirst.mockResolvedValue(null)
    expect(await (await getQueue(req(), ctx('AAA-11'))).json()).toBeNull()
  })

  it('returns null (not 500) when the TMDB fetch fails', async () => {
    authAs('AAA-11')
    mockMovie.mockRejectedValue(new Error('tmdb down'))
    const res = await getQueue(req(), ctx('AAA-11'))
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('excludes the member votes, the room rejects, and watched movies from the next-card query', async () => {
    authAs('AAA-11')
    voteFindMany.mockImplementation(async ({ where }: { where: { vote?: boolean } }) =>
      where.vote === false ? [{ tmdbMovieId: '2' }] : [{ tmdbMovieId: '1' }],
    )
    watchedFindMany.mockResolvedValue([{ tmdbMovieId: '3' }])

    await getQueue(req(), ctx('AAA-11'))

    const where = roomQueueFindFirst.mock.calls[0][0].where as { tmdbMovieId: { notIn: string[] } }
    expect(new Set(where.tmdbMovieId.notIn)).toEqual(new Set(['1', '2', '3']))
  })

  it('with watchedFilter on + a linked user, queries room-wide and cross-room watched history', async () => {
    authAs('AAA-11', { userId: 'user-1' })
    roomFindUnique.mockResolvedValue({ id: 'r1', code: 'AAA-11', watchedFilter: true })

    await getQueue(req(), ctx('AAA-11'))

    expect(watchedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ member: { roomId: 'r1' } }, { member: { userId: 'user-1' } }] },
      }),
    )
  })
})
