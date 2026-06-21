/**
 * @jest-environment node
 *
 * M1 — the roster GET (`GET /api/rooms/[code]`) exposes only existence + name + status to a
 * non-member; the member roster, lastSeenAt, matched movie, and room config are members-only.
 * The GET is also IP rate-limited (checked before the room lookup, so probing unknown codes is
 * throttled too).
 */
import { GET as getRoom } from '@/app/api/rooms/[code]/route'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { prisma } from '@/lib/prisma'
import { sessionCookieName } from '@/lib/session'

const room = {
  id: 'r1', code: 'COOL-12', name: 'Movie Night', status: 'LOBBY',
  matchedMovieId: null, streamingServices: ['netflix'], filters: null,
  watchedFilter: false, expiresAt: new Date(Date.now() + 3_600_000),
}
const members = [
  { id: 'm1', roomId: 'r1', displayName: 'Alice', isHost: true, sessionToken: 'tok-alice', lastSeenAt: null, leftAt: null },
]

jest.mock('@/lib/prisma', () => ({
  prisma: {
    room: {
      findUnique: jest.fn(),
    },
    member: {
      findFirst: jest.fn(),
    },
    roomQueue: { findUnique: jest.fn(async () => null) },
  },
}))

jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn(async () => ({})) }))
jest.mock('@/lib/rate-limit-db', () => ({
  ...jest.requireActual('@/lib/rate-limit-db'),
  checkRateLimit: jest.fn(),
}))

const jar = new Map<string, string>()
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name)
      return value ? { name, value } : undefined
    },
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
  }),
}))

const findUnique = prisma.room.findUnique as jest.Mock
const findFirst = prisma.member.findFirst as jest.Mock

function ctx(code: string) {
  return { params: Promise.resolve({ code }) }
}
function getReq(code: string) {
  return new Request(`http://test/api/rooms/${code}`, { headers: { 'x-forwarded-for': '203.0.113.9' } })
}

beforeEach(() => {
  jar.clear()
  jest.clearAllMocks()
  ;(checkRateLimit as jest.Mock).mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
  findUnique.mockImplementation(async ({ where, include }: { where: { code?: string }; include?: { members?: unknown } }) => {
    const r = where.code === room.code ? room : null
    if (r && include?.members) {
      return {
        ...r,
        members: members
          .filter(m => m.roomId === r.id && m.leftAt === null)
          .map(m => ({ id: m.id, displayName: m.displayName, isHost: m.isHost, lastSeenAt: m.lastSeenAt })),
      }
    }
    return r
  })
  findFirst.mockImplementation(async ({ where }: { where: { sessionToken: string; roomId: string } }) =>
    members.find(m => m.sessionToken === where.sessionToken && m.roomId === where.roomId) ?? null)
})

test('a non-member sees only existence + name + status (no roster, no matched movie, no config)', async () => {
  const res = await getRoom(getReq('COOL-12'), ctx('COOL-12'))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({
    code: 'COOL-12',
    name: 'Movie Night',
    status: 'LOBBY',
    expired: false,
    isCurrentUserHost: false,
    currentMemberId: null,
  })
  // The sensitive fields must be entirely absent from the non-member payload.
  expect(body.members).toBeUndefined()
  expect(body.matchedMovie).toBeUndefined()
  expect(body.streamingServices).toBeUndefined()
})

test('a member receives the full payload including the roster and config', async () => {
  jar.set(sessionCookieName('COOL-12'), 'tok-alice')
  const res = await getRoom(getReq('COOL-12'), ctx('COOL-12'))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.currentMemberId).toBe('m1')
  expect(body.isCurrentUserHost).toBe(true)
  expect(body.members).toHaveLength(1)
  expect(body.members[0]).toMatchObject({ id: 'm1', displayName: 'Alice', isHost: true })
  expect(body.streamingServices).toEqual(['netflix'])
})

test('an unknown room still returns 404 (existence is the only thing leaked)', async () => {
  const res = await getRoom(getReq('NOPE-99'), ctx('NOPE-99'))
  expect(res.status).toBe(404)
})

test('the GET is IP rate-limited (429 + Retry-After) before the room lookup', async () => {
  ;(checkRateLimit as jest.Mock).mockResolvedValueOnce({ ok: false, retryAfterSeconds: 42 })
  const res = await getRoom(getReq('COOL-12'), ctx('COOL-12'))
  expect(res.status).toBe(429)
  expect(res.headers.get('Retry-After')).toBe('42')
  // Throttle fires before any DB work, so probing non-existent codes is also limited.
  expect(findUnique).not.toHaveBeenCalled()
})
