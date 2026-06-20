/**
 * @jest-environment node
 *
 * Route tests for GET /api/cron/cleanup — the Vercel-cron cleanup job. Rejects anything
 * without the CRON_SECRET bearer; with it, purges expired rooms, old events, and
 * soft-leaves stale members. Prisma is mocked.
 */
import { GET } from '@/app/api/cron/cleanup/route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    room: { deleteMany: jest.fn(async () => ({ count: 2 })) },
    event: { deleteMany: jest.fn(async () => ({ count: 5 })) },
    member: { updateMany: jest.fn(async () => ({ count: 1 })) },
    $executeRaw: jest.fn(async () => 3),
  },
}))

const roomDelete = prisma.room.deleteMany as jest.Mock
const eventDelete = prisma.event.deleteMany as jest.Mock
const memberUpdate = prisma.member.updateMany as jest.Mock

const ORIG = process.env.CRON_SECRET
beforeAll(() => {
  process.env.CRON_SECRET = 'sekret'
})
afterAll(() => {
  process.env.CRON_SECRET = ORIG
})
beforeEach(() => jest.clearAllMocks())

const get = (auth?: string) =>
  GET(new Request('http://t/api/cron/cleanup', { headers: auth ? { authorization: auth } : {} }))

test('401 without the bearer secret, and touches nothing', async () => {
  const res = await get()
  expect(res.status).toBe(401)
  expect(roomDelete).not.toHaveBeenCalled()
})

test('401 with a wrong secret', async () => {
  expect((await get('Bearer nope')).status).toBe(401)
  expect(roomDelete).not.toHaveBeenCalled()
})

test('with the secret: purges expired rooms, old events, stale members; returns counts', async () => {
  const res = await get('Bearer sekret')
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({
    ok: true,
    roomsDeleted: 2,
    eventsDeleted: 5,
    membersLeft: 1,
  })
  expect(roomDelete).toHaveBeenCalledWith({ where: { expiresAt: { lt: expect.any(Date) } } })
  expect(eventDelete).toHaveBeenCalledWith({ where: { ts: { lt: expect.any(Date) } } })
  expect(memberUpdate).toHaveBeenCalledWith({
    where: { leftAt: null, lastSeenAt: { lt: expect.any(Date) } },
    data: { leftAt: expect.any(Date) },
  })
})
