# Event Tracking Pipeline — Implementation Plan

> **For agentic workers:** This repo uses the **Backpressure workflow** (see `AGENTS.md`):
> RESEARCH → PLAN → IMPLEMENT → TEST, driven **serially** (one `.workflow_plan_files`
> manifest at a time). Do **NOT** fan out parallel subagents — `.workflow_state` /
> `.workflow_plan_files` are singletons and parallel agents race them. Steps use checkbox
> (`- [ ]`) syntax for tracking. TDD where a unit boundary exists; `bash scripts/verify.sh`
> must stay green.

**Goal:** Ship a first-party, append-only behavioral `Event` pipeline that captures page
views, the room funnel, per-slide dwell time, and feature usage into Postgres for SQL
analytics and as the future recommender's training signal.

**Architecture:** Client `track()` buffers events and ships them via `sendBeacon` to an
unauthenticated `POST /api/events` that validates against a shared allowlist, rate-limits
in memory, stamps `userId`/`ts`, and `createMany`s into one `Event` table. Dwell time is a
pure, visibility-aware, ceiling-capped accumulator.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma/Postgres, NextAuth 5, Jest
(Prisma mocked).

**Source spec:** `docs/superpowers/specs/2026-06-10-event-tracking-pipeline-design.md`

---

## Approved amendments (2026-06-10) — authoritative over the Task code below where they differ

1. **`pikflix_` storage prefix** (brand is PikFlix). New keys: `pikflix_anon` (anon id, Task 5)
   and `pikflix_session_started` (session flag, Task 6). The pre-existing `w2w_theme` key and
   the server-side `w2w_session_<CODE>` room cookie are **out of scope and unchanged**.
2. **`clientTs` per event.** `track()` stamps `clientTs: Date.now()` on each buffered event.
   The ingest validates it (`Number.isFinite`) and writes it to `props._clientTs`; server `ts`
   stays authoritative. This preserves ordering within a single flushed batch.
   - `OutEvent` gains `clientTs: number`; the ingest merges it: `props = { ...props, _clientTs }`
     only when finite.
3. **Rate-limiter test reset.** `lib/rate-limit.ts` exports `export function __resetRateLimit() { buckets.clear() }`.
   `__tests__/api/events.test.ts` and `__tests__/lib/rate-limit.test.ts` call it in `beforeEach`
   so the `429`/window tests don't depend on cross-test module state.

---

## File structure (decomposition)

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `Event` model (+ generated migration) |
| `lib/analytics-events.ts` | Shared allowlist (`EVENT_TYPES`, `FEATURES`) + limit constants + types. Imported by client **and** server. |
| `lib/rate-limit.ts` | Pure in-memory fixed-window limiter (testable; injectable clock). *Refinement vs spec manifest — split out for unit-testability.* |
| `lib/dwell.ts` | Pure visibility-aware dwell accumulator (testable; injectable clock). |
| `lib/analytics.ts` | Client `getAnonId` / `track` / `flush`. Guards on `typeof window`. |
| `app/api/events/route.ts` | Ingest: parse → validate → rate-limit → stamp → `createMany`. Never 500s on bad input. |
| `components/AnalyticsTracker.tsx` | Client: `session_start` once/tab + `page_view` on URL change (Suspense + ref dedupe). |
| `app/layout.tsx` | Mount `<AnalyticsTracker/>` inside `SessionProviderWrapper`. |
| `app/room/[code]/vote/page.tsx` | Wire `useCardDwell` → `card_decided` on each swipe. |
| (feature call sites) | `feature_used` + room-funnel emits. |
| `docs/analytics-queries.md` | Example SQL + 90-day purge query. |
| `__tests__/api/events.test.ts` | Ingest unit tests. |
| `__tests__/lib/rate-limit.test.ts` | Limiter unit tests. |
| `__tests__/lib/dwell.test.ts` | Dwell accumulator unit tests. |

**Workflow manifest note:** PLAN should write all of the above into `.workflow_plan_files`.
If a smaller manifest is preferred, split into two serial cycles: **Phase 1** (Tasks 1–6)
then **Phase 2** (Tasks 7–11).

---

## PHASE 1 — Pipeline core

### Task 1: `Event` schema + migration (GATED)

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: Add the model** at the end of `prisma/schema.prisma`:

```prisma
model Event {
  id       String   @id @default(uuid())
  type     String
  anonId   String
  userId   String?
  memberId String?
  roomId   String?
  props    Json?
  ts       DateTime @default(now())

  @@index([type, ts])
  @@index([roomId])
  @@index([userId])
  @@index([anonId])
}
```
No relations; `User` is not modified.

- [ ] **Step 2: Validate the schema** (safe, no DB write)

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 3: GATE — request explicit approval, then migrate**

This is a restricted op. **Stop and ask the user** before running:
Run (only after approval): `npx prisma migrate dev --name add_event_table`
Expected: migration created under `prisma/migrations/`, client regenerated.
> Per `AGENTS.md`, generated migration SQL trips `.workflow_drift`; recovery is
> `bash scripts/advance_state.sh drift-to-plan` (run by the user) — see memory
> `feedback-workflow-drift-recovery`. Add the new migration dir to `.workflow_plan_files`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(analytics): add Event table"
```

---

### Task 2: Shared allowlist — `lib/analytics-events.ts`

**Files:** Create `lib/analytics-events.ts`

- [ ] **Step 1: Write the module**

```ts
// lib/analytics-events.ts
// Single source of truth for event names + limits, imported by client and server.
export const EVENT_TYPES = [
  'session_start', 'page_view',
  'room_created', 'room_joined', 'room_started', 'room_matched',
  'card_decided', 'feature_used',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const FEATURES = [
  'filter_edit', 'depth_change', 'skip_reruns', 'requeue', 'share_link', 'friend_compare',
] as const
export type Feature = (typeof FEATURES)[number]

export const MAX_EVENTS_PER_REQUEST = 20
export const MAX_PROPS_BYTES = 2_048
export const DWELL_CEILING_MS = 60_000

export function isEventType(v: unknown): v is EventType {
  return typeof v === 'string' && (EVENT_TYPES as readonly string[]).includes(v)
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes (no emit).

- [ ] **Step 3: Commit**

```bash
git add lib/analytics-events.ts
git commit -m "feat(analytics): shared event allowlist + limits"
```

---

### Task 3: Rate limiter — `lib/rate-limit.ts` (TDD)

**Files:** Create `lib/rate-limit.ts`, Test `__tests__/lib/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/rate-limit.test.ts
import { rateLimit, WINDOW_MS, MAX_REQUESTS, MAX_EVENTS } from '@/lib/rate-limit'

describe('rateLimit', () => {
  test('allows requests under the per-window request cap', () => {
    const now = 1_000_000
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect(rateLimit(`k1-${i % 1}`, 1, now)).toBe(true) // same key
    }
    expect(rateLimit('k1-0', 1, now)).toBe(false) // one over
  })

  test('blocks when the event cap is exceeded in a window', () => {
    const now = 2_000_000
    expect(rateLimit('k2', MAX_EVENTS, now)).toBe(true)
    expect(rateLimit('k2', 1, now)).toBe(false)
  })

  test('resets after the window elapses', () => {
    const now = 3_000_000
    expect(rateLimit('k3', MAX_EVENTS, now)).toBe(true)
    expect(rateLimit('k3', 1, now)).toBe(false)
    expect(rateLimit('k3', 1, now + WINDOW_MS)).toBe(true) // new window
  })

  test('keys are independent', () => {
    const now = 4_000_000
    expect(rateLimit('a', MAX_EVENTS, now)).toBe(true)
    expect(rateLimit('b', 1, now)).toBe(true) // different key unaffected
  })
})
```

- [ ] **Step 2: Run it — expect failure** (module not found)

Run: `npx jest __tests__/lib/rate-limit.test.ts`
Expected: FAIL — cannot find `@/lib/rate-limit`.

- [ ] **Step 3: Implement**

```ts
// lib/rate-limit.ts
// In-memory fixed-window limiter. NOTE: per serverless instance on Vercel — not a
// global cap. Blunts single-instance hammering; Redis/Upstash is the upgrade path.
export const WINDOW_MS = 10_000
export const MAX_REQUESTS = 30
export const MAX_EVENTS = 200
const MAX_KEYS = 10_000

interface Bucket { count: number; events: number; resetAt: number }
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
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx jest __tests__/lib/rate-limit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rate-limit.ts __tests__/lib/rate-limit.test.ts
git commit -m "feat(analytics): in-memory rate limiter"
```

---

### Task 4: Ingest route — `app/api/events/route.ts` (TDD)

**Files:** Create `app/api/events/route.ts`, Test `__tests__/api/events.test.ts`

- [ ] **Step 1: Write the failing test** (mock Prisma + auth, per repo convention)

```ts
/**
 * @jest-environment node
 */
import { POST } from '@/app/api/events/route'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

jest.mock('@/lib/prisma', () => ({ prisma: { event: { createMany: jest.fn(async () => ({ count: 0 })) } } }))
jest.mock('@/auth', () => ({ auth: jest.fn(async () => null) }))

const createMany = prisma.event.createMany as jest.Mock
const mockAuth = auth as unknown as jest.Mock
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('http://test/api/events', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  }))

beforeEach(() => { createMany.mockClear(); mockAuth.mockResolvedValue(null) })

test('persists allowlisted events and stamps null userId when anonymous', async () => {
  const res = await post({ anonId: 'a1', events: [{ type: 'page_view', props: { path: '/' } }] })
  expect(res.status).toBe(204)
  expect(createMany).toHaveBeenCalledTimes(1)
  const rows = createMany.mock.calls[0][0].data
  expect(rows[0]).toMatchObject({ type: 'page_view', anonId: 'a1', userId: null })
})

test('stamps userId from the session when authenticated', async () => {
  mockAuth.mockResolvedValue({ user: { id: 'u9' } })
  await post({ anonId: 'a1', events: [{ type: 'session_start' }] })
  expect(createMany.mock.calls[0][0].data[0].userId).toBe('u9')
})

test('drops unknown event types but keeps valid ones', async () => {
  await post({ anonId: 'a1', events: [{ type: 'evil' }, { type: 'card_decided', props: { movieId: '1', vote: true, dwellMs: 10 } }] })
  const rows = createMany.mock.calls[0][0].data
  expect(rows).toHaveLength(1)
  expect(rows[0].type).toBe('card_decided')
})

test('truncates batches beyond MAX_EVENTS_PER_REQUEST', async () => {
  const events = Array.from({ length: 50 }, () => ({ type: 'page_view' }))
  await post({ anonId: 'a1', events })
  expect(createMany.mock.calls[0][0].data.length).toBeLessThanOrEqual(20)
})

test('malformed body returns 204 and never writes', async () => {
  const res = await POST(new Request('http://test/api/events', { method: 'POST', body: 'not json' }))
  expect(res.status).toBe(204)
  expect(createMany).not.toHaveBeenCalled()
})

test('returns 429 when rate-limited', async () => {
  const many = Array.from({ length: 20 }, () => ({ type: 'page_view' }))
  let last = 204
  for (let i = 0; i < 40; i++) last = (await post({ anonId: 'flood', events: many })).status
  expect(last).toBe(429)
})
```

- [ ] **Step 2: Run it — expect failure** (route not found)

Run: `npx jest __tests__/api/events.test.ts`
Expected: FAIL — cannot find `@/app/api/events/route`.

- [ ] **Step 3: Implement the route**

```ts
// app/api/events/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { isEventType, MAX_EVENTS_PER_REQUEST, MAX_PROPS_BYTES } from '@/lib/analytics-events'
import { rateLimit } from '@/lib/rate-limit'

const NO_CONTENT = () => new NextResponse(null, { status: 204 })

export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch { return NO_CONTENT() }

  const b = body as { anonId?: unknown; events?: unknown }
  const anonId = typeof b?.anonId === 'string' && b.anonId.length > 0 && b.anonId.length <= 64 ? b.anonId : null
  const rawEvents = Array.isArray(b?.events) ? b.events.slice(0, MAX_EVENTS_PER_REQUEST) : []
  if (rawEvents.length === 0) return NO_CONTENT()

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  const key = anonId ?? `ip:${ip || 'unknown'}`
  if (!rateLimit(key, rawEvents.length, Date.now())) return new NextResponse(null, { status: 429 })

  const session = await auth().catch(() => null)
  const userId = session?.user?.id ?? null
  const ts = new Date()

  const data: Array<{ type: string; anonId: string; userId: string | null; roomId: string | null; memberId: string | null; props: object | undefined; ts: Date }> = []
  for (const raw of rawEvents) {
    const e = raw as { type?: unknown; props?: unknown; roomId?: unknown; memberId?: unknown }
    if (!isEventType(e?.type)) continue
    let props: object | undefined
    if (e.props && typeof e.props === 'object') {
      if (JSON.stringify(e.props).length > MAX_PROPS_BYTES) continue
      props = e.props as object
    }
    data.push({
      type: e.type,
      anonId: anonId ?? 'anon:none',
      userId,
      roomId: typeof e.roomId === 'string' ? e.roomId : null,
      memberId: typeof e.memberId === 'string' ? e.memberId : null,
      props,
      ts,
    })
  }

  if (data.length > 0) {
    try { await prisma.event.createMany({ data }) } catch { /* telemetry is best-effort */ }
  }
  return NO_CONTENT()
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx jest __tests__/api/events.test.ts`
Expected: PASS (6 tests).
> If `prisma.event` isn't on the generated client yet (Task 1 migration gated/not run),
> the mock covers tests; real persistence requires the migration.

- [ ] **Step 5: Commit**

```bash
git add app/api/events/route.ts __tests__/api/events.test.ts
git commit -m "feat(analytics): /api/events ingest with validation + rate limit"
```

---

### Task 5: Client `track` — `lib/analytics.ts`

**Files:** Create `lib/analytics.ts`

- [ ] **Step 1: Write the module**

```ts
// lib/analytics.ts
// Client-only, fire-and-forget event sender. SSR-safe (no-ops on the server).
import type { EventType } from './analytics-events'

const ANON_KEY = 'pikflix_anon'
interface OutEvent { type: EventType; props?: Record<string, unknown>; roomId?: string; memberId?: string }

let buffer: OutEvent[] = []
let scheduled = false
let listenersBound = false

export function getAnonId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(ANON_KEY)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(ANON_KEY, id) }
  return id
}

export function flush(): void {
  scheduled = false
  if (typeof window === 'undefined' || buffer.length === 0) return
  const payload = JSON.stringify({ anonId: getAnonId(), events: buffer })
  buffer = []
  try {
    if (navigator.sendBeacon?.(`/api/events`, new Blob([payload], { type: 'application/json' }))) return
  } catch { /* fall through */ }
  try { void fetch('/api/events', { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' } }) } catch { /* ignore */ }
}

export function track(type: EventType, props?: Record<string, unknown>, ctx?: { roomId?: string; memberId?: string }): void {
  if (typeof window === 'undefined') return
  buffer.push({ type, props, ...ctx })
  if (!listenersBound) {
    listenersBound = true
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
    window.addEventListener('pagehide', flush)
  }
  if (!scheduled) { scheduled = true; setTimeout(flush, 0) }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`  →  Expected: passes.
```bash
git add lib/analytics.ts
git commit -m "feat(analytics): client track/flush + anonId"
```

---

### Task 6: `<AnalyticsTracker/>` + mount

**Files:** Create `components/AnalyticsTracker.tsx`, Modify `app/layout.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/AnalyticsTracker.tsx
'use client'
import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { track } from '@/lib/analytics'

function PageView() {
  const pathname = usePathname()
  const search = useSearchParams()
  const lastUrl = useRef<string | null>(null)
  useEffect(() => {
    const url = search?.toString() ? `${pathname}?${search.toString()}` : pathname
    if (url === lastUrl.current) return // dedupe: real nav only; idempotent under strict mode
    lastUrl.current = url
    track('page_view', { path: url })
  }, [pathname, search])
  return null
}

export default function AnalyticsTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem('pikflix_session_started')) return
    sessionStorage.setItem('pikflix_session_started', '1')
    track('session_start')
  }, [])
  // useSearchParams requires a Suspense boundary (matches signin/page.tsx pattern).
  return <Suspense fallback={null}><PageView /></Suspense>
}
```

- [ ] **Step 2: Mount in `app/layout.tsx`** — read the file, then add the import and render
`<AnalyticsTracker/>` as the first child inside `SessionProviderWrapper` (it renders `null`,
so placement only affects when the effects mount):

```tsx
import AnalyticsTracker from '@/components/AnalyticsTracker'
// ...
<SessionProviderWrapper>
  <AnalyticsTracker />
  {children}
</SessionProviderWrapper>
```

- [ ] **Step 3: Verify build + run**

Run: `npm run typecheck && npm run lint`  →  Expected: pass.
Manual: with the dev server running, navigate between pages and confirm `POST /api/events`
fires once per navigation (Network tab / server log), exactly one `page_view` per URL.

- [ ] **Step 4: Commit**

```bash
git add components/AnalyticsTracker.tsx app/layout.tsx
git commit -m "feat(analytics): session_start + page_view tracker"
```

---

## PHASE 2 — Signal instrumentation

### Task 7: Dwell accumulator — `lib/dwell.ts` (TDD)

**Files:** Create `lib/dwell.ts`, Test `__tests__/lib/dwell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/dwell.test.ts
import { startDwell, pauseDwell, resumeDwell, finalizeDwell } from '@/lib/dwell'
import { DWELL_CEILING_MS } from '@/lib/analytics-events'

test('accumulates only visible time across a pause/resume', () => {
  let s = startDwell(0, true)        // visible at t=0
  s = pauseDwell(s, 1_000)           // hidden at 1s -> accum 1s
  s = resumeDwell(s, 5_000)          // visible again at 5s (4s backgrounded, not counted)
  const { dwellMs, dwellCapped } = finalizeDwell(s, 6_000) // decide at 6s -> +1s
  expect(dwellMs).toBe(2_000)
  expect(dwellCapped).toBe(false)
})

test('caps at the ceiling and flags it', () => {
  const s = startDwell(0, true)
  const out = finalizeDwell(s, DWELL_CEILING_MS + 30_000)
  expect(out.dwellMs).toBe(DWELL_CEILING_MS)
  expect(out.dwellCapped).toBe(true)
})

test('a card that starts hidden counts no time until resumed', () => {
  let s = startDwell(0, false)       // not visible at mount
  s = resumeDwell(s, 2_000)
  expect(finalizeDwell(s, 3_000).dwellMs).toBe(1_000)
})

test('pause is idempotent and resume is idempotent', () => {
  let s = startDwell(0, true)
  s = pauseDwell(s, 1_000)
  s = pauseDwell(s, 5_000)           // already paused — no extra accrual
  s = resumeDwell(s, 6_000)
  s = resumeDwell(s, 9_000)          // already active — no reset
  expect(finalizeDwell(s, 10_000).dwellMs).toBe(2_000)
})
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx jest __tests__/lib/dwell.test.ts`  →  Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/dwell.ts
// Pure, visibility-aware dwell accumulator. Clock is injected (now: number) so it's
// unit-testable. Only time while the card is the current card AND the tab is visible counts.
import { DWELL_CEILING_MS } from './analytics-events'

export interface DwellState { accumMs: number; activeSince: number | null }

export function startDwell(now: number, visible: boolean): DwellState {
  return { accumMs: 0, activeSince: visible ? now : null }
}
export function pauseDwell(s: DwellState, now: number): DwellState {
  if (s.activeSince === null) return s
  return { accumMs: s.accumMs + (now - s.activeSince), activeSince: null }
}
export function resumeDwell(s: DwellState, now: number): DwellState {
  if (s.activeSince !== null) return s
  return { ...s, activeSince: now }
}
export function finalizeDwell(s: DwellState, now: number): { dwellMs: number; dwellCapped: boolean } {
  const raw = s.accumMs + (s.activeSince !== null ? now - s.activeSince : 0)
  if (raw > DWELL_CEILING_MS) return { dwellMs: DWELL_CEILING_MS, dwellCapped: true }
  return { dwellMs: Math.max(0, Math.round(raw)), dwellCapped: false }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx jest __tests__/lib/dwell.test.ts`  →  Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dwell.ts __tests__/lib/dwell.test.ts
git commit -m "feat(analytics): visibility-aware dwell accumulator"
```

---

### Task 8: Wire dwell → `card_decided` in the vote page

**Files:** Modify `app/room/[code]/vote/page.tsx`

> Read the file first to find: (a) the state holding the **current card / movie id**, and
> (b) the **vote handler(s)** (yes/no swipe). Integrate without changing voting behavior.

- [ ] **Step 1: Add a dwell ref + visibility wiring**

In the component, add `import { useRef, useEffect } from 'react'` (if missing) plus:

```tsx
import { startDwell, pauseDwell, resumeDwell, finalizeDwell, type DwellState } from '@/lib/dwell'
import { track } from '@/lib/analytics'

const dwell = useRef<DwellState | null>(null)
// (re)start the timer whenever the current movie id changes:
useEffect(() => {
  if (!currentMovieId) { dwell.current = null; return }
  dwell.current = startDwell(Date.now(), document.visibilityState === 'visible')
  const onVis = () => {
    if (!dwell.current) return
    dwell.current = document.visibilityState === 'hidden'
      ? pauseDwell(dwell.current, Date.now())
      : resumeDwell(dwell.current, Date.now())
  }
  document.addEventListener('visibilitychange', onVis)
  return () => document.removeEventListener('visibilitychange', onVis)
}, [currentMovieId])
```
> Replace `currentMovieId` with the actual variable name for the displayed card's id.

- [ ] **Step 2: Emit on each vote** — inside the existing yes/no handler, after the vote
is recorded (or right before the API call), add:

```tsx
if (dwell.current && currentMovieId) {
  const { dwellMs, dwellCapped } = finalizeDwell(dwell.current, Date.now())
  track('card_decided', { movieId: currentMovieId, vote: isYes, dwellMs, ...(dwellCapped && { dwellCapped: true }) }, { roomId: code })
  dwell.current = null
}
```
> `isYes` = the boolean already passed to the vote API; `code` = the room code from `useParams`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`  →  Expected: pass.
Manual: swipe a few cards in a live room; confirm one `card_decided` per swipe with a
plausible `dwellMs`, and that backgrounding the tab mid-card does not inflate it.

- [ ] **Step 4: Commit**

```bash
git add app/room/[code]/vote/page.tsx
git commit -m "feat(analytics): emit card_decided with dwell time"
```

---

### Task 9: Feature + room-funnel emits

**Files:** Modify feature call sites (read each before editing)

- [ ] **Step 1: Add `feature_used` calls** (`import { track } from '@/lib/analytics'`) at:
  - Filter editor apply/change → `track('feature_used', { feature: 'filter_edit' })`
  - Depth control change → `track('feature_used', { feature: 'depth_change' })`
  - "Skip the reruns" toggle → `track('feature_used', { feature: 'skip_reruns' })`
  - Host requeue action → `track('feature_used', { feature: 'requeue' })`
  - Share/Copy link → `track('feature_used', { feature: 'share_link' })`
  - Opening a friend's comparison page → `track('feature_used', { feature: 'friend_compare' })`
- [ ] **Step 2: Add room-funnel emits** right after the corresponding API call resolves:
  - Create room success → `track('room_created', undefined, { roomId })`
  - Join success → `track('room_joined', undefined, { roomId })`
  - Start success → `track('room_started', { queueSize }, { roomId })`
  - Match detected (votes response `matched:true`) → `track('room_matched', { movieId }, { roomId })`
  > `roomId` may be the room **code** at the client layer — pass what the client has;
  > `props.feature` values must be from `FEATURES` in `lib/analytics-events.ts`.
- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint` → pass; spot-check events fire.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(analytics): feature_used + room funnel events"
```

---

### Task 10: Analytics queries doc

**Files:** Create `docs/analytics-queries.md`

- [ ] **Step 1: Write the doc** with copy-paste SQL:

```markdown
# Analytics queries (Event table)

## Top movies by clean average dwell (excludes capped)
SELECT props->>'movieId' AS movie, round(avg((props->>'dwellMs')::int)) AS avg_dwell_ms, count(*) AS views
FROM "Event"
WHERE type='card_decided' AND coalesce((props->>'dwellCapped')::bool, false) = false
GROUP BY 1 ORDER BY avg_dwell_ms DESC LIMIT 25;

## YES-rate per movie
SELECT props->>'movieId' AS movie,
       round(100.0 * avg(((props->>'vote')='true')::int), 1) AS yes_pct, count(*) AS votes
FROM "Event" WHERE type='card_decided' GROUP BY 1 HAVING count(*) >= 5 ORDER BY yes_pct DESC;

## Funnel: created -> started -> matched (last 7 days)
SELECT type, count(DISTINCT "roomId") AS rooms
FROM "Event" WHERE type IN ('room_created','room_started','room_matched') AND ts > now()-interval '7 days'
GROUP BY type;

## Feature usage
SELECT props->>'feature' AS feature, count(*) FROM "Event" WHERE type='feature_used' GROUP BY 1 ORDER BY 2 DESC;

## DAU (distinct anon devices/day) + logged-in split
SELECT date_trunc('day', ts) AS day, count(DISTINCT "anonId") AS dau,
       count(DISTINCT "userId") FILTER (WHERE "userId" IS NOT NULL) AS logged_in
FROM "Event" GROUP BY 1 ORDER BY 1 DESC LIMIT 30;

## Retention purge (90 days) — run manually / via future cron
DELETE FROM "Event" WHERE ts < now() - interval '90 days';
```

- [ ] **Step 2: Commit**

```bash
git add docs/analytics-queries.md
git commit -m "docs(analytics): example queries + retention purge"
```

---

### Task 11: Full verification + workflow close

- [ ] **Step 1: Run the gate**

Run: `bash scripts/verify.sh`
Expected: typecheck + lint + Jest all green (existing 189 tests + new ingest/rate-limit/dwell tests).

- [ ] **Step 2: Update `PROMPTS.md`** with a dated entry (prompt summary, approach, verification).

- [ ] **Step 3: Advance/close the workflow** per `AGENTS.md` and open a PR on
`feat/event-tracking-pipeline` when the user asks.

---

## Self-review (plan vs spec)

- **Spec coverage:** Event model (T1) · shared allowlist (T2) · rate limit (T3) · ingest
  validation/identity/caps (T4) · client track/sendBeacon/anonId (T5) · session_start +
  strict-mode-safe page_view (T6) · visibility-aware + capped dwell (T7) · card_decided
  wiring (T8) · feature_used + funnel (T9) · privacy/retention + read-side SQL (T10) ·
  tests + gate (T3/T4/T7/T11) · migration gate (T1). All spec sections map to a task.
- **Refinement vs spec manifest:** added `lib/rate-limit.ts` and `__tests__/lib/rate-limit.test.ts`
  (split the limiter out for unit-testability). Documented above.
- **Type consistency:** `EventType`/`Feature`/`MAX_*`/`DWELL_CEILING_MS` defined once in
  `lib/analytics-events.ts` and imported everywhere; `track(type, props?, ctx?)`,
  `getAnonId()`, `flush()`, and `startDwell/pauseDwell/resumeDwell/finalizeDwell` signatures
  are used consistently across T4–T8.
- **Open risk:** Tasks 8 & 9 edit existing files whose exact internals aren't pinned here —
  each task says "read the file first" and gives the precise integration contract.
