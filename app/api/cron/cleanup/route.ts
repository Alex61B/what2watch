// GET /api/cron/cleanup — Vercel-cron data hygiene (see vercel.json). Secured by the
// CRON_SECRET bearer Vercel injects. Idempotent deleteMany/updateMany sweeps:
//   - delete rooms well past expiry (cascades members/votes/queue/watched; Events have no
//     FK to Room so analytics is preserved)
//   - purge Events past the retention window
//   - soft-leave members idle beyond the stale threshold so active counts don't drift
//     (coarse hygiene — live presence is a later milestone)
//   - purge expired RateLimit rows (raw SQL: the model may predate the generated client)
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logServerError, serverError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROOM_GRACE_MS = 24 * 60 * 60 * 1000 // delete rooms 24h past expiry
const EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000 // keep 90 days of events
const STALE_MEMBER_MS = 60 * 60 * 1000 // soft-leave members idle > 1h

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 })
  }

  const now = Date.now()
  try {
    const rooms = await prisma.room.deleteMany({
      where: { expiresAt: { lt: new Date(now - ROOM_GRACE_MS) } },
    })
    const events = await prisma.event.deleteMany({
      where: { ts: { lt: new Date(now - EVENT_RETENTION_MS) } },
    })
    const members = await prisma.member.updateMany({
      where: { leftAt: null, lastSeenAt: { lt: new Date(now - STALE_MEMBER_MS) } },
      data: { leftAt: new Date() },
    })

    let rateLimitsDeleted = 0
    try {
      rateLimitsDeleted = await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "expiresAt" < ${new Date(now)}`
    } catch (err) {
      // Best-effort: the table may not exist yet (pre-migration). Don't fail the sweep.
      logServerError('[cron-cleanup] rate-limit purge skipped', {}, err)
    }

    return NextResponse.json({
      ok: true,
      roomsDeleted: rooms.count,
      eventsDeleted: events.count,
      membersLeft: members.count,
      rateLimitsDeleted,
    })
  } catch (err) {
    logServerError('[cron-cleanup]', {}, err)
    return serverError(500)
  }
}
