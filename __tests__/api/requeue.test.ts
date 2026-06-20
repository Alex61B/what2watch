/**
 * @jest-environment node
 *
 * Route tests for POST /api/rooms/[code]/requeue — host-only mid-session rebuild.
 * Covers the guards, the VOTING vs DRAINED position math, the exclusion set, and
 * the no-fresh-movies branch.
 */
import { POST as requeue } from '@/app/api/rooms/[code]/requeue/route'
import { discoverMovies } from '@/lib/tmdb'
import { sessionCookieName } from '@/lib/session'

interface Member { id: string; roomId: string; sessionToken: string; isHost: boolean }
interface Room {
  id: string
  code: string
  status: string
  streamingServices: string[]
  filters: Record<string, unknown> | null
  currentPosition: number
  queueVersion: number
  watchedFilter: boolean
  expiresAt: Date
}

let mockMember: Member | null = null
let mockRoom: Room | null = null
let mockRejected: { tmdbMovieId: string }[] = []
let mockKept: { tmdbMovieId: string }[] = []
let mockWatched: { tmdbMovieId: string }[] = []
const mockDeleteMany = jest.fn((_args: unknown) => Promise.resolve({ count: 0 }))
const mockCreateMany = jest.fn((_args: unknown) => Promise.resolve({ count: 0 }))
const mockRoomUpdate = jest.fn((_args: unknown) => Promise.resolve({}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    member: {
      findUnique: jest.fn(async ({ where }: { where: { sessionToken?: string } }) =>
        where.sessionToken && mockMember?.sessionToken === where.sessionToken ? mockMember : null
      ),
    },
    room: {
      findUnique: jest.fn(async ({ where }: { where: { code?: string } }) =>
        where.code && mockRoom?.code === where.code ? mockRoom : null
      ),
      update: (args: unknown) => mockRoomUpdate(args),
    },
    vote: { findMany: jest.fn(async () => mockRejected) },
    roomQueue: {
      findMany: jest.fn(async () => mockKept),
      deleteMany: (args: unknown) => mockDeleteMany(args),
      createMany: (args: unknown) => mockCreateMany(args),
    },
    watchedMovie: { findMany: jest.fn(async () => mockWatched) },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}))

jest.mock('@/lib/tmdb', () => ({
  ...jest.requireActual('@/lib/tmdb'),
  discoverMovies: jest.fn(),
}))

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

const mockDiscover = discoverMovies as jest.Mock
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const req = () => new Request('http://test/requeue', { method: 'POST' })

function hostOf(code: string) {
  mockMember = { id: 'm1', roomId: 'r1', sessionToken: 'tok-1', isHost: true }
  jar.set(sessionCookieName(code), 'tok-1')
}
function votingRoom(over: Partial<Room> = {}): Room {
  return {
    id: 'r1',
    code: 'AAA-11',
    status: 'VOTING',
    streamingServices: ['netflix'],
    filters: {},
    currentPosition: 3,
    queueVersion: 5,
    watchedFilter: false,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...over,
  }
}
function movies(ids: string[]) {
  return ids.map((tmdbMovieId) => ({ tmdbId: tmdbMovieId }))
}

beforeEach(() => {
  mockMember = null
  mockRoom = null
  mockRejected = []
  mockKept = []
  mockWatched = []
  mockDeleteMany.mockClear()
  mockCreateMany.mockClear()
  mockRoomUpdate.mockClear()
  mockDiscover.mockReset()
  jar.clear()
})

describe('POST /requeue', () => {
  it('401 without a session', async () => {
    expect((await requeue(req(), ctx('AAA-11'))).status).toBe(401)
  })

  it('403 for a non-host member', async () => {
    mockMember = { id: 'm1', roomId: 'r1', sessionToken: 'tok-1', isHost: false }
    jar.set(sessionCookieName('AAA-11'), 'tok-1')
    expect((await requeue(req(), ctx('AAA-11'))).status).toBe(403)
  })

  it('404 when the room does not belong to the host', async () => {
    hostOf('AAA-11')
    mockRoom = votingRoom({ id: 'rX' })
    expect((await requeue(req(), ctx('AAA-11'))).status).toBe(404)
  })

  it('409 when the room is not in a votable state', async () => {
    hostOf('AAA-11')
    mockRoom = votingRoom({ status: 'LOBBY' })
    expect((await requeue(req(), ctx('AAA-11'))).status).toBe(409)
  })

  it('410 when the room has expired', async () => {
    hostOf('AAA-11')
    mockRoom = votingRoom({ expiresAt: new Date(Date.now() - 1_000) })
    expect((await requeue(req(), ctx('AAA-11'))).status).toBe(410)
  })

  it('400 when there are no valid streaming services', async () => {
    hostOf('AAA-11')
    mockRoom = votingRoom({ streamingServices: [] })
    expect((await requeue(req(), ctx('AAA-11'))).status).toBe(400)
  })

  it('returns { requeued: false } and leaves the queue when nothing fresh matches', async () => {
    hostOf('AAA-11')
    mockRoom = votingRoom()
    mockRejected = [{ tmdbMovieId: '1' }]
    mockDiscover.mockResolvedValue(movies(['1'])) // only an already-rejected movie
    const body = await (await requeue(req(), ctx('AAA-11'))).json()
    expect(body).toEqual({ requeued: false, added: 0 })
    expect(mockDeleteMany).not.toHaveBeenCalled()
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('VOTING: appends fresh movies after the current card and bumps queueVersion', async () => {
    hostOf('AAA-11')
    mockRoom = votingRoom({ currentPosition: 3 })
    mockKept = [{ tmdbMovieId: 'k1' }] // already in the queue
    mockRejected = [{ tmdbMovieId: 'r9' }] // down-voted
    mockDiscover.mockResolvedValue(movies(['k1', 'r9', 'a', 'b'])) // k1/r9 excluded → a,b fresh

    const body = await (await requeue(req(), ctx('AAA-11'))).json()
    expect(body).toEqual({ requeued: true, added: 2 })

    // delete everything after the current card
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { roomId: 'r1', position: { gte: 4 } } })
    // new entries start at currentPosition + 1
    const created = mockCreateMany.mock.calls[0][0] as { data: { tmdbMovieId: string; position: number }[] }
    expect(created.data.map((d) => d.position).sort((x, y) => x - y)).toEqual([4, 5])
    expect(new Set(created.data.map((d) => d.tmdbMovieId))).toEqual(new Set(['a', 'b']))
    // queueVersion bumped, currentPosition NOT moved in VOTING
    const updated = mockRoomUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updated.data).toMatchObject({ status: 'VOTING', queueVersion: { increment: 1 } })
    expect(updated.data).not.toHaveProperty('currentPosition')
  })

  it('DRAINED: fills the current slot and resumes voting', async () => {
    hostOf('AAA-11')
    mockRoom = votingRoom({ status: 'DRAINED', currentPosition: 10 })
    mockDiscover.mockResolvedValue(movies(['x', 'y']))

    const body = await (await requeue(req(), ctx('AAA-11'))).json()
    expect(body).toEqual({ requeued: true, added: 2 })

    // startPos === currentPosition when drained
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { roomId: 'r1', position: { gte: 10 } } })
    const created = mockCreateMany.mock.calls[0][0] as { data: { position: number }[] }
    expect(created.data.map((d) => d.position).sort((x, y) => x - y)).toEqual([10, 11])
    const updated = mockRoomUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updated.data).toMatchObject({ status: 'VOTING', currentPosition: 10 })
  })

  it('excludes watched movies when watchedFilter is on', async () => {
    hostOf('AAA-11')
    mockRoom = votingRoom({ watchedFilter: true })
    mockWatched = [{ tmdbMovieId: 'seen' }]
    mockDiscover.mockResolvedValue(movies(['seen', 'new']))

    const body = await (await requeue(req(), ctx('AAA-11'))).json()
    expect(body).toEqual({ requeued: true, added: 1 })
    const created = mockCreateMany.mock.calls[0][0] as { data: { tmdbMovieId: string }[] }
    expect(created.data.map((d) => d.tmdbMovieId)).toEqual(['new'])
  })
})
