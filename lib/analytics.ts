// lib/analytics.ts
// Client-only, fire-and-forget event sender. SSR-safe: every entry point no-ops on
// the server. Events are buffered within a tick and flushed via sendBeacon (with a
// keepalive fetch fallback) so analytics never blocks the UX.
import type { EventType } from './analytics-events'

const ANON_KEY = 'pikflix_anon'

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

export function getAnonId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(ANON_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ANON_KEY, id)
  }
  return id
}

export function flush(): void {
  scheduled = false
  if (typeof window === 'undefined' || buffer.length === 0) return
  const payload = JSON.stringify({ anonId: getAnonId(), events: buffer })
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
