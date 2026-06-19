// app/api/events/route.ts
// Unauthenticated, best-effort behavioral-event ingest. Parse → validate against the
// shared allowlist → in-memory rate-limit → stamp userId/ts → createMany. Bad input is
// dropped (204), never 500'd; only a rate-limit returns 429.
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { isEventType, MAX_EVENTS_PER_REQUEST, MAX_PROPS_BYTES } from '@/lib/analytics-events'
import { rateLimit } from '@/lib/rate-limit'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit-db'

const NO_CONTENT = () => new NextResponse(null, { status: 204 })

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NO_CONTENT()
  }

  const b = body as { anonId?: unknown; events?: unknown }
  const anonId =
    typeof b?.anonId === 'string' && b.anonId.length > 0 && b.anonId.length <= 64 ? b.anonId : null
  const rawEvents = Array.isArray(b?.events) ? b.events.slice(0, MAX_EVENTS_PER_REQUEST) : []
  if (rawEvents.length === 0) return NO_CONTENT()

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  const key = anonId ?? `ip:${ip || 'unknown'}`
  // L1: cheap per-instance fast-path blunts a tight loop before it touches the DB.
  if (!rateLimit(key, rawEvents.length, Date.now())) {
    return new NextResponse(null, { status: 429 })
  }
  // L2: durable global cap across all serverless instances.
  const durable = await checkRateLimit('events', key, RATE_LIMITS.events)
  if (!durable.ok) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(durable.retryAfterSeconds) } })
  }

  const session = await auth().catch(() => null)
  const userId = session?.user?.id ?? null
  const ts = new Date()

  const data: Prisma.EventCreateManyInput[] = []
  for (const raw of rawEvents) {
    const e = raw as {
      type?: unknown
      props?: unknown
      roomId?: unknown
      memberId?: unknown
      clientTs?: unknown
    }
    if (!isEventType(e?.type)) continue

    let props: Record<string, unknown> | undefined =
      e.props && typeof e.props === 'object' ? (e.props as Record<string, unknown>) : undefined
    // Store the client timestamp (advisory, for intra-batch ordering) without trusting it for ts.
    if (typeof e.clientTs === 'number' && Number.isFinite(e.clientTs)) {
      props = { ...(props ?? {}), _clientTs: e.clientTs }
    }
    if (props && JSON.stringify(props).length > MAX_PROPS_BYTES) continue

    data.push({
      type: e.type,
      anonId: anonId ?? 'anon:none',
      userId,
      roomId: typeof e.roomId === 'string' ? e.roomId : null,
      memberId: typeof e.memberId === 'string' ? e.memberId : null,
      props: props as Prisma.InputJsonValue | undefined,
      ts,
    })
  }

  if (data.length > 0) {
    try {
      await prisma.event.createMany({ data })
    } catch {
      // telemetry is best-effort; never surface ingest failures to the client
    }
  }
  return NO_CONTENT()
}
