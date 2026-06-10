/**
 * @jest-environment node
 *
 * Group D — join mid-session with host approval. Late (VOTING) joiners are
 * pending until the host accepts; pending members are excluded from the roster
 * and count, and can't vote; reject marks them not-admitted.
 */
import { POST as joinRoom } from '@/app/api/rooms/[code]/members/route'
import { GET as pollRoom } from '@/app/api/rooms/[code]/poll/route'
import { POST as approve } from '@/app/api/rooms/[code]/approvals/route'
import { POST as castVote } from '@/app/api/rooms/[code]/votes/route'
import { sessionCookieName } from '@/lib/session'

interface MemberRow {
  id: string
  roomId: string
  displayName: string
  sessionToken: string
  isHost: boolean
  approved: boolean
  userId: string | null
  joinedAt: Date
  leftAt: Date | null
}

const rooms = [
  { id: 'rA', code: 'AAA-11', status: 'LOBBY', matchedMovieId: null, currentPosition: 0, queueVersion: 0, watchedFilter: false, name: null },
  { id: 'rB', code: 'BBB-22', status: 'VOTING', matchedMovieId: null, currentPosition: 0, queueVersion: 0, watchedFilter: false, name: null },
]
let members: MemberRow[] = []
let seq = 0

jest.mock('@/lib/prisma', () => {
  const matchWhere = (m: MemberRow, where: { roomId?: string; leftAt?: null; approved?: boolean }) =>
    (where.roomId === undefined || m.roomId === where.roomId) &&
    (where.leftAt === undefined || m.leftAt === null) &&
    (where.approved === undefined || m.approved === where.approved)

  const prisma: Record<string, unknown> = {
      room: {
        findUnique: async ({ where }: { where: { code?: string; id?: string } }) =>
          rooms.find(r => (where.code ? r.code === where.code : r.id === where.id)) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: { queueVersion?: { increment: number } } }) => {
          const r = rooms.find(x => x.id === where.id)!
          if (data?.queueVersion?.increment) r.queueVersion += data.queueVersion.increment
          return r
        },
      },
      member: {
        create: async ({ data }: { data: Partial<MemberRow> }) => {
          const row: MemberRow = {
            id: `m${++seq}`, roomId: data.roomId!, displayName: data.displayName!,
            sessionToken: data.sessionToken!, isHost: data.isHost ?? false,
            approved: data.approved ?? true, userId: null, joinedAt: new Date(seq), leftAt: null,
          }
          members.push(row)
          return row
        },
        findUnique: async ({ where }: { where: { sessionToken?: string; id?: string } }) => {
          if (where.sessionToken) return members.find(m => m.sessionToken === where.sessionToken) ?? null
          if (where.id) return members.find(m => m.id === where.id) ?? null
          return null
        },
        findMany: async ({ where }: { where: { roomId: string; leftAt: null; approved: boolean } }) =>
          members.filter(m => matchWhere(m, where))
            .map(m => ({ id: m.id, displayName: m.displayName, isHost: m.isHost })),
        count: async ({ where }: { where: { roomId: string; leftAt: null; approved: boolean } }) =>
          members.filter(m => matchWhere(m, where)).length,
        update: async ({ where, data }: { where: { id: string }; data: Partial<MemberRow> }) => {
          const row = members.find(m => m.id === where.id)!
          Object.assign(row, data)
          return row
        },
      },
      vote: { findMany: async () => [] },
      roomQueue: {
        findMany: async () => [],
        count: async () => 0,
        findFirst: async () => null,
        findUnique: async () => null,
      },
      memberQueue: { createMany: async () => ({ count: 0 }) },
  }
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)
  return { prisma }
})

jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn(async () => ({})) }))
// The votes route transitively pulls in NextAuth (ESM) via these modules; stub
// them so the suite can import the route without loading next-auth.
jest.mock('@/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('@/lib/link', () => ({ resolveMemberUserId: jest.fn(async () => null) }))
jest.mock('@/lib/preferences', () => ({ addPreference: jest.fn(async () => {}) }))

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
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  })
}
function applyCookies(res: { cookies: { getAll: () => { name: string; value: string }[] } }) {
  for (const { name, value } of res.cookies.getAll()) {
    if (value) jar.set(name, value); else jar.delete(name)
  }
}
function asMember(code: string, token: string) {
  jar.set(sessionCookieName(code), token)
}
async function pollAs(code: string, token: string) {
  asMember(code, token)
  const res = await pollRoom(new Request(`http://test/api/rooms/${code}/poll`), ctx(code))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  members = [
    { id: 'host', roomId: 'rB', displayName: 'Host', sessionToken: 'tok-host', isHost: true, approved: true, userId: null, joinedAt: new Date(0), leftAt: null },
  ]
  seq = 0
  jar.clear()
})

test('lobby join is approved; voting join is pending', async () => {
  await joinRoom(joinReq('AAA-11', 'Lobby Lou'), ctx('AAA-11'))
  expect(members.find(m => m.displayName === 'Lobby Lou')?.approved).toBe(true)

  await joinRoom(joinReq('BBB-22', 'Late Larry'), ctx('BBB-22'))
  expect(members.find(m => m.displayName === 'Late Larry')?.approved).toBe(false)
})

test('pending member is excluded from roster/count and sees pendingApproval; host sees the request', async () => {
  const joinRes = await joinRoom(joinReq('BBB-22', 'Late Larry'), ctx('BBB-22'))
  applyCookies(joinRes)
  const larryToken = members.find(m => m.displayName === 'Late Larry')!.sessionToken

  const larry = await pollAs('BBB-22', larryToken)
  expect(larry.body.pendingApproval).toBe(true)
  expect(larry.body.memberCount).toBe(1) // only the approved host
  expect(larry.body.members.map((m: { displayName: string }) => m.displayName)).toEqual(['Host'])

  const host = await pollAs('BBB-22', 'tok-host')
  expect(host.body.pendingMembers.map((m: { displayName: string }) => m.displayName)).toEqual(['Late Larry'])
})

test('a pending member cannot vote', async () => {
  await joinRoom(joinReq('BBB-22', 'Late Larry'), ctx('BBB-22'))
  const larryToken = members.find(m => m.displayName === 'Late Larry')!.sessionToken
  asMember('BBB-22', larryToken)
  const res = await castVote(
    new Request('http://test/api/rooms/BBB-22/votes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tmdbMovieId: '1', vote: true }),
    }),
    ctx('BBB-22')
  )
  expect(res.status).toBe(403)
})

test('host accept approves the member; they then appear in the roster', async () => {
  await joinRoom(joinReq('BBB-22', 'Late Larry'), ctx('BBB-22'))
  const larry = members.find(m => m.displayName === 'Late Larry')!

  asMember('BBB-22', 'tok-host')
  const res = await approve(
    new Request('http://test/api/rooms/BBB-22/approvals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: larry.id, action: 'accept' }),
    }),
    ctx('BBB-22')
  )
  expect(res.status).toBe(200)
  expect(larry.approved).toBe(true)

  const after = await pollAs('BBB-22', larry.sessionToken)
  expect(after.body.pendingApproval).toBe(false)
  expect(after.body.memberCount).toBe(2)
})

test('host reject marks the member not-admitted', async () => {
  await joinRoom(joinReq('BBB-22', 'Late Larry'), ctx('BBB-22'))
  const larry = members.find(m => m.displayName === 'Late Larry')!

  asMember('BBB-22', 'tok-host')
  await approve(
    new Request('http://test/api/rooms/BBB-22/approvals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: larry.id, action: 'reject' }),
    }),
    ctx('BBB-22')
  )
  expect(larry.leftAt).not.toBeNull()

  const after = await pollAs('BBB-22', larry.sessionToken)
  expect(after.body.notAdmitted).toBe(true)
})

test('non-host cannot approve', async () => {
  await joinRoom(joinReq('BBB-22', 'Late Larry'), ctx('BBB-22'))
  const larry = members.find(m => m.displayName === 'Late Larry')!
  // Larry (pending, non-host) tries to approve himself.
  asMember('BBB-22', larry.sessionToken)
  const res = await approve(
    new Request('http://test/api/rooms/BBB-22/approvals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: larry.id, action: 'accept' }),
    }),
    ctx('BBB-22')
  )
  expect(res.status).toBe(403)
})
