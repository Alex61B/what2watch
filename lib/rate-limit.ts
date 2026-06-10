// lib/rate-limit.ts
// In-memory fixed-window rate limiter for the open /api/events ingest.
//
// NOTE: this is PER serverless instance on Vercel — not a global cap. It blunts a
// single-instance hammering loop; a global limit needs Redis/Upstash (the upgrade
// path). The ingest's batch + payload caps bound per-request damage regardless.

export const WINDOW_MS = 10_000
export const MAX_REQUESTS = 30
export const MAX_EVENTS = 200
const MAX_KEYS = 10_000

interface Bucket {
  count: number
  events: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/** Returns true if the call is ALLOWED, false if it should be rejected (429). */
export function rateLimit(key: string, eventCount: number, now: number): boolean {
  let b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    if (buckets.size > MAX_KEYS) buckets.clear() // crude unbounded-growth guard
    b = { count: 0, events: 0, resetAt: now + WINDOW_MS }
    buckets.set(key, b)
  }
  b.count += 1
  b.events += eventCount
  return b.count <= MAX_REQUESTS && b.events <= MAX_EVENTS
}

/** Test-only: clear all in-memory windows so tests don't depend on module state. */
export function __resetRateLimit(): void {
  buckets.clear()
}
