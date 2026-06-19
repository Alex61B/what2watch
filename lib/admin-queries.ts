// lib/admin-queries.ts
// Read-only data layer for the /admin dashboard. Every function assumes an already-
// authorized caller (see requireAdmin in lib/admin.ts). Two invariants:
//   1. Event.userId is joined to User manually (no Prisma relation) — collect ids, batch
//      a single user.findMany.
//   2. Every select is an explicit allowlist of safe columns; password hashes, session
//      tokens, and OAuth tokens are never selected here.
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const PAGE_SIZE = 50
export const ACTIVE_WINDOW_DAYS = 7
export const OVERVIEW_DAYS = 14

const FUNNEL_TYPES = ['room_created', 'room_started', 'room_matched'] as const
type FunnelType = (typeof FUNNEL_TYPES)[number]

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000)
}

function countOf(g: { _count?: unknown }): number {
  return typeof g._count === 'number' ? g._count : 0
}

const USER_LIST_SELECT = {
  id: true,
  email: true,
  displayName: true,
  name: true,
  createdAt: true,
} satisfies Prisma.UserSelect

const USER_DETAIL_SELECT = {
  id: true,
  email: true,
  displayName: true,
  name: true,
  image: true,
  savedServices: true,
  createdAt: true,
} satisfies Prisma.UserSelect

const EVENT_SELECT = {
  id: true,
  type: true,
  ts: true,
  userId: true,
  anonId: true,
  roomId: true,
  memberId: true,
  props: true,
} satisfies Prisma.EventSelect

export async function getOverviewMetrics() {
  const since1 = daysAgo(1)
  const since7 = daysAgo(7)
  const since30 = daysAgo(30)

  const [totalUsers, newUsers7d, newUsers30d, totalEvents, loggedInEvents7d, anonEvents7d, dauG, wauG, funnelG] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: since7 } } }),
      prisma.user.count({ where: { createdAt: { gte: since30 } } }),
      prisma.event.count(),
      prisma.event.count({ where: { ts: { gte: since7 }, userId: { not: null } } }),
      prisma.event.count({ where: { ts: { gte: since7 }, userId: null } }),
      prisma.event.groupBy({ by: ['userId'], where: { ts: { gte: since1 }, userId: { not: null } } }),
      prisma.event.groupBy({ by: ['userId'], where: { ts: { gte: since7 }, userId: { not: null } } }),
      prisma.event.groupBy({
        by: ['type'],
        where: { type: { in: [...FUNNEL_TYPES] }, ts: { gte: since7 } },
        _count: true,
      }),
    ])

  const funnel7d: Record<FunnelType, number> = { room_created: 0, room_started: 0, room_matched: 0 }
  for (const g of funnelG as Array<{ type: string; _count?: unknown }>) {
    if (g.type in funnel7d) funnel7d[g.type as FunnelType] = countOf(g)
  }

  return {
    totalUsers,
    newUsers7d,
    newUsers30d,
    totalEvents,
    dau: dauG.length,
    wau: wauG.length,
    loggedInEvents7d,
    anonEvents7d,
    funnel7d,
  }
}

export async function getActiveUsersByDay(days: number = OVERVIEW_DAYS) {
  const since = daysAgo(days)
  const rows = await prisma.$queryRaw<Array<{ day: Date; users: bigint; events: bigint }>>`
    SELECT date_trunc('day', "ts") AS day,
           COUNT(DISTINCT "userId") AS users,
           COUNT(*) AS events
    FROM "Event"
    WHERE "ts" >= ${since}
    GROUP BY 1
    ORDER BY 1 DESC`
  return rows.map((r) => ({ day: r.day, activeUsers: Number(r.users), events: Number(r.events) }))
}

export async function listUsers({ page = 1, q }: { page?: number; q?: string }) {
  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {}

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: USER_LIST_SELECT,
    }),
  ])

  const ids = users.map((u) => u.id)
  const agg = ids.length
    ? await prisma.event.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _max: { ts: true },
        _count: true,
      })
    : []
  const byUser = new Map(agg.map((a) => [a.userId, a]))

  const activeSince = daysAgo(ACTIVE_WINDOW_DAYS)
  const rows = users.map((u) => {
    const a = byUser.get(u.id)
    const lastActivity = a?._max?.ts ?? null
    return {
      ...u,
      lastActivity,
      totalEvents: a ? countOf(a) : 0,
      isActive: !!lastActivity && lastActivity >= activeSince,
    }
  })

  return { rows, total, page, pageSize: PAGE_SIZE }
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_DETAIL_SELECT })
  if (!user) return null

  const groups = await prisma.event.groupBy({ by: ['type'], where: { userId }, _count: true })
  const eventsByType = (groups as Array<{ type: string; _count?: unknown }>).map((g) => ({
    type: g.type,
    count: countOf(g),
  }))
  const totalEvents = eventsByType.reduce((sum, e) => sum + e.count, 0)

  return { user, eventsByType, totalEvents }
}

export async function listUserEvents(userId: string, page = 1) {
  const [total, events] = await Promise.all([
    prisma.event.count({ where: { userId } }),
    prisma.event.findMany({
      where: { userId },
      orderBy: { ts: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: EVENT_SELECT,
    }),
  ])
  return { events, total, page, pageSize: PAGE_SIZE }
}

export async function listEvents({
  page = 1,
  type,
  identity,
}: {
  page?: number
  type?: string
  identity?: 'loggedin' | 'anon'
}) {
  const where: Prisma.EventWhereInput = {}
  if (type) where.type = type
  if (identity === 'loggedin') where.userId = { not: null }
  else if (identity === 'anon') where.userId = null

  const [total, events] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: { ts: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: EVENT_SELECT,
    }),
  ])

  const ids = [...new Set(events.map((e) => e.userId).filter((x): x is string => !!x))]
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true, displayName: true },
      })
    : []
  const byId = new Map(users.map((u) => [u.id, u]))

  const rows = events.map((e) => ({ ...e, user: e.userId ? byId.get(e.userId) ?? null : null }))
  return { rows, total, page, pageSize: PAGE_SIZE }
}
