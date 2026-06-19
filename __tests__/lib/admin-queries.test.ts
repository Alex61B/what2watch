/**
 * @jest-environment node
 *
 * Unit tests for the read-only admin data layer. Prisma is fully mocked (repo convention).
 * Beyond shape, these assert two safety properties: (a) Event.userId is manually joined to
 * User without a Prisma relation, and (b) no query ever selects a forbidden PII column.
 */
import {
  PAGE_SIZE,
  getOverviewMetrics,
  getActiveUsersByDay,
  listUsers,
  getUserDetail,
  listUserEvents,
  listEvents,
} from '@/lib/admin-queries'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    event: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    $queryRaw: jest.fn(),
  },
}))

const userCount = prisma.user.count as jest.Mock
const userFindMany = prisma.user.findMany as jest.Mock
const userFindUnique = prisma.user.findUnique as jest.Mock
const eventCount = prisma.event.count as jest.Mock
const eventFindMany = prisma.event.findMany as jest.Mock
const groupBy = prisma.event.groupBy as jest.Mock
const queryRaw = prisma.$queryRaw as unknown as jest.Mock

const FORBIDDEN = ['passwordHash', 'sessionToken', 'access_token', 'refresh_token', 'id_token']
const assertSafeSelect = (select: Record<string, unknown> | undefined) => {
  for (const k of FORBIDDEN) expect(select ?? {}).not.toHaveProperty(k)
}

beforeEach(() => jest.clearAllMocks())

describe('getOverviewMetrics', () => {
  test('aggregates counts, distinct DAU/WAU, identity split, and funnel', async () => {
    userCount.mockResolvedValueOnce(100).mockResolvedValueOnce(7).mockResolvedValueOnce(30) // total, 7d, 30d
    eventCount
      .mockResolvedValueOnce(5000) // total events
      .mockResolvedValueOnce(800) // loggedIn 7d
      .mockResolvedValueOnce(200) // anon 7d
    groupBy.mockImplementation((args: { by: string[]; where?: { ts?: { gte: Date } } }) => {
      if (args.by[0] === 'type') {
        return Promise.resolve([
          { type: 'room_created', _count: 9 },
          { type: 'room_matched', _count: 3 },
        ])
      }
      // by userId: DAU query window is narrower than WAU — return distinct sets by size
      return Promise.resolve([{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }])
    })

    const m = await getOverviewMetrics()
    expect(m.totalUsers).toBe(100)
    expect(m.newUsers7d).toBe(7)
    expect(m.newUsers30d).toBe(30)
    expect(m.totalEvents).toBe(5000)
    expect(m.loggedInEvents7d).toBe(800)
    expect(m.anonEvents7d).toBe(200)
    expect(m.dau).toBe(3)
    expect(m.wau).toBe(3)
    expect(m.funnel7d).toEqual({ room_created: 9, room_started: 0, room_matched: 3 })
  })
})

describe('getActiveUsersByDay', () => {
  test('maps bigint raw rows to numbers', async () => {
    queryRaw.mockResolvedValue([
      { day: new Date('2026-06-12'), users: BigInt(5), events: BigInt(42) },
      { day: new Date('2026-06-11'), users: BigInt(3), events: BigInt(18) },
    ])
    const rows = await getActiveUsersByDay(14)
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([
      { day: new Date('2026-06-12'), activeUsers: 5, events: 42 },
      { day: new Date('2026-06-11'), activeUsers: 3, events: 18 },
    ])
  })
})

describe('listUsers', () => {
  const now = new Date()
  const old = new Date(Date.now() - 30 * 86_400_000)

  test('joins activity onto users and derives active status; newest-first; safe select', async () => {
    userCount.mockResolvedValue(2)
    userFindMany.mockResolvedValue([
      { id: 'u1', email: 'a@x.com', displayName: 'A', name: null, createdAt: now },
      { id: 'u2', email: 'b@x.com', displayName: 'B', name: 'Bee', createdAt: now },
    ])
    groupBy.mockResolvedValue([
      { userId: 'u1', _max: { ts: now }, _count: 12 },
      { userId: 'u2', _max: { ts: old }, _count: 4 },
    ])

    const res = await listUsers({ page: 1 })
    expect(res.total).toBe(2)
    expect(res.pageSize).toBe(PAGE_SIZE)
    expect(res.rows[0]).toMatchObject({ id: 'u1', totalEvents: 12, isActive: true })
    expect(res.rows[1]).toMatchObject({ id: 'u2', totalEvents: 4, isActive: false })

    const findArgs = userFindMany.mock.calls[0][0]
    expect(findArgs.orderBy).toEqual({ createdAt: 'desc' })
    expect(findArgs.take).toBe(PAGE_SIZE)
    assertSafeSelect(findArgs.select)
  })

  test('page 2 offsets by PAGE_SIZE and q builds a case-insensitive OR', async () => {
    userCount.mockResolvedValue(0)
    userFindMany.mockResolvedValue([])
    await listUsers({ page: 2, q: 'ann' })
    const findArgs = userFindMany.mock.calls[0][0]
    expect(findArgs.skip).toBe(PAGE_SIZE)
    expect(findArgs.where.OR).toEqual(
      expect.arrayContaining([{ email: { contains: 'ann', mode: 'insensitive' } }]),
    )
    // no users on the page → no activity query fired
    expect(groupBy).not.toHaveBeenCalled()
  })
})

describe('getUserDetail', () => {
  test('returns null when the user is missing', async () => {
    userFindUnique.mockResolvedValue(null)
    expect(await getUserDetail('nope')).toBeNull()
  })

  test('returns safe fields plus per-type counts', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', email: 'a@x.com', displayName: 'A', name: null, createdAt: new Date() })
    groupBy.mockResolvedValue([
      { type: 'page_view', _count: 10 },
      { type: 'login', _count: 2 },
    ])
    const res = await getUserDetail('u1')
    expect(res?.totalEvents).toBe(12)
    expect(res?.eventsByType).toEqual([
      { type: 'page_view', count: 10 },
      { type: 'login', count: 2 },
    ])
    assertSafeSelect(userFindUnique.mock.calls[0][0].select)
  })
})

describe('listUserEvents', () => {
  test('pages a single user’s events newest-first', async () => {
    eventCount.mockResolvedValue(3)
    eventFindMany.mockResolvedValue([{ id: 'e1', type: 'login', ts: new Date() }])
    const res = await listUserEvents('u1', 1)
    expect(res.total).toBe(3)
    const args = eventFindMany.mock.calls[0][0]
    expect(args.where).toEqual({ userId: 'u1' })
    expect(args.orderBy).toEqual({ ts: 'desc' })
  })
})

describe('listEvents', () => {
  test('filters by type + identity and resolves user identity via a batched join', async () => {
    eventCount.mockResolvedValue(1)
    eventFindMany.mockResolvedValue([
      { id: 'e1', type: 'page_view', ts: new Date(), userId: 'u1', anonId: 'server' },
      { id: 'e2', type: 'page_view', ts: new Date(), userId: null, anonId: 'a9' },
    ])
    userFindMany.mockResolvedValue([{ id: 'u1', email: 'a@x.com', displayName: 'A' }])

    const res = await listEvents({ page: 1, type: 'page_view', identity: 'loggedin' })
    const where = eventFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ type: 'page_view', userId: { not: null } })
    // one batched lookup for the single distinct userId
    expect(userFindMany).toHaveBeenCalledTimes(1)
    expect(userFindMany.mock.calls[0][0].where).toEqual({ id: { in: ['u1'] } })
    expect(res.rows[0].user).toEqual({ id: 'u1', email: 'a@x.com', displayName: 'A' })
    expect(res.rows[1].user).toBeNull()
    assertSafeSelect(userFindMany.mock.calls[0][0].select)
  })

  test('identity=anon filters to null userId and skips the user lookup', async () => {
    eventCount.mockResolvedValue(0)
    eventFindMany.mockResolvedValue([{ id: 'e3', type: 'session_start', ts: new Date(), userId: null, anonId: 'a1' }])
    await listEvents({ identity: 'anon' })
    expect(eventFindMany.mock.calls[0][0].where).toEqual({ userId: null })
    expect(userFindMany).not.toHaveBeenCalled()
  })
})
