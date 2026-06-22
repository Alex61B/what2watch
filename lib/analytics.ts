// lib/analytics.ts
// Client-only, fire-and-forget event sender. SSR-safe: every entry point no-ops on
// the server. Events are buffered within a tick and flushed via sendBeacon (with a
// keepalive fetch fallback) so analytics never blocks the UX.
import type { EventType } from './analytics-events'

const ANON_KEY = 'pikflix_anon'
// WP6: per-device opt-out of first-party analytics (disclosed in /privacy, toggled in settings).
const OPTOUT_KEY = 'pikflix_analytics_optout'

interface OutEvent {
  type: EventType
  props?: Record<string, unknown>
  roomId?: string
  memberId?: string
  clientTs: number
}

let buffer: OutEvent[] = []
let scheduled = false
let listenersBound = false

// crypto.randomUUID isn't available in every environment (older / non-secure-context
// browsers, the jsdom test env) — fall back so getAnonId can never throw.
function newAnonId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // fall through
  }
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function getAnonId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(ANON_KEY)
  if (!id) {
    id = newAnonId()
    localStorage.setItem(ANON_KEY, id)
  }
  return id
}

/** True when the user has opted out of first-party analytics on this device. SSR-safe. */
export function isAnalyticsOptedOut(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(OPTOUT_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the analytics opt-out preference (localStorage; survives reloads). SSR-safe. */
export function setAnalyticsOptOut(optedOut: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (optedOut) localStorage.setItem(OPTOUT_KEY, '1')
    else localStorage.removeItem(OPTOUT_KEY)
  } catch {
    // best-effort; the toggle must never throw into the UI
  }
}

export function flush(): void {
  scheduled = false
  if (typeof window === 'undefined' || buffer.length === 0) return
  // Fully fire-and-forget: building the payload (getAnonId) must never throw into the
  // caller — a vote handler or a button click. Any failure just drops the batch.
  let payload: string
  try {
    payload = JSON.stringify({ anonId: getAnonId(), events: buffer })
  } catch {
    buffer = []
    return
  }
  buffer = []
  try {
    if (navigator.sendBeacon?.('/api/events', new Blob([payload], { type: 'application/json' }))) {
      return
    }
  } catch {
    // fall through to fetch
  }
  try {
    void fetch('/api/events', {
      method: 'POST',
      body: payload,
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    // best-effort; analytics must never throw into the UI
  }
}

export function track(
  type: EventType,
  props?: Record<string, unknown>,
  ctx?: { roomId?: string; memberId?: string },
): void {
  if (typeof window === 'undefined') return
  // WP6: honor the per-device analytics opt-out (disclosed in /privacy). When opted out we drop
  // the event entirely — nothing is buffered or sent. Server-side login events
  // (lib/login-event.ts) are security/audit and intentionally bypass this client opt-out.
  if (isAnalyticsOptedOut()) return
  // clientTs preserves ordering within a single flushed batch; the server's ts is
  // authoritative for everything else.
  buffer.push({ type, props, ...ctx, clientTs: Date.now() })
  if (!listenersBound) {
    listenersBound = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    window.addEventListener('pagehide', flush)
  }
  if (!scheduled) {
    scheduled = true
    setTimeout(flush, 0)
  }
}
