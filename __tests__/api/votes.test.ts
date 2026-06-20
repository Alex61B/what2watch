/**
 * @jest-environment node
 *
 * Route tests for POST /api/rooms/[code]/votes — the per-member vote flow. Each
 * member votes on their own card, so there's no shared-queue advance: a NO just
 * records a down-vote (which becomes a room-wide reject) and a YES runs match
 * detection. Covers the guards, the "movie is in this room" check, and the
 * NO/YES branching. checkForMatch is mocked (it has its own unit suite).
 */
import { POST as castVote } from '@/app/api/rooms/[code]/votes/route'
import { checkForMatch } from '@/lib/match'
import { getMovieById } from '@/lib/tmdb'
import { sessionCookieName } from '@/lib/session'

interface Member { id: string; roomId: string; sessionToken: string; leftAt: Date | null; approved: boolean; userId: string | null }
interface Room { id: string; code: string; status: string; currentPosition: number; queueVersion: number; expiresAt: Date }

let mockMember: Member | null = null
let mockRoom: Room | null = null
let mockQueueEntry: { tmdbMovieId: string; watchUrl: string; streamingService: string } | null = null

const mockVoteUpsert = jest.fn(async (_args: unknown) => ({}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    member: {
      findUnique: jest.fn(async ({ where }: { where: { sessionToken?: string } }) =>
        where.sessionToken && mockMember?.sessionToken === where.sessionToken ? mockMember : null
      ),
      update: jest.fn(async () => ({})),
    },
    room: {
      findUnique: jest.fn(async ({ where }: { where: { code?: string } }) =>
        where.code && mockRoom?.code === where.code ? mockRoom : null
      ),
    },
    roomQueue: {
      findUnique: jest.fn(async () => mockQueueEntry),
    },
    vote: { upsert: (args: unknown) => mockVoteUpsert(args) },
  },
}))

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
  mockRoom = { id: 'r1', code: 'AAA-11', status: 'VOTING', currentPosition: 2, queueVersion: 7, expiresAt: new Date(Date.now() + 3_600_000) }
  mockQueueEntry = { tmdbMovieId: '10', watchUrl: 'http://w', streamingService: 'netflix' }
  mockVoteUpsert.mockClear()
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
    mockRoom = { id: 'r1', code: 'AAA-11', status: 'MATCHED', currentPosition: 2, queueVersion: 7, expiresAt: new Date(Date.now() + 3_600_000) }
    expect((await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))).status).toBe(409)
  })

  it('410 when the room has expired', async () => {
    authAs('AAA-11')
    mockRoom!.expiresAt = new Date(Date.now() - 1_000)
    const res = await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))
    expect(res.status).toBe(410)
    expect(mockVoteUpsert).not.toHaveBeenCalled()
  })

  it('500 on an unexpected error returns a generic body with no internals leaked', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authAs('AAA-11')
    mockVoteUpsert.mockImplementationOnce(async () => {
      throw new Error('db boom at db.internal.host')
    })
    const res = await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(body)).not.toMatch(/stack|stage|db boom|db\.internal/i)
    spy.mockRestore()
  })

  it('400 when the vote field is not a boolean', async () => {
    authAs('AAA-11')
    expect((await castVote(req({ tmdbMovieId: '10' }), ctx('AAA-11'))).status).toBe(400)
  })

  it('409 when the movie is not part of this room', async () => {
    authAs('AAA-11')
    mockQueueEntry = null
    expect((await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))).status).toBe(409)
  })

  it('a NO just records a down-vote without advancing or checking for a match', async () => {
    authAs('AAA-11')
    const res = await castVote(req({ tmdbMovieId: '10', vote: false }), ctx('AAA-11'))
    expect(await res.json()).toEqual({ matched: false })
    expect(mockVoteUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ vote: false, tmdbMovieId: '10' }) })
    )
    expect(mockMatch).not.toHaveBeenCalled()
  })

  it('a YES vote with no match returns { matched: false }', async () => {
    authAs('AAA-11')
    mockMatch.mockResolvedValue(null)
    const res = await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))
    expect(await res.json()).toEqual({ matched: false })
    expect(mockMatch).toHaveBeenCalledWith('r1', '10')
  })

  it('a YES vote that completes a match returns the hydrated movie', async () => {
    authAs('AAA-11')
    mockMatch.mockResolvedValue('10')
    mockMovie.mockResolvedValue({ tmdbId: '10', title: 'Parasite' })
    const res = await castVote(req({ tmdbMovieId: '10', vote: true }), ctx('AAA-11'))
    const body = await res.json()
    expect(body.matched).toBe(true)
    expect(body.movie).toMatchObject({ title: 'Parasite', watchUrl: 'http://w', streamingService: 'netflix' })
  })
})
