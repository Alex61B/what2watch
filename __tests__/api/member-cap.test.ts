/**
 * @jest-environment node
 *
 * M-join: POST /api/rooms/[code]/members caps active (not-left) members per room. The cap is
 * counted inside the join transaction so concurrent joins can't both slip past it. Prisma's
 * interactive transaction, the session helpers, and the limiter are mocked.
 */
import { POST as join } from '@/app/api/rooms/[code]/members/route'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { MAX_ROOM_MEMBERS } from '@/lib/room'

const mockMemberCount = jest.fn(async () => 0)
const mockMemberCreate = jest.fn(async () => ({ id: 'm-new' }))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    room: {
      findUnique: jest.fn(async () => ({
        id: 'r1', code: 'AAA-11', status: 'LOBBY', expiresAt: new Date(Date.now() + 3_600_000),
      })),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        room: { findUnique: jest.fn(async () => ({ status: 'LOBBY' })), update: jest.fn(async () => ({})) },
        member: { count: mockMemberCount, create: mockMemberCreate },
      }),
    ),
  },
}))
jest.mock('@/lib/session', () => ({ generateSessionToken: () => 'tok-new', setSessionCookie: jest.fn() }))
jest.mock('@/lib/rate-limit-db', () => ({
  ...jest.requireActual('@/lib/rate-limit-db'),
  checkRateLimit: jest.fn(async () => ({ ok: true, retryAfterSeconds: 0 })),
}))

const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const joinRoom = (body: Record<string, unknown>) =>
  join(
    new Request('http://test/members', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    ctx('AAA-11'),
  )

beforeEach(() => {
  mockMemberCount.mockReset().mockResolvedValue(0)
  mockMemberCreate.mockClear()
  ;(checkRateLimit as jest.Mock).mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
})

test('allows a join when the room is under the member cap', async () => {
  mockMemberCount.mockResolvedValue(MAX_ROOM_MEMBERS - 1)
  const res = await joinRoom({ displayName: 'Al' })
  expect(res.status).toBe(200)
  expect(mockMemberCreate).toHaveBeenCalled()
  expect((await res.json()).memberId).toBe('m-new')
})

test('rejects with 409 "Room is full" when the room is at the member cap', async () => {
  mockMemberCount.mockResolvedValue(MAX_ROOM_MEMBERS)
  const res = await joinRoom({ displayName: 'Al' })
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Room is full' })
  expect(mockMemberCreate).not.toHaveBeenCalled()
})
