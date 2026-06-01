/**
 * @jest-environment node
 *
 * Regression: poll responses must be non-cacheable. The ETag is queueVersion,
 * which doesn't change on LOBBY->VOTING or on member join; without
 * `Cache-Control: no-store` the browser served a stale cached body (304),
 * leaving the setup roster stale and the 2nd user stuck on "Waiting...".
 */
import { GET as pollRoom } from '@/app/api/rooms/[code]/poll/route'

interface MemberRow {
  id: string; roomId: string; displayName: string; sessionToken: string
  isHost: boolean; approved: boolean; userId: string | null
  joinedAt: Date; lastSeenAt: Date | null; leftAt: Date | null
}

const rooms = [
  { id: 'rA', code: 'AAA-11', status: 'VOTING', matchedMovieId: null, currentPosition: 0, queueVersion: 0, watchedFilter: false, name: null },
]
const members: MemberRow[] = [
  { id: 'm1', roomId: 'rA', displayName: 'Bob', sessionToken: 'tok-bob', isHost: false, approved: true, userId: null, joinedAt: new Date(1), lastSeenAt: null, leftAt: null },
]

jest.mock('@/lib/prisma', () => ({
  prisma: {
    room: { findUnique: async ({ where }: { where: { code?: string; id?: string } }) =>
      rooms.find(r => (where.code ? r.code === where.code : r.id === where.id)) ?? null },
    member: {
      findUnique: async ({ where }: { where: { sessionToken?: string; id?: string } }) =>
        members.find(m => (where.sessionToken ? m.sessionToken === where.sessionToken : m.id === where.id)) ?? null,
      findMany: async ({ where }: { where: { approved: boolean } }) =>
        members.filter(m => m.approved === where.approved).map(m => ({ id: m.id, displayName: m.displayName, isHost: m.isHost })),
      count: async () => members.filter(m => m.approved && m.leftAt === null).length,
      update: async () => ({}),
    },
    vote: { findMany: async () => [] },
    roomQueue: { count: async () => 0, findFirst: async () => null, findUnique: async () => null },
  },
}))

jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn(async () => ({})), getWatchProviders: jest.fn(async () => ({ providers: [], link: null })) }))

const jar = new Map<string, string>([['w2w_session_AAA-11', 'tok-bob']])
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => { const v = jar.get(name); return v ? { name, value: v } : undefined },
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
  }),
}))

const ctx = (code: string) => ({ params: Promise.resolve({ code }) })

test('200 poll response sets Cache-Control: no-store', async () => {
  const res = await pollRoom(new Request('http://test/api/rooms/AAA-11/poll'), ctx('AAA-11'))
  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
})

test('304 poll response also sets Cache-Control: no-store', async () => {
  // Approved non-host member with a matching ETag short-circuits to 304.
  const res = await pollRoom(
    new Request('http://test/api/rooms/AAA-11/poll', { headers: { 'If-None-Match': '"0"' } }),
    ctx('AAA-11')
  )
  expect(res.status).toBe(304)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
})
