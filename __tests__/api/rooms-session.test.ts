/**
 * @jest-environment node
 *
 * Regression test for the cross-room session-cookie bug.
 *
 * A browser that is a member of two rooms must be able to poll each room
 * independently. With the old single global `w2w_session` cookie, joining
 * room B evicted room A's session, so polling room A returned a misleading
 * 404 `room_not_found`. Per-room cookies (`w2w_session_<CODE>`) fix this.
 */
import { POST as joinRoom } from '@/app/api/rooms/[code]/members/route'
import { GET as pollRoom } from '@/app/api/rooms/[code]/poll/route'
import { sessionCookieName } from '@/lib/session'

interface MemberRow {
  id: string
  roomId: string
  displayName: string
  sessionToken: string
  isHost: boolean
  userId: string | null
  lastSeenAt: Date | null
  leftAt: Date | null
}

const rooms = [
  { id: 'rA', code: 'AAA-11', status: 'LOBBY', matchedMovieId: null, currentPosition: 0, queueVersion: 0, watchedFilter: false },
  { id: 'rB', code: 'BBB-22', status: 'LOBBY', matchedMovieId: null, currentPosition: 0, queueVersion: 0, watchedFilter: false },
]
let members: MemberRow[] = []

jest.mock('@/lib/prisma', () => ({
  prisma: {
    room: {
      findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
        rooms.find(r => r.code === where.code) ?? null),
    },
    member: {
      create: jest.fn(async ({ data }: { data: { roomId: string; displayName: string; sessionToken: string; isHost: boolean } }) => {
        const row: MemberRow = {
          id: `m${members.length + 1}`,
          roomId: data.roomId,
          displayName: data.displayName,
          sessionToken: data.sessionToken,
          isHost: data.isHost,
          userId: null,
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
  },
}))

jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn(async () => ({})) }))

// A cookie jar standing in for the browser, backing next/headers cookies().
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
function pollReq(code: string) {
  return new Request(`http://test/api/rooms/${code}/poll`)
}
// Mirror Set-Cookie headers from a route response into the jar, like a browser.
function applyCookies(res: { cookies: { getAll: () => { name: string; value: string }[] } }) {
  for (const { name, value } of res.cookies.getAll()) {
    if (value) jar.set(name, value)
    else jar.delete(name)
  }
}

beforeEach(() => {
  members = []
  jar.clear()
})

test('a browser that joins two rooms can poll each room independently', async () => {
  applyCookies(await joinRoom(joinReq('AAA-11', 'Alice'), ctx('AAA-11')))
  applyCookies(await joinRoom(joinReq('BBB-22', 'Alice'), ctx('BBB-22')))

  // Joining the second room must not evict the first room's session.
  expect(jar.has(sessionCookieName('AAA-11'))).toBe(true)
  expect(jar.has(sessionCookieName('BBB-22'))).toBe(true)

  const pollB = await pollRoom(pollReq('BBB-22'), ctx('BBB-22'))
  expect(pollB.status).toBe(200)
  expect((await pollB.json()).status).toBe('LOBBY')

  // The first room must still be reachable — this is the production bug.
  const pollA = await pollRoom(pollReq('AAA-11'), ctx('AAA-11'))
  expect(pollA.status).toBe(200)
  expect((await pollA.json()).status).toBe('LOBBY')
})

test('polling with a cookie whose member belongs to another room returns 403 and clears it', async () => {
  applyCookies(await joinRoom(joinReq('AAA-11', 'Alice'), ctx('AAA-11')))
  // Forge room B's cookie slot pointing at room A's member token.
  jar.set(sessionCookieName('BBB-22'), jar.get(sessionCookieName('AAA-11'))!)

  const res = await pollRoom(pollReq('BBB-22'), ctx('BBB-22'))
  expect(res.status).toBe(403)
  expect((await res.json()).reason).toBe('wrong_room')
  expect(res.cookies.get(sessionCookieName('BBB-22'))?.value).toBe('')
})
