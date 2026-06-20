/**
 * @jest-environment node
 *
 * Route tests for POST /api/rooms/[code]/start — host-only lobby → voting.
 * Covers the host/state/member-count/service guards, the expiry guard, the no-movies
 * 422, the happy path that builds the shared room queue, and the non-fatal "save host
 * prefs" hook. discoverMovies / auth are mocked; assertions check the persisted shapes
 * rather than the (random) shuffle order.
 */
import { POST as start } from '@/app/api/rooms/[code]/start/route'
import { prisma } from '@/lib/prisma'
import { discoverMovies } from '@/lib/tmdb'
import { auth } from '@/auth'
import { sessionCookieName } from '@/lib/session'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    member: { findUnique: jest.fn() },
    room: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
    roomQueue: { createMany: jest.fn(async () => ({ count: 0 })) },
    user: { update: jest.fn(async () => ({})) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}))
jest.mock('@/lib/tmdb', () => ({
  ...jest.requireActual('@/lib/tmdb'),
  discoverMovies: jest.fn(),
}))
jest.mock('@/auth', () => ({ auth: jest.fn(async () => null) }))

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
const roomFindUnique = prisma.room.findUnique as jest.Mock
const roomUpdate = prisma.room.update as jest.Mock
const queueCreateMany = prisma.roomQueue.createMany as jest.Mock
const userUpdate = prisma.user.update as jest.Mock
const mockDiscover = discoverMovies as jest.Mock
const mockAuth = auth as unknown as jest.Mock

const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const req = () => new Request('http://test/start', { method: 'POST' })

function hostOf(code: string) {
  memberFindUnique.mockResolvedValue({ id: 'm1', roomId: 'r1', sessionToken: 'tok-1', isHost: true, userId: null })
  jar.set(sessionCookieName(code), 'tok-1')
}
function lobbyRoom(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    code: 'AAA-11',
    status: 'LOBBY',
    streamingServices: ['netflix'],
    filters: {},
    members: [{ id: 'm1', leftAt: null }, { id: 'm2', leftAt: null }],
    expiresAt: new Date(Date.now() + 3_600_000),
    ...over,
  }
}
const movies = (ids: string[]) => ids.map((tmdbId) => ({ tmdbId }))

beforeEach(() => {
  jar.clear()
  memberFindUnique.mockReset()
  roomFindUnique.mockReset()
  roomUpdate.mockReset()
  roomUpdate.mockResolvedValue({})
  queueCreateMany.mockReset()
  queueCreateMany.mockResolvedValue({ count: 0 })
  userUpdate.mockReset()
  userUpdate.mockResolvedValue({})
  mockDiscover.mockReset()
  mockAuth.mockReset()
  mockAuth.mockResolvedValue(null)
})

describe('POST /start', () => {
  it('401 without a session', async () => {
    expect((await start(req(), ctx('AAA-11'))).status).toBe(401)
  })

  it('403 for a non-host member', async () => {
    memberFindUnique.mockResolvedValue({ id: 'm1', roomId: 'r1', sessionToken: 'tok-1', isHost: false, userId: null })
    jar.set(sessionCookieName('AAA-11'), 'tok-1')
    expect((await start(req(), ctx('AAA-11'))).status).toBe(403)
  })

  it('404 when the room does not belong to the host', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom({ id: 'rX' }))
    expect((await start(req(), ctx('AAA-11'))).status).toBe(404)
  })

  it('409 when the room has already left LOBBY', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom({ status: 'VOTING' }))
    expect((await start(req(), ctx('AAA-11'))).status).toBe(409)
  })

  it('410 when the room has expired', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom({ expiresAt: new Date(Date.now() - 1_000) }))
    expect((await start(req(), ctx('AAA-11'))).status).toBe(410)
  })

  it('400 with fewer than 2 active members', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom({ members: [{ id: 'm1', leftAt: null }] }))
    expect((await start(req(), ctx('AAA-11'))).status).toBe(400)
  })

  it('400 when no streaming services are selected', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom({ streamingServices: [] }))
    expect((await start(req(), ctx('AAA-11'))).status).toBe(400)
  })

  it('400 when none of the selected services are valid ids', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom({ streamingServices: ['totally-bogus'] }))
    expect((await start(req(), ctx('AAA-11'))).status).toBe(400)
    expect(mockDiscover).not.toHaveBeenCalled()
  })

  it('422 when discovery finds no movies', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom())
    mockDiscover.mockResolvedValue([])
    expect((await start(req(), ctx('AAA-11'))).status).toBe(422)
  })

  it('builds the shared room queue and returns queueSize', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom()) // 2 members
    mockDiscover.mockResolvedValue(movies(['a', 'b', 'c']))

    const body = await (await start(req(), ctx('AAA-11'))).json()
    expect(body).toEqual({ queueSize: 3 })

    // room flips to VOTING inside the transaction
    expect(roomUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'VOTING' } })
    // shared room queue: 3 rows at positions 0,1,2 (order-independent on shuffle)
    const rq = queueCreateMany.mock.calls[0][0] as { data: { tmdbMovieId: string; position: number }[] }
    expect(rq.data.map((d) => d.position).sort((x, y) => x - y)).toEqual([0, 1, 2])
    expect(new Set(rq.data.map((d) => d.tmdbMovieId))).toEqual(new Set(['a', 'b', 'c']))
  })

  it('saves the host service/filter prefs when signed in', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom({ filters: { genres: [28] } }))
    mockDiscover.mockResolvedValue(movies(['a', 'b']))
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })

    await start(req(), ctx('AAA-11'))
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { savedServices: ['netflix'], savedFilters: { genres: [28] } },
    })
  })

  it('still returns 200 when saving prefs throws (non-fatal)', async () => {
    hostOf('AAA-11')
    roomFindUnique.mockResolvedValue(lobbyRoom())
    mockDiscover.mockResolvedValue(movies(['a', 'b']))
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    userUpdate.mockRejectedValueOnce(new Error('db down'))

    const res = await start(req(), ctx('AAA-11'))
    expect(res.status).toBe(200)
    expect((await res.json()).queueSize).toBe(2)
  })
})
