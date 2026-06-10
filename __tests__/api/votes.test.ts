/**
 * @jest-environment node
 *
 * Route tests for POST /api/rooms/[code]/votes — the main vote flow. Covers the
 * guards, the fresh-snapshot staleness check, queue advance on a NO, and match
 * detection on a YES. advanceQueueAtomic / checkForMatch are mocked (each has its
 * own unit suite); these assert the route's branching.
 */
import { POST as castVote } from '@/app/api/rooms/[code]/votes/route'
import { advanceQueueAtomic } from '@/lib/queue'
import { checkForMatch } from '@/lib/match'
import { getMovieById } from '@/lib/tmdb'
import { sessionCookieName } from '@/lib/session'

interface Member { id: string; roomId: string; sessionToken: string; leftAt: Date | null; approved: boolean; userId: string | null }
interface Room { id: string; code: string; status: string; currentPosition: number; queueVersion: number }
interface Fresh { currentPosition: number; queueVersion: number; status: string }

let mockMember: Member | null = null
let mockRoom: Room | null = null
let mockFresh: Fresh | null = null
let mockCurrentEntry: { tmdbMovieId: string } | null = null
let mockMatchEntry: { watchUrl: string; streamingService: string } | null = null

jest.mock('@/lib/prisma', () => ({
  prisma: {
    member: {
      findUnique: jest.fn(async ({ where }: { where: { sessionToken?: string } }) =>
        where.sessionToken && mockMember?.sessionToken === where.sessionToken ? mockMember : null
      ),
      update: jest.fn(async () => ({})),
    },
    room: {
      findUnique: jest.fn(async ({ where }: { where: { code?: string; id?: string } }) => {
        if (where.code) return mockRoom?.code === where.code ? mockRoom : null
        if (where.id) return mockFresh
        return null
      }),
    },
    roomQueue: {
      findFirst: jest.fn(async () => mockCurrentEntry),
      findUnique: jest.fn(async () => mockMatchEntry),
    },
    vote: { upsert: jest.fn(async () => ({})) },
  },
}))

jest.mock('@/lib/queue', () => ({ advanceQueueAtomic: jest.fn() }))
jest.mock('@/lib/match', () => ({ checkForMatch: jest.fn() }))
jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn() }))
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

const mockAdvance = advanceQueueAtomic as jest.Mock
const mockMatch = checkForMatch as jest.Mock
const mockMovie = getMovieById as jest.Mock
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
function req(body: Record<string, unknown>) {
  return new Request('http://test/votes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function authAs(code: string, over: Partial<Member> = {}) {
  mockMember = { id: 'm1', roomId: 'r1', sessionToken: 'tok-1', leftAt: null, approved: true, userId: null, ...over }
  jar.set(sessionCookieName(code), 'tok-1')
}

beforeEach(() => {
  mockMember = null
  mockRoom = { id: 'r1', code: 'AAA-11', status: 'VOTING', currentPosition: 2, queueVersion: 7 }
  mockFresh = { currentPosition: 2, queueVersion: 7, status: 'VOTING' }
  mockCurrentEntry = { tmdbMovieId: '10' }
  mockMatchEntry = { watchUrl: 'http://w', streamingService: 'netflix' }
  mockAdvance.mockReset()
  mockMatch.mockReset()
  mockMovie.mockReset()
  jar.clear()
})

describe('POST /votes', () => {
  it('401 without a session', async () => {
    mockMember = null
    expect((await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))).status).toBe(401)
  })

  it('403 for a member who has left or is unapproved', async () => {
    authAs('AAA-11', { approved: false })
    expect((await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))).status).toBe(403)
  })

  it('409 when the room is not in voting state', async () => {
    authAs('AAA-11')
    mockRoom = { id: 'r1', code: 'AAA-11', status: 'MATCHED', currentPosition: 2, queueVersion: 7 }
    expect((await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))).status).toBe(409)
  })

  it('400 when the vote field is not a boolean', async () => {
    authAs('AAA-11')
    expect((await castVote(req({ tmdbMovieId: '10' }), ctx('AAA-11'))).status).toBe(400)
  })

  it('409 stale vote when the submitted movie is not the current card', async () => {
    authAs('AAA-11')
    mockCurrentEntry = { tmdbMovieId: '99' } // current card is a different movie
    const res = await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/stale/i)
  })

  it('a NO vote advances the queue against the fresh snapshot', async () => {
    authAs('AAA-11')
    mockAdvance.mockResolvedValue({ advanced: true, newPosition: 3, newVersion: 8, status: 'VOTING' })
    const res = await castVote(req({ tmdbMovieId: '10', vote: false }), ctx('AAA-11'))
    const body = await res.json()
    expect(body.matched).toBe(false)
    expect(body.advance).toMatchObject({ advanced: true })
    expect(mockAdvance).toHaveBeenCalledWith('r1', 2, 7) // fresh position/version
    expect(mockMatch).not.toHaveBeenCalled()
  })

  it('a YES vote with no match returns { matched: false } without advancing', async () => {
    authAs('AAA-11')
    mockMatch.mockResolvedValue(null)
    const res = await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))
    expect(await res.json()).toEqual({ matched: false })
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('a YES vote that completes a match returns the hydrated movie', async () => {
    authAs('AAA-11')
    mockMatch.mockResolvedValue('10')
    mockMovie.mockResolvedValue({ tmdbId: '10', title: 'Parasite' })
    mockAdvance.mockResolvedValue({ advanced: true, newPosition: 3, newVersion: 8, status: 'MATCHED' })
    const res = await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))
    const body = await res.json()
    expect(body.matched).toBe(true)
    expect(body.movie).toMatchObject({ title: 'Parasite', watchUrl: 'http://w', streamingService: 'netflix' })
    expect(mockAdvance).toHaveBeenCalled()
  })
})
