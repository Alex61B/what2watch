// lib/rate-limit-db.ts
// Durable, Postgres-backed fixed-window rate limiter. Unlike lib/rate-limit.ts (in-memory,
// per-serverless-instance), this is a GLOBAL cap shared across all instances — it just needs
// the Postgres we already run, no Redis/Upstash. One row per (scope, identifier, window);
// the cleanup cron purges expired rows. The limiter swap-point is here: the call sites take a
// { ok, retryAfterSeconds } and don't care how it's computed.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export interface RateLimitResult {
  ok: boolean
  retryAfterSeconds: number
}

export interface RateLimitOptions {
  limit: number
  windowMs: number
}

/** Per-endpoint limits (tunable). Keyed per client IP. */
export const RATE_LIMITS = {
  signup: { limit: 5, windowMs: 15 * 60_000 },
  roomCreate: { limit: 10, windowMs: 10 * 60_000 },
  roomJoin: { limit: 20, windowMs: 10 * 60_000 },
  events: { limit: 240, windowMs: 60_000 },
} as const

/** Best-effort client IP from Vercel's edge-set x-forwarded-for (leftmost hop). */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for') ?? ''
  const first = xff.split(',')[0]?.trim()
  return first || 'unknown'
}

/**
 * Atomically increment the counter for this (scope, identifier, window) and decide.
 * Fails OPEN: a limiter DB hiccup must never block signups/joins.
 */
export async function checkRateLimit(
  scope: string,
  identifier: string,
  opts: RateLimitOptions,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / opts.windowMs) * opts.windowMs
  const key = `${scope}:${identifier}:${windowStart}`
  const expiresAt = new Date(windowStart + opts.windowMs)

  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" ("key", "count", "expiresAt")
      VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimit"."count" + 1
      RETURNING "count"
    `
    const count = Number(rows[0]?.count ?? 1)
    if (count <= opts.limit) return { ok: true, retryAfterSeconds: 0 }
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)) }
  } catch (err) {
    console.error('[rate-limit-db] check failed, failing open', {
      scope,
      message: err instanceof Error ? err.message : String(err),
    })
    return { ok: true, retryAfterSeconds: 0 }
  }
}

/** 429 response with a Retry-After header. */
export function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )
}
