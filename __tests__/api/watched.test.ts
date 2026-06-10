/**
 * @jest-environment node
 *
 * Route tests for POST /api/rooms/[code]/watched — the "seen it" / "Skip the
 * Reruns" branching. Skip-reruns ON + the marked movie is the current card →
 * the shared queue advances (removed for the whole room). Otherwise the flag is
 * recorded only and the movie stays put.
 */
import { POST as markWatched } from '@/app/api/rooms/[code]/watched/route'
import { resolveMemberUserId } from '@/lib/link'
import { sessionCookieName } from '@/lib/session'

interface Member { id: string; roomId: string; sessionToken: string; userId: string | null }
interface Room { id: string; code: string; currentPosition: number; queueVersion: number; watchedFilter: boolean }
interface QueueEntry { tmdbMovieId: string }

let mockMember: Member | null = null
let mockRoom: Room | null = null
let mockCurrentEntry: QueueEntry | null = null
const mockAdvance = jest.fn()
const mockUpsert = jest.fn((_args: unknown) => Promise.resolve({}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    member: {
      findUnique: jest.fn(async ({ where }: { where: { sessionToken?: string } }) =>
        where.sessionToken && mockMember?.sessionToken === where.sessionToken ? mockMember : null
      ),
    },
    room: {
      findUnique: jest.fn(async ({ where }: { where: { code?: string; id?: string } }) => {
        if (where.code) return mockRoom?.code === where.code ? mockRoom : null
        if (where.id) return mockRoom?.id === where.id ? mockRoom : null
        return null
      }),
    },
    watchedMovie: { upsert: (args: unknown) => mockUpsert(args) },
    roomQueue: { findFirst: jest.fn(async () => mockCurrentEntry) },
  },
}))

jest.mock('@/lib/queue', () => ({ advanceQueueAtomic: (...args: unknown[]) => mockAdvance(...args) }))
jest.mock('@/lib/link', () => ({ resolveMemberUserId: jest.fn(async () => null) }))
jest.mock('@/lib/preferences', () => ({ addPreference: jest.fn(async () => {}) }))

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

const mockResolve = resolveMemberUserId as jest.Mock
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
function req(body: Record<string, unknown>) {
  return new Request('http://test/watched', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function authAs(code: string) {
  mockMember = { id: 'm1', roomId: 'r1', sessionToken: 'tok-1', userId: null }
  jar.set(sessionCookieName(code), 'tok-1')
}

beforeEach(() => {
  mockMember = null
  mockRoom = null
  mockCurrentEntry = null
  mockAdvance.mockReset()
  mockUpsert.mockClear()
  mockResolve.mockReset()
  mockResolve.mockResolvedValue(null)
  jar.clear()
})

describe('POST /watched', () => {
  it('401 without a session', async () => {
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect(res.status).toBe(401)
  })

  it('404 when the room does not belong to the member', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'rX', code: 'AAA-11', currentPosition: 0, queueVersion: 0, watchedFilter: false }
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect(res.status).toBe(404)
  })

  it('400 when tmdbMovieId is missing', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', currentPosition: 0, queueVersion: 0, watchedFilter: false }
    const res = await markWatched(req({}), ctx('AAA-11'))
    expect(res.status).toBe(400)
  })

  it('skip-reruns OFF: records the flag, does not remove the movie', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', currentPosition: 0, queueVersion: 0, watchedFilter: false }
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, removed: false })
    expect(mockUpsert).toHaveBeenCalled()
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('skip-reruns ON + marked movie is the current card: advances, removed:true', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', currentPosition: 3, queueVersion: 5, watchedFilter: true }
    mockCurrentEntry = { tmdbMovieId: '10' }
    mockAdvance.mockResolvedValue({ advanced: true, newPosition: 4, newVersion: 6, status: 'VOTING' })
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect((await res.json()).removed).toBe(true)
    expect(mockAdvance).toHaveBeenCalledWith('r1', 3, 5)
  })

  it('skip-reruns ON + marked movie is NOT current: records only, no advance', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', currentPosition: 3, queueVersion: 5, watchedFilter: true }
    mockCurrentEntry = { tmdbMovieId: '99' }
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect((await res.json()).removed).toBe(false)
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('still succeeds (200) when the SEEN_BEFORE hook throws', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', currentPosition: 0, queueVersion: 0, watchedFilter: false }
    mockResolve.mockRejectedValueOnce(new Error('hook boom'))
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})
