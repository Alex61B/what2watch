/**
 * @jest-environment node
 *
 * Route tests for POST /api/rooms/[code]/watched — the "seen it" / "Skip the
 * Reruns" flag. With per-member decks there's no shared-queue advance: the route
 * records a WatchedMovie row (which /queue then excludes — room-wide when
 * watchedFilter is ON, otherwise just for this member) and runs the SEEN_BEFORE
 * preference hook. Covers the guards and that no shared advance happens.
 */
import { POST as markWatched } from '@/app/api/rooms/[code]/watched/route'
import { resolveMemberUserId } from '@/lib/link'
import { sessionCookieName } from '@/lib/session'

interface Member { id: string; roomId: string; sessionToken: string; userId: string | null }
interface Room { id: string; code: string; watchedFilter: boolean; expiresAt: Date }
const FUTURE = () => new Date(Date.now() + 3_600_000)

let mockMember: Member | null = null
let mockRoom: Room | null = null
const mockUpsert = jest.fn((_args: unknown) => Promise.resolve({}))

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
    },
    watchedMovie: { upsert: (args: unknown) => mockUpsert(args) },
  },
}))

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
    mockRoom = { id: 'rX', code: 'AAA-11', watchedFilter: false, expiresAt: FUTURE() }
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect(res.status).toBe(404)
  })

  it('400 when tmdbMovieId is missing', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', watchedFilter: false, expiresAt: FUTURE() }
    const res = await markWatched(req({}), ctx('AAA-11'))
    expect(res.status).toBe(400)
  })

  it('skip-reruns OFF: records the seen flag and returns ok', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', watchedFilter: false, expiresAt: FUTURE() }
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('skip-reruns ON: records the seen flag (removal handled by /queue, no shared advance)', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', watchedFilter: true, expiresAt: FUTURE() }
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('still succeeds (200) when the SEEN_BEFORE hook throws', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', watchedFilter: false, expiresAt: FUTURE() }
    mockResolve.mockRejectedValueOnce(new Error('hook boom'))
    const res = await markWatched(req({ tmdbMovieId: '10' }), ctx('AAA-11'))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})
