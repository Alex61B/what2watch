# Design — Event tracking pipeline (v1)

**Status:** Approved design, pre-implementation
**Date:** 2026-06-10
**Author:** Alexander + Claude

## Summary

A first-party, append-only behavioral event pipeline for What2Watch. It captures
how users move through the app — page views, room funnel steps, **per-slide dwell
time**, and feature usage — into one Postgres `Event` table queried via SQL.

The data serves two purposes: product analytics now, and the **implicit-feedback
training signal** for a future "smarter next slide" recommender. `card_decided`
(movie + vote + clean dwell time) is the centerpiece signal, so dwell-time quality
is a first-class requirement, not an afterthought.

This is distinct from `docs/plan-observability.md`, which is server-side `console.*`
logging for incident debugging. This pipeline is durable, queryable product data.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Whose behavior | **Everyone, pseudonymous** — logged-in by `userId`, anonymous by client `anonId`. No PII (never store email). |
| Destination | **First-party Postgres `Event` table only.** No third-party vendor. |
| Read side | **Collect only + documented example SQL.** No dashboard in v1. |
| Identity (Approach A) | Client-generated `anonId` (`crypto.randomUUID()` in `localStorage`), sent with each event; server stamps `userId` + server `ts`. |
| Transport | `navigator.sendBeacon` with `fetch(keepalive:true)` fallback. |
| Retention | 90 days for raw events (documented policy + example purge query; automated cron deferred). |

## Goals / Non-goals

**Goals**
- One durable `Event` table, append-only, no PII.
- A non-blocking client `track()` and an unauthenticated `POST /api/events` ingest.
- **Clean dwell-time** per movie slide (visibility-aware + ceiling-capped).
- A v1 event taxonomy covering session, navigation, room funnel, slide decisions, and key features.
- Basic abuse resistance on the open ingest endpoint.

**Non-goals (v1)**
- No dashboard/admin UI (SQL only).
- No third-party analytics vendor.
- No recommender logic (this only produces its training data).
- No automated retention cron (documented query only).
- No batching/offline-retry buffer (Approach C — deferred).
- No server-minted identity cookie / middleware (Approach B — deferred).

## Architecture

```
Client (browser)                         Server (Next.js / Vercel)
─────────────────                        ───────────────────────────
lib/analytics.ts  track(type, props)
  ├─ ensure anonId (localStorage)
  ├─ buffer within a tick
  └─ flush ──sendBeacon──▶  POST /api/events
                              ├─ validate types vs allowlist (lib/analytics-events.ts)
                              ├─ cap batch size + payload bytes
                              ├─ in-memory rate-limit (per anonId, IP fallback)
                              ├─ resolve userId via auth()
                              └─ prisma.event.createMany()  ──▶  Event table

<AnalyticsTracker/> (root layout)         lib/analytics-events.ts  (shared allowlist + types,
  ├─ session_start (once/tab)              imported by BOTH client and ingest validator)
  └─ page_view on URL change

vote/page.tsx  → card_decided{dwellMs}
feature call sites → feature_used
```

The event-type allowlist + payload shapes live in **one shared module**
(`lib/analytics-events.ts`) imported by both the client and the ingest validator,
so client and server can never disagree about what's valid.

## Components

### 1. Data model — `Event` (new, append-only)

```prisma
model Event {
  id       String   @id @default(uuid())
  type     String          // allowlisted event name
  anonId   String          // client device id (always present)
  userId   String?         // set when logged in — NOT a relation
  memberId String?         // room participant, when applicable
  roomId   String?
  props    Json?           // type-specific payload
  ts       DateTime @default(now())

  @@index([type, ts])
  @@index([roomId])
  @@index([userId])
  @@index([anonId])
}
```

- **No FK relation to `User`/`Room`/`Member`.** Analytics must not cascade-delete and
  must survive user/room deletion; `userId`/`roomId`/`memberId` are plain indexed
  columns. The `User` model is **not** modified.
- `props` holds only non-PII, type-specific fields (movie ids, dwell ms, vote bool,
  feature name, path). Never `email` or free-text that could carry PII.

### 2. Shared allowlist — `lib/analytics-events.ts`

```ts
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
```

### 3. Ingest — `POST /api/events`

- **Request body:** `{ anonId: string, events: ClientEvent[] }` where
  `ClientEvent = { type: EventType, props?: object, roomId?: string, memberId?: string, clientTs?: number }`.
- **Content-Type:** tolerant — `sendBeacon` sends a `Blob`; parse the raw body as JSON
  regardless of declared content-type.
- **Validation (drop-not-500):** unknown `type` → skip that event; batch > `MAX_EVENTS_PER_REQUEST`
  → truncate; `props` serialized > `MAX_PROPS_BYTES` → drop that event. A malformed body
  returns `204` (best-effort telemetry never errors the client).
- **Identity:** `userId` from `await auth()` (nullable); `anonId` taken from the body
  (validated as a non-empty string ≤ 64 chars). Server `ts = now()` is authoritative;
  `clientTs` is accepted but ignored in v1.
- **Write:** `prisma.event.createMany({ data, skipDuplicates: false })`.
- **Response:** `204 No Content` on success; `429` when rate-limited (see §6). Never blocks.
- **Auth:** none required (anonymous participants must be trackable).

### 4. Client — `lib/analytics.ts`

- `getAnonId()`: read `w2w_anon` from `localStorage`; if absent, `crypto.randomUUID()`,
  persist, return. SSR-safe guard (`typeof window`); no-op on the server.
- `track(type, props?, ctx?)`: push `{type, props, roomId?, memberId?}` into a module
  buffer; schedule a microtask/`setTimeout(0)` flush (coalesces bursts).
- `flush()`: `navigator.sendBeacon('/api/events', Blob([JSON]))`; if `sendBeacon` is
  unavailable or returns false, `fetch('/api/events', {method:'POST', keepalive:true, body})`.
  Also flush on `visibilitychange → hidden` and `pagehide` so buffered events aren't lost.
- Fully fire-and-forget: failures are swallowed; analytics must never affect UX.

### 5. `<AnalyticsTracker/>` (client component, mounted in root layout)

Mounted inside `SessionProviderWrapper` in `app/layout.tsx`.

- **`session_start`:** fire once per tab session, guarded by a `sessionStorage` flag
  (`w2w_session_started`).
- **`page_view`:** see §7 for the strict-mode-safe implementation.

### 6. Rate limiting (in-memory, v1)

An in-process fixed-window limiter in the ingest route module:

```ts
// key = anonId || `ip:${ip}`  (ip from x-forwarded-for, first hop)
// window = 10s; allow up to 30 requests AND 200 events per key per window
```

- Keyed by `anonId`; falls back to client IP when `anonId` is missing/garbage.
- Over limit → `429` (client drops the batch; no retry in v1).
- A small `Map` with periodic pruning of expired windows (bounded size; evict oldest if it grows past a cap).

**Honest caveat (documented in code + spec):** Vercel runs multiple serverless
instances, so an in-memory limiter is **per-instance**, not global — it blunts a
single-instance hammering loop but is not a hard global cap. That is acceptable for
v1 per scope; a Redis/Upstash global limiter is the documented upgrade path if abuse
appears. Batch + payload caps (§3) bound per-request damage regardless.

### 7. `page_view` correctness (explicitly required)

```tsx
'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

function PageViewTracker() {
  const pathname = usePathname()
  const search = useSearchParams()
  const lastUrl = useRef<string | null>(null)
  useEffect(() => {
    const url = search?.toString() ? `${pathname}?${search}` : pathname
    if (url === lastUrl.current) return   // dedupe: real change only
    lastUrl.current = url
    track('page_view', { path: url })
  }, [pathname, search])
  return null
}
```

- Wired to **`usePathname()` + `useSearchParams()`** changes (the effect dependency
  array), **not** component mount — so it fires on every client navigation.
- The `lastUrl` ref makes it **idempotent per URL**: React **strict mode**
  double-invokes effects in dev, but the second invocation sees an unchanged `url`
  and returns early → **exactly one `page_view` per actual navigation** in dev and prod.
- `useSearchParams()` requires a `<Suspense>` boundary; `<AnalyticsTracker/>` wraps
  `<PageViewTracker/>` in `<Suspense>` (matching the existing pattern in `signin/page.tsx`).

### 8. Dwell time — `card_decided` (the recommender signal)

Measured in `app/room/[code]/vote/page.tsx`. A small `useCardDwell` hook owns a
**visibility-aware accumulator**:

- **Accumulate only visible time.** Track `activeSince` (timestamp) and `accumMs`.
  - When a new card becomes current: reset `accumMs = 0`, `activeSince = now()` (if visible).
  - On `visibilitychange → hidden`: `accumMs += now() - activeSince`; set `activeSince = null` (paused).
  - On `visibilitychange → visible`: `activeSince = now()` (resume).
- **On decision (vote yes/no or skip):** `dwellMs = accumMs + (activeSince ? now() - activeSince : 0)`.
- **Ceiling cap:** if `dwellMs > DWELL_CEILING_MS (60s)`, emit `dwellMs = 60_000` and
  `props.dwellCapped = true`. (Even with visibility pausing, a phone-locked-then-returned
  edge or a long genuine stare gets clamped so it can't poison averages.)
- Emit `card_decided { roomId, movieId, vote: boolean, dwellMs, dwellCapped? }` — `vote`
  is `true` (yes swipe) or `false` (no swipe). There is no separate skip action in v1; the
  swipe **is** the decision, so every card view ends in exactly one `card_decided`.

Rationale: a backgrounded tab must never report a 4-minute dwell. Visibility-pausing
gives clean active-attention time; the ceiling is a hard safety net. Both, because this
is the one signal the future recommender depends on.

### 9. Feature instrumentation (v1)

`feature_used { feature: Feature, ...context }` at these call sites (highest value first):
`filter_edit` / `depth_change` (filter editor + setup), `skip_reruns` (toggle),
`requeue` (host requeue), `share_link` (copy/share), `friend_compare` (open friend page).
Room funnel events (`room_created/joined/started/matched`) are emitted from the existing
client flows right after the corresponding API call succeeds.

## Privacy & retention

- Pseudonymous only: ids (`anonId`, `userId`, `memberId`, `roomId`), never `email` or names.
- `props` is an allowlisted, bounded shape — no free-text user input.
- **90-day retention.** Documented policy; example purge shipped in the queries doc:
  `DELETE FROM "Event" WHERE ts < now() - interval '90 days';`
  Automated scheduling (cron/Vercel scheduled function) is a documented follow-up, not v1.

## Read side — `docs/analytics-queries.md`

Copy-paste SQL, no dashboard:
- Top movies by **avg clean dwell** (excluding `dwellCapped`) and by **YES-rate**.
- created → started → matched **funnel** counts.
- **feature_used** counts by feature.
- **DAU** (distinct `anonId` per day) and logged-in vs anonymous split.

## Testing

- `__tests__/api/events.test.ts` (Jest, mocked Prisma per repo convention):
  allowlist enforcement (unknown type dropped), batch truncation at `MAX_EVENTS_PER_REQUEST`,
  oversized-props drop, `userId` stamping when authed, anonymous path (no auth), `429` when
  rate-limited, malformed body → `204`.
- A unit test for the shared `analytics-events` allowlist/validator helper.
- Dwell accumulator: a pure helper (`computeDwell`/reducer) extracted so it's unit-testable
  without a DOM — tests for visible-only accumulation, pause/resume, and ceiling cap+flag.
- E2E deferred (no Playwright yet) — noted as the gap.

## Migration & rollout

- Adds the `Event` table → requires `npx prisma migrate dev` (**restricted op**).
  `DIRECT_URL` is present in `.env.local`, so it will run.
- **GATE:** the migration will NOT be run without the user's explicit approval. Implementation
  will pause at the migration step and ask.
- Rollout is additive and non-breaking: nothing reads `Event` yet; instrumentation is
  fire-and-forget, so a failed ingest can't degrade the app.

## File manifest (preview for PLAN)

| File | Change |
|---|---|
| `prisma/schema.prisma` | add `Event` model (+ generated migration) |
| `lib/analytics-events.ts` | new — shared allowlist, types, limits |
| `lib/analytics.ts` | new — client `track`/`flush`/`getAnonId` |
| `lib/dwell.ts` | new — pure visibility-aware dwell accumulator (testable) |
| `components/AnalyticsTracker.tsx` | new — session_start + page_view (Suspense + ref dedupe) |
| `app/api/events/route.ts` | new — ingest + validation + in-memory rate limit |
| `app/layout.tsx` | mount `<AnalyticsTracker/>` |
| `app/room/[code]/vote/page.tsx` | wire `useCardDwell` → `card_decided` |
| (feature call sites) | `feature_used` + room funnel emits |
| `__tests__/api/events.test.ts` | new — ingest tests |
| `__tests__/lib/dwell.test.ts` | new — dwell accumulator tests |
| `docs/analytics-queries.md` | new — example SQL + purge query |

**Implementation sequencing:** PLAN may split this into two serial sub-cycles if a smaller
manifest is preferred — (1) **pipeline core**: `Event` schema, `/api/events` ingest,
`lib/analytics-events.ts` + `lib/analytics.ts`, `<AnalyticsTracker/>` (`session_start` +
`page_view`); then (2) **signal instrumentation**: `lib/dwell.ts` + vote-page `card_decided`
and the `feature_used`/funnel emits. The repo's workflow is driven serially (one
`.workflow_plan_files` manifest at a time), so this is sequenced, not parallelized.

## Open questions

None blocking. Deferred-by-decision: third-party forwarding (PostHog), dashboard,
automated retention cron, server-minted identity cookie, batched/offline client buffer.
