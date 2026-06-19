# Admin / Developer Dashboard — Design (V1)

**Date:** 2026-06-12
**Status:** Approved design, pending plan approval
**Branch (proposed):** `feat/admin-dashboard`

## Summary

A private, read-only `/admin` area where founders/developers can view users, activity,
and analytics. It lives in the same repo and Vercel deployment, is enforced server-side
on every page, and is invisible to normal users (no link in the product UI; unauthorized
requests get a 404). Authorization is an `ADMIN_EMAILS` env allowlist. V1 reads existing
`User` and `Event` data; the only behavioral addition is small, best-effort `login` event
tracking.

## Goals

- See **who has accounts** and **who is active**, with per-user activity drill-down.
- Surface a handful of high-signal, early-stage metrics (activation funnel, DAU/WAU,
  signups, logged-in vs anonymous).
- Zero exposure of secrets (password hashes, session tokens, OAuth tokens, env secrets).
- Smallest safe surface: read-only, server-rendered, no public discoverability.

## Non-Goals (V1)

- No mutating actions (no delete/ban/edit/impersonate).
- No charting library — tables and computed numbers only.
- No `isAdmin` column. No `Event → User` foreign-key relation. **No DB migrations.**
- No dedicated room/match/session/funnel-detail pages beyond basic counts.
- No cohort retention, no CSV export, no audit log.

These are explicitly deferred to a future version, not rejected.

## Architecture Decisions

### D1 — Same repo, protected `/admin` (not a subdomain or separate project)
A subdomain or separate Vercel project adds cross-origin session handling, CORS, and a
second deploy target for no security gain. The codebase already enforces auth per route
(`requireUserId()` in `components/ProfileGuard.tsx`; `auth()` 401-guards in API routes),
so a private path segment is just as safe when guarded server-side.

### D2 — No `middleware.ts`
Route protection in this codebase is inline per page/route. We mirror that with a
`requireAdmin()` helper rather than introduce middleware solely for `/admin`. Consistent,
fewer moving parts, same guarantee.

### D3 — `ADMIN_EMAILS` env allowlist (not `isAdmin` column)
For 2–3 founders, a comma-separated env var is server-enforceable, needs no migration, and
has no "who sets the first admin?" bootstrap problem. `requireAdmin()` is structured so a
later swap to an `isAdmin` column is a one-function change.

### D4 — Pure server components, no admin API routes
Because V1 is read-only, each admin page is a server component that queries Prisma directly
behind `requireAdmin()`. Sorting/paging/filtering ride on URL `searchParams` — no client
fetching and **no `/api/admin/*` endpoints to leak**. Any future interactive endpoint would
live under `/api/admin/*` with the same guard.

### D5 — No `Event → User` FK; manual joins
`Event.userId` already equals `User.id`. V1 resolves identities with a two-step lookup in
the query layer (collect `userId`s → `prisma.user.findMany({ where: { id: { in } } })`).
This avoids all migration risk now; the formal relation can be added later.

### D6 — Unauthorized → 404, existence hidden
`requireAdmin()` calls Next's `notFound()` for any non-admin (anonymous or signed-in
non-admin), so `/admin` is indistinguishable from a non-existent route. No admin link is
rendered anywhere in the product UI; security never depends on hiding links.

## Authorization Model

`lib/admin.ts`:

- `getAdminEmails(): Set<string>` — parse `process.env.ADMIN_EMAILS`, split on commas,
  trim, lowercase, drop empties. Empty/unset ⇒ empty set ⇒ everyone denied.
- `requireAdmin(): Promise<{ userId: string; email: string }>` — call `auth()`; if no
  session user id, `notFound()`. Look up the user's **canonical email by id in the DB**
  (not the JWT claim), lowercase it, check membership in the allowlist; if absent,
  `notFound()`. Returns the admin identity on success.

Called at the top of **every** admin page and in `app/admin/layout.tsx` (defense in depth).
Query-layer functions assume an already-authorized caller.

## Pages (V1)

1. **`/admin` — Overview.** Headline metric cards: total users; new users (7d / 30d);
   DAU; WAU; total events; logged-in vs anonymous event split (7d). A 14-day table:
   date → distinct active users, event count. Funnel counts (7d):
   `room_created → room_started → room_matched`.
2. **`/admin/users` — Users list.** Columns: email, displayName, name, createdAt,
   last activity, total events, active status. Paginated via `?page=`, sortable via
   `?sort=` (created | last_active), optional `?q=` email/name substring search.
3. **`/admin/users/[id]` — User detail.** Safe profile fields, event counts by type,
   and a paginated feed of that user's events (the "event history grouped by user").
4. **`/admin/events` — Global events feed.** Recent events across all users, paginated,
   filterable by `?type=` and `?identity=loggedin|anon`. Rows link to the user when
   `userId` is present.

**"Active" definition:** a user is active if they have any event (including `login`)
within the last `ACTIVE_WINDOW_DAYS = 7`. Window is a named constant in the query module.

## Query Layer — `lib/admin-queries.ts`

Pure, individually testable functions (mirroring the repo's mock-Prisma test style). Each
uses an explicit `select` of safe columns only.

- `getOverviewMetrics()` → counts + funnel + identity split.
- `getActiveUsersByDay(days)` → per-day distinct active users + event counts. Implemented
  with one parameterized `$queryRaw` using `date_trunc('day', ts)` (Prisma `groupBy` cannot
  bucket by day cleanly). The single raw query is read-only and parameterized.
- `listUsers({ page, sort, q })` → page of users with derived `lastActivity`, `totalEvents`,
  `isActive`. User rows come from Prisma; per-user activity aggregates come from an
  `Event.groupBy({ by: ['userId'] })` keyed back onto the page's user ids (manual join).
- `getUserDetail(userId)` → safe profile fields + counts by type.
- `listUserEvents(userId, page)` → paginated events for one user.
- `listEvents({ page, type, identity })` → global paged feed; for displayed `userId`s,
  resolve email/displayName via a single batched `user.findMany` (manual join).

Shared constants: `PAGE_SIZE`, `ACTIVE_WINDOW_DAYS`, `OVERVIEW_DAYS = 14`.

## Login Tracking (small, best-effort)

Reuses the existing `Event` table — **no schema change**.

- `lib/analytics-events.ts`: add `'login'` to `EVENT_TYPES`.
- `auth.ts`: add `events.signIn({ user, account })` → best-effort
  `prisma.event.create({ data: { type: 'login', anonId: 'server', userId: user.id,
  props: { provider: account?.provider } } })`, wrapped so a failure never blocks sign-in.

Scope guard: this is the entire login-tracking change. It must not grow into broader auth
auditing. Server-emitted login events use `anonId: 'server'` since the server has no client
anon id at sign-in.

## Data Exposure / Security

- Every Prisma `select` in admin code is an explicit allowlist of safe columns.
- **Never selected anywhere in admin code:** `User.passwordHash`, `Member.sessionToken`,
  any `Account` token columns (`access_token`, `refresh_token`, `id_token`, etc.),
  `VerificationToken`.
- No env secrets are rendered. `ADMIN_EMAILS` is only ever compared, never displayed.
- `requireAdmin()` guards page render before any data is fetched.

## Metrics Rationale (early-stage)

V1 surfaces the cheap, high-signal metrics: new signups/day, DAU, WAU, logged-in vs
anonymous ratio (account-conversion proxy), and the activation funnel
(`room_created → room_started → room_matched`) using events already emitted. Cohort
retention is the highest-value next metric but needs more query machinery, so it is deferred.

## Environment

- New env var **`ADMIN_EMAILS`** (comma-separated). Added by the user to `.env.local`
  and Vercel. Documented in `.env.example` / README; real env files are not edited here.

## Files

**Added:** `lib/admin.ts`, `lib/admin-queries.ts`, `app/admin/layout.tsx`,
`app/admin/page.tsx`, `app/admin/users/page.tsx`, `app/admin/users/[id]/page.tsx`,
`app/admin/events/page.tsx`, `components/admin/MetricCard.tsx`,
`components/admin/Pagination.tsx`. Tests: `__tests__/lib/admin.test.ts`,
`__tests__/lib/admin-queries.test.ts`, `__tests__/auth/login-event.test.ts`,
`__tests__/app/admin-access.test.ts`.

**Modified:** `lib/analytics-events.ts` (add `'login'`), `auth.ts` (add `events.signIn`),
`.env.example` / README (document `ADMIN_EMAILS`).

**No migrations.**

## Test Coverage

- `admin.ts`: non-admin → `notFound()`; admin email (case/whitespace-insensitive) → passes;
  unauthenticated → `notFound()`; empty/unset `ADMIN_EMAILS` → everyone denied.
- `admin-queries.ts`: each function returns the expected shape with mocked Prisma; assert no
  forbidden column is ever passed to `select` (PII-leak guard).
- `login-event`: `events.signIn` writes exactly one `login` event with correct
  `userId`/`provider`; a thrown DB error is swallowed (best-effort).
- `admin-access`: an admin page renders for an allowlisted user and calls `notFound()` for a
  normal signed-in user.

## Risks & Open Questions

- **R1 — `signIn` event on Credentials+JWT.** The `events.signIn` hook must be verified to
  fire for the credentials path (historically the flaky one) during TEST.
- **R2 — Forged `login` events.** Adding `'login'` to the shared client allowlist lets a
  client POST a `login` event for *its own* session. Low risk (self-only); accepted for V1.
- **R3 — Per-day aggregation cost.** `getActiveUsersByDay` uses `date_trunc`; the `Event`
  table is indexed on `(type, ts)`. Fine at current scale; revisit if events grow large.
- No blocking open questions — scope confirmed read-only, allowlist-only, no migrations.

## Readiness Verdict: READY FOR PLANNING
