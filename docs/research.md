# Research — M1: Operational Floor (production-readiness)

Scope: remove correctness / security / ops gaps that stand between What2Watch and a
production deploy. **No product or recommender features** — that is M2. This milestone is
intentionally small, centralized, and shippable.

Seven work items: (1) expired-room enforcement, (2) cleanup cron, (3) durable rate
limiting, (4) safe error responses, (5) cookie hardening, (6) health check + monitoring
seam, (7) `MemberQueue` retirement.

---

## 1. Requirements Summary

**Why:** the app is functionally complete but operationally fragile. Inspection found five
concrete production gaps, none of which are theoretical:

- **Expired rooms are never enforced.** `Room.expiresAt` is set to +24h at creation
  (`app/api/rooms/route.ts:32`) and **read nowhere** (grep: only set, never compared). Rooms
  are joinable / votable forever. Correctness bug.
- **No cleanup of anything.** No `vercel.json`, no cron, no scheduler. Expired rooms, stale
  members, and the unbounded `Event` table grow forever.
- **Rate limiting is per-instance only.** `lib/rate-limit.ts` is an in-memory map — on
  Vercel each lambda has its own, so it is not a global cap. `signup`, room-create, and
  room-join have **no** limiter at all.
- **Internal errors leak to clients.** Six routes return `{ error: message, stack, name,
  stage }` on 500 (`votes`, `watched`, `queue`, `poll`, `start`, `requeue`). Stack traces
  and internal stage labels go to unauthenticated callers.
- **Session cookie missing `Secure`.** `lib/session.ts:45-50` sets `httpOnly` + `sameSite`
  but not `secure`, so the per-room session token can ride plain HTTP.

Plus two hygiene items: a `/api/health` probe (none exists), and retiring `MemberQueue`, a
table that is **written in two places and read in zero** (confirmed dead).

**What we will build:** centralized helpers (`roomExpired`, `serverError`/`logServerError`,
durable `checkRateLimit`), a secured Vercel-cron cleanup route, a health route, a cookie
flag, and a clean removal of `MemberQueue`. Small, safe edits over rewrites.

---

## 2. Stack Choices

Leverage what already exists; add the minimum new surface.

### 2.1 Expired-room enforcement — centralized guard
There is **no shared "load room + member" helper today**; every room route inlines
`getSessionToken(code)` → `member.findUnique({ sessionToken })` → `room.findUnique({ code })`
(e.g. `votes:21-40`, `queue:44-59`, `poll:18-44`). Rather than refactor all of that, add a
tiny **non-throwing** guard the routes call right after they already load the room:

```ts
// lib/room.ts (new)
export function roomExpired(room: { expiresAt: Date }): boolean {
  return room.expiresAt.getTime() < Date.now()
}
export function expiredRoomResponse(): NextResponse {        // 410 Gone
  return NextResponse.json({ error: 'This room has expired' }, { status: 410 })
}
```

Usage is one line per route: `if (roomExpired(room)) return expiredRoomResponse()`. No
try/catch restructuring, no change to how rooms are loaded.

**Block vs. read policy:**
- **410 (mutations + next-card):** `members` (join), `votes`, `watched`, `start`,
  `requeue`, `approvals`, `PATCH /[code]`, and `GET /queue` (no point serving a card).
- **200 + `expired: true` flag (state reads):** `GET /poll` and `GET /[code]` so the client
  — which already polls every 1.5s — can redirect to an "expired" view instead of getting
  silent 410s. Minimal client surfacing in `vote/page.tsx` + `lobby/page.tsx`.

### 2.2 Cleanup cron — Vercel Cron
The app is deployed on Vercel (confirmed by `lib/rate-limit.ts` comments and the admin
research). Vercel Cron is the native fit — it hits an HTTP route on a schedule; no extra
infra, no long-running worker (which serverless can't host anyway).

- **Route:** `app/api/cron/cleanup/route.ts` (GET, `dynamic = 'force-dynamic'`,
  `export const maxDuration = 60`).
- **Schedule:** `vercel.json` → daily (`0 4 * * *`). Daily works on every Vercel tier
  (Hobby allows one daily cron).
- **Auth:** Vercel injects `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set;
  the route rejects anything else with 401. (Standard documented pattern.)
- **Work (all idempotent `deleteMany`/`updateMany`):**
  - Delete rooms `expiresAt < now() - 24h grace` → cascades members/votes/queue/watched.
    (`Event` has no FK to Room — a loose `roomId` string — so analytics is **not** cascaded.)
  - Purge `Event` rows `ts < now() - 90d`.
  - Soft-leave stale members in still-active rooms (`leftAt = now()` where idle > 1h). Note:
    this is **hygiene**, not live presence — responsive presence is M4.
  - Purge expired `RateLimit` rows (see 2.3).

### 2.3 Durable rate limiting — Postgres, not Upstash
**Decision: Postgres-backed limiter. No Upstash.** The app already runs Postgres through a
`pg` Pool (`lib/prisma.ts`); the protected endpoints (signup, room-create, join, event
ingest) are low-frequency, so one atomic upsert per call is negligible. Upstash would add a
vendor, a secret, a network hop, and cost — justified only at high QPS or for sub-millisecond
fixed-window needs we don't have. This honors the "avoid unnecessary infra if Postgres is
good enough" constraint. (If load ever demands it, the helper's internals can swap to Redis
behind the same signature — the call sites won't change.)

- **Schema (new, additive):**
  ```prisma
  model RateLimit {
    key       String   @id   // `${scope}:${identifier}:${windowStart}`
    count     Int      @default(0)
    expiresAt DateTime       // window end; purged by cron
    @@index([expiresAt])
  }
  ```
- **Atomic fixed window** via a single statement (no read-modify-write race):
  `INSERT ... VALUES (key,1,expiresAt) ON CONFLICT (key) DO UPDATE SET count = "RateLimit".count + 1 RETURNING count`.
  Allow if returned `count <= limit`; else 429 with `Retry-After`.
- **Helper:** `lib/rate-limit-db.ts` → `checkRateLimit(scope, identifier, { limit, windowMs })`
  + `getClientIp(request)` (leftmost `x-forwarded-for`, which Vercel sets at its edge).
- **Apply to:** `signup` (per IP), room-create (per IP), `members`/join (per IP), `events`.
- **`events`:** *supplement* — keep the existing in-memory limiter as a cheap per-instance
  L1 (blunts a tight loop before it touches the DB) and add the durable cap as the
  authoritative global L2.
- **Deliberately NOT rate-limited:** `poll` / `votes`. Poll fires every 1.5s; a DB write per
  poll would add load to the hot path for little gain (poll already needs a valid per-room
  session token and has a cheap 304 path). Revisit only if abuse is observed.
- **Indicative limits** (tunable constants): signup 5 / 15 min / IP; room-create 10 / 10 min
  / IP; join 20 / 10 min / IP; events 200 events & 30 req / 10 s / key (unchanged).

### 2.4 Safe error responses — one helper, six routes
No shared error helper exists; routes hand-roll `NextResponse.json`. Add:

```ts
// lib/api-error.ts (new)
export function logServerError(tag: string, ctx: Record<string, unknown>, err: unknown): void
export function serverError(status = 500): NextResponse  // { error: 'Internal server error' }
```

`logServerError` keeps the **exact** structured `console.error({ stage, roomCode, name,
message, stack })` the routes log today (good logs, preserved verbatim); `serverError`
returns a generic body. Adopt in the six leak sites only; the other ~19 routes already
return safe `{ error: string }`.

### 2.5 Cookie hardening
`lib/session.ts` `setSessionCookie` (and `clearSessionCookie` for parity): add
`secure: process.env.NODE_ENV === 'production'`. `httpOnly: true`, `sameSite: 'lax'`,
`path: '/'`, per-room naming, and 7-day `maxAge` are already correct (`lax` is right — share
links are GETs; the join POST is same-origin). Gating `secure` on prod keeps local HTTP dev
working. NextAuth's own cookies are already `secure` in prod by default.

### 2.6 Health + monitoring seam
- `app/api/health/route.ts` (GET): `SELECT 1` via `prisma.$queryRaw`; 200 `{ status:'ok' }`
  or 503 on failure. No secrets, minimal.
- **Sentry: later, not now.** The centralized `logServerError` **is** the seam — wiring
  Sentry later is a one-function edit, not a route-by-route change. Adding `@sentry/nextjs`
  now means a new dependency + DSN secret + deployment config (a restricted area) for a
  milestone whose point is to *reduce* risk. Recommendation: ship structured logging +
  health now; add Sentry as an M1.5 fast-follow.

### 2.7 MemberQueue retirement (code-only this cycle)
Confirmed dead: written at `start/route.ts:100-108` and `members/route.ts:68`, **read
nowhere** (no `.find`/`.count`/`include`/`select` — grep clean). **Decision: code-only now,
defer the table drop.** Remove the two write sites + their test mocks so we stop populating
it; **keep** the `MemberQueue` model + `Member.memberQueues` relation in the schema. The
destructive drop moves to a dedicated later cleanup migration — so M1 ships **no destructive
migration**, only the additive `RateLimit` add.

---

## 3. Environment Verification

- **DB:** `lib/prisma.ts` uses `pg` Pool on `DATABASE_URL` — durable limiter + cron run on
  the existing connection; no new client. Prisma v6 local CLI in use (per project memory:
  `./node_modules/.bin/prisma`, never bare `npx`).
- **Host:** Vercel (per `lib/rate-limit.ts` comments) → Vercel Cron + `x-forwarded-for` IP
  are valid assumptions.
- **No `middleware.ts`, no `vercel.json`** today — both safe to add fresh.
- **New env vars (user-set, in `.env.local` + Vercel — NOT edited here per restricted-areas):**
  - `CRON_SECRET` — cron auth. Required for the cron to be reachable in prod.
  - No Upstash vars (Postgres chosen). No Sentry DSN (deferred).
- **Migration prereq:** `DIRECT_URL` must be in `.env.local` for `prisma migrate dev` (per
  project memory). Two schema changes this cycle (add `RateLimit`, drop `MemberQueue`).

---

## 4. Risks & Edge Cases

- **R1 — Migration is additive-only this cycle.** Per the chosen approach M1 adds the
  `RateLimit` table (safe, additive) and does **not** drop `MemberQueue` (deferred). Even an
  additive migration trips `.workflow_drift` on the generated SQL — recovery is a terminal
  `drift-to-plan` the user runs in the terminal (per project memory). No
  destructive/irreversible change this cycle.
- **R2 — Shared-IP false positives.** Per-IP limits on signup/join can catch NAT/corporate/
  campus users. *Mitigation:* generous limits + windows; pre-auth endpoints have no better
  key than IP. Tune from real 429 rates (now visible via the limiter).
- **R3 — `x-forwarded-for` spoofing.** Trust only Vercel's edge-set value (leftmost hop);
  document that the limiter is best-effort, not a security boundary on its own.
- **R4 — Fixed-window burst.** A fixed window allows up to 2× the limit across a boundary.
  Acceptable for abuse-blunting; sliding window is a future refinement.
- **R5 — Expiry breaks long sessions at 24h.** Enforcement makes a room unusable exactly at
  `expiresAt`. Fine for minutes-long sessions; sliding expiry-on-activity is explicitly out
  of scope (noted for later).
- **R6 — Cron deleting a room a user is still viewing as "expired."** *Mitigation:* 24h grace
  before deletion; enforcement (410/`expired` flag) already covers the in-between window.
- **R7 — Added DB writes under serverless connection limits.** Limiter + cron add writes;
  `RateLimit` is single-row-by-PK and indexed, cron purges it. Negligible at MVP scale.
- **R8 — `secure` cookie in local dev.** Would break http://localhost — gated on
  `NODE_ENV === 'production'`, so dev is unaffected.
- **R9 — Test regressions from MemberQueue removal.** Four test files mock
  `memberQueue.createMany` (`start`, `rooms-session`, `poll-members`, `join-approval`) plus
  an assertion in `start.test.ts:153`; all must be updated in lockstep.
- **R10 — Health endpoint exposure.** Keep it dependency-free and secret-free; a bare DB
  ping is safe to leave unauthenticated.

---

## 5. Assumptions & Open Questions

- **A1:** Deployment is Vercel (cron + edge IP). If not, the cron mechanism must change —
  **confirm before PLAN.**
- **A2 (confirmed):** Postgres-backed limiter (no Upstash) — aligns with the infra constraint.
- **A3 (resolved):** Sentry **deferred** to an M1.5 fast-follow; ship the logging + health
  seam now.
- **A4 (resolved):** `MemberQueue` is **code-only** this cycle — stop writing it, keep the
  table; the drop is deferred to a later cleanup migration. M1 ships only the additive
  `RateLimit` migration.
- **A5:** 24h room TTL with hard enforcement (no sliding expiry) is acceptable for M1.
- **A6 (resolved):** Minimal client "room expired" surfacing (poll `expired` flag + redirect
  in `vote`/`lobby`) is **in scope**.
- **Process:** M1 is a new milestone; current branch is `feat/admin-dashboard` with
  uncommitted admin work. Recommend committing/merging admin first, then branching
  `feat/operational-floor` off `main` before IMPLEMENT. **User's call.**

---

## 6. Out of Scope (this cycle)

- Any recommender / personalization / queue-quality work (that's M2/M3).
- `MemberQueue` **table drop** (M1 stops writing it; the schema drop is a later cleanup migration).
- Real-time (SSE / LISTEN-NOTIFY) and **live** presence/heartbeat auto-drop (M4).
- Sliding room expiry / expiry-on-activity.
- Sentry / external error tracking wiring (seam only; wiring is M1.5).
- Sliding-window or token-bucket limiter; rate-limiting `poll`/`votes`.
- CSRF tokens, security headers/CSP, `middleware.ts` (candidate M1.5; not required to ship).
- Analytics dashboards for funnel/retention (M5).

---

## Appendix A — File-by-file implementation plan (for PLAN)

**New files**
- `lib/room.ts` — `roomExpired()`, `expiredRoomResponse()`.
- `lib/api-error.ts` — `logServerError()`, `serverError()`.
- `lib/rate-limit-db.ts` — `checkRateLimit()`, `getClientIp()`, limit constants.
- `app/api/cron/cleanup/route.ts` — secured GET; expired-room / event-purge / stale-member /
  rate-limit-purge sweeps; `maxDuration`, `force-dynamic`.
- `app/api/health/route.ts` — DB-ping GET.
- `vercel.json` — daily cron schedule.
- Tests: `__tests__/lib/room.test.ts`, `__tests__/lib/rate-limit-db.test.ts`,
  `__tests__/lib/api-error.test.ts`, `__tests__/api/cron-cleanup.test.ts`,
  `__tests__/api/health.test.ts`.

**Modified files**
- `prisma/schema.prisma` — add `RateLimit` (additive). **Keep** `MemberQueue` (drop deferred).
- `lib/session.ts` — `secure` flag (set + clear).
- `app/api/auth/signup/route.ts` — rate limit (IP).
- `app/api/rooms/route.ts` — rate limit (IP).
- `app/api/rooms/[code]/members/route.ts` — rate limit + expiry guard + drop memberQueue write.
- `app/api/rooms/[code]/start/route.ts` — expiry guard + safe error + drop memberQueue write.
- `app/api/rooms/[code]/votes/route.ts` — expiry guard + safe error.
- `app/api/rooms/[code]/watched/route.ts` — expiry guard + safe error.
- `app/api/rooms/[code]/requeue/route.ts` — expiry guard + safe error.
- `app/api/rooms/[code]/approvals/route.ts` — expiry guard.
- `app/api/rooms/[code]/route.ts` — expiry guard (PATCH).
- `app/api/rooms/[code]/queue/route.ts` — expiry guard (410) + safe error.
- `app/api/rooms/[code]/poll/route.ts` — `expired` flag + safe error.
- `app/api/events/route.ts` — durable limiter (supplements in-memory).
- `app/room/[code]/vote/page.tsx`, `app/room/[code]/lobby/page.tsx` — minimal "expired" surfacing.
- Test updates: `__tests__/api/events.test.ts` (durable limiter), `start.test.ts`,
  `rooms-session.test.ts`, `poll-members.test.ts`, `join-approval.test.ts` (remove
  memberQueue mocks/assert), signup/rooms/members tests (429 + expiry cases).

## Appendix B — Schema changes
1. **Add** `RateLimit { key @id, count, expiresAt, @@index([expiresAt]) }` — additive, safe.
   The **only** migration this cycle. Requires `DIRECT_URL`; created via
   `./node_modules/.bin/prisma migrate dev`.
2. `MemberQueue` table **drop is deferred** — M1 only removes the write code; the model stays
   in the schema until a later cleanup migration.

## Appendix C — Test plan
- **Unit:** `roomExpired` boundary (past/future/now); limiter window math + allow/deny at
  limit; `serverError` body has no `stack`/`stage`; `logServerError` logs full context.
- **Route:** 429 + `Retry-After` on signup/room-create/join over limit; 410 on expired
  mutations + `GET /queue`; `expired:true` in poll; 500 bodies contain no stack/stage.
- **Cron:** 401 without bearer secret; correct `deleteMany`/`updateMany` `where` clauses with
  secret.
- **Health:** 200 on DB up, 503 on DB throw (mocked).
- **Regression:** `start`/`join` still pass with MemberQueue removed.
- Gate: `bash scripts/verify.sh` (typecheck → lint → jest) exits 0.

## Appendix D — Recommended order
1. **Safe error responses + cookie `secure`** — pure code, no schema/infra; immediate win.
2. **Health endpoint** — trivial, no deps.
3. **Expiry enforcement** — `lib/room.ts` + guards + minimal client; no schema.
4. **Durable rate limiting** — `RateLimit` migration (additive) + helper + endpoints.
5. **Cleanup cron** — route + `vercel.json` + `CRON_SECRET`.
6. **MemberQueue retirement (code-only)** — remove the two write sites + test mocks; keep the
   model. No destructive migration this cycle (table drop deferred).

---

## 7. Readiness Verdict: READY FOR PLANNING

Scope confirmed with the user: Postgres limiter (no Upstash), Vercel Cron, Sentry deferred,
`MemberQueue` code-only (drop deferred), minimal client expired-surfacing in scope. One
remaining assumption to confirm before IMPLEMENT: **A1** — host is Vercel (strongly implied
by existing `lib/rate-limit.ts` comments).
