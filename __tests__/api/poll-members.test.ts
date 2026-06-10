/**
 * @jest-environment node
 *
 * The poll response must include a `members` roster (id, displayName, isHost)
 * limited to active members (leftAt: null), so the setup and vote screens can
 * show who is in the room.
 */
import { POST as joinRoom } from '@/app/api/rooms/[code]/members/route'
import { GET as pollRoom } from '@/app/api/rooms/[code]/poll/route'

interface MemberRow {
  id: string
  roomId: string
  displayName: string
  sessionToken: string
  isHost: boolean
  userId: string | null
  joinedAt: Date
  lastSeenAt: Date | null
  leftAt: Date | null
}

const rooms = [
  { id: 'rA', code: 'AAA-11', status: 'LOBBY', matchedMovieId: null, currentPosition: 0, queueVersion: 0, watchedFilter: false },
]
let members: MemberRow[] = []
let seq = 0

jest.mock('@/lib/prisma', () => {
  const prisma: Record<string, unknown> = {
    room: {
      findUnique: jest.fn(async ({ where }: { where: { code?: string; id?: string } }) =>
        rooms.find(r => (where.code ? r.code === where.code : r.id === where.id)) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { queueVersion?: { increment: number } } }) => {
        const r = rooms.find(x => x.id === where.id)!
        if (data?.queueVersion?.increment) r.queueVersion = (r.queueVersion ?? 0) + data.queueVersion.increment
        return r
      }),
    },
    member: {
      create: jest.fn(async ({ data }: { data: { roomId: string; displayName: string; sessionToken: string; isHost: boolean } }) => {
        const row: MemberRow = {
          id: `m${++seq}`,
          roomId: data.roomId,
          displayName: data.displayName,
          sessionToken: data.sessionToken,
          isHost: data.isHost,
          userId: null,
          joinedAt: new Date(seq),
          lastSeenAt: null,
          leftAt: null,
        }
        members.push(row)
        return row
      }),
      findUnique: jest.fn(async ({ where }: { where: { sessionToken?: string; id?: string } }) => {
        if (where.sessionToken) return members.find(m => m.sessionToken === where.sessionToken) ?? null
        if (where.id) return members.find(m => m.id === where.id) ?? null
        return null
      }),
      findMany: jest.fn(async ({ where }: { where: { roomId: string; leftAt: null } }) =>
        members
          .filter(m => m.roomId === where.roomId && m.leftAt === null)
          .map(m => ({ id: m.id, displayName: m.displayName, isHost: m.isHost }))),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<MemberRow> }) => {
        const row = members.find(m => m.id === where.id)!
        Object.assign(row, data)
        return row
      }),
      count: jest.fn(async ({ where }: { where: { roomId: string } }) =>
        members.filter(m => m.roomId === where.roomId && m.leftAt === null).length),
    },
    vote: { findMany: jest.fn(async () => []) },
    roomQueue: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
    },
    memberQueue: { createMany: jest.fn(async () => ({ count: 0 })) },
  }
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)
  return { prisma }
})

jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn(async () => ({})) }))

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

function ctx(code: string) {
  return { params: Promise.resolve({ code }) }
}
function joinReq(code: string, displayName: string) {
  return new Request(`http://test/api/rooms/${code}/members`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  })
}
function applyCookies(res: { cookies: { getAll: () => { name: string; value: string }[] } }) {
  for (const { name, value } of res.cookies.getAll()) {
    if (value) jar.set(name, value)
    else jar.delete(name)
  }
}

beforeEach(() => {
  members = []
  seq = 0
  jar.clear()
})

test('poll response includes an active-members roster', async () => {
  applyCookies(await joinRoom(joinReq('AAA-11', 'Alice'), ctx('AAA-11')))
  applyCookies(await joinRoom(joinReq('AAA-11', 'Bob'), ctx('AAA-11')))
  // A member who left must be excluded from the roster.
  members.push({
    id: 'gone', roomId: 'rA', displayName: 'Ghost', sessionToken: 'x',
    isHost: false, userId: null, joinedAt: new Date(99), lastSeenAt: null, leftAt: new Date(),
  })

  const res = await pollRoom(new Request('http://test/api/rooms/AAA-11/poll'), ctx('AAA-11'))
  expect(res.status).toBe(200)
  const body = await res.json()

  expect(Array.isArray(body.members)).toBe(true)
  expect(body.members.map((m: { displayName: string }) => m.displayName)).toEqual(['Alice', 'Bob'])
  expect(body.members.every((m: { id: string }) => typeof m.id === 'string')).toBe(true)
  expect(body.members.some((m: { displayName: string }) => m.displayName === 'Ghost')).toBe(false)
})
