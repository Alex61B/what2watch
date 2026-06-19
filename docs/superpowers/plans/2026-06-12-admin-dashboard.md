# Admin / Developer Dashboard — Implementation Plan (V1)

Design: `docs/superpowers/specs/2026-06-12-admin-dashboard-design.md`
Research: `docs/research.md`

Read-only `/admin`, server-enforced via `requireAdmin()`, `ADMIN_EMAILS` allowlist,
unauthorized → 404. **No DB migrations.** Manual `Event.userId → User.id` joins.

## Implementation order

Build the guard + query layer + tests first (no UI risk), then pages, then the small
login-tracking change. Each numbered file below is exactly one `.workflow_plan_files` entry.

## 1. `lib/admin.ts` (new) — authorization
- `getAdminEmails(): Set<string>` — parse `process.env.ADMIN_EMAILS`; split on `,`, trim,
  lowercase, drop empties. Unset/empty ⇒ empty set.
- `isAdminEmail(email?: string | null): boolean` — lowercase/trim compare against the set.
- `requireAdmin(): Promise<{ userId: string; email: string }>` — `auth()`; no `session.user.id`
  ⇒ `notFound()`. Look up `user.findUnique({ where: { id }, select: { email: true } })`;
  missing or `!isAdminEmail(email)` ⇒ `notFound()`. Return `{ userId, email }`.
  (`notFound()` returns `never`, so the post-guard types narrow cleanly.)

## 2. `lib/admin-queries.ts` (new) — read-only data layer
Constants: `PAGE_SIZE = 50`, `ACTIVE_WINDOW_DAYS = 7`, `OVERVIEW_DAYS = 14`. Every Prisma
call uses an explicit safe-column `select`. Functions:
- `getOverviewMetrics()` → `{ totalUsers, newUsers7d, newUsers30d, totalEvents, dau, wau,
  loggedInEvents7d, anonEvents7d, funnel7d }`. `dau`/`wau` via
  `event.groupBy({ by:['userId'], where:{ ts:{gte}, userId:{not:null} } })` → `.length`.
  `funnel7d` via `event.groupBy({ by:['type'], where:{ type:{ in:['room_created',
  'room_started','room_matched'] }, ts:{gte} }, _count:true })`. Identity split via two
  `event.count` calls (`userId not null` / `userId: null`).
- `getActiveUsersByDay(days = OVERVIEW_DAYS)` → one parameterized `$queryRaw`:
  `SELECT date_trunc('day',"ts") d, COUNT(DISTINCT "userId") u, COUNT(*) e FROM "Event"
  WHERE "ts" >= ${since} GROUP BY 1 ORDER BY 1 DESC`. Map `bigint → Number`.
- `listUsers({ page, q })` → page users `orderBy:{ createdAt:'desc' }`, `skip/take`, optional
  `q` (`OR` on email/displayName/name, `mode:'insensitive'`); then
  `event.groupBy({ by:['userId'], where:{ userId:{ in: pageIds } }, _max:{ ts:true },
  _count:true })` merged onto rows → `lastActivity`, `totalEvents`,
  `isActive = lastActivity >= now − 7d`. Returns rows + `total` (`user.count`).
  **V1 sorts by `createdAt desc` only**; last-activity is a column, not a sort key
  (sort-by-last-active deferred — see design Non-Goals).
- `getUserDetail(userId)` → safe user fields + `event.groupBy({ by:['type'] })` counts +
  total. `null` if user missing.
- `listUserEvents(userId, page)` → `event.findMany({ where:{ userId }, orderBy:{ ts:'desc' },
  skip/take })` + count.
- `listEvents({ page, type?, identity? })` → `where` from `type` and
  `identity` (`loggedin`→`userId:{not:null}`, `anon`→`userId:null`); `findMany` ts desc +
  count; collect non-null `userId`s → one `user.findMany({ where:{ id:{ in } },
  select:{ id, email, displayName } })` and key back onto rows (manual join).

## 3. `components/admin/MetricCard.tsx` (new)
Presentational: `{ label, value, hint? }` → bordered card. Tailwind, matches app tokens.

## 4. `components/admin/Pagination.tsx` (new)
`{ page, total, pageSize, baseQuery }` → Prev/Next links that preserve existing query params
via `searchParams`. Pure, no client JS.

## 5. `app/admin/layout.tsx` (new)
`await requireAdmin()` (defense in depth) then render an admin-only nav (Overview / Users /
Events) + `{children}`. Nav exists only inside `/admin`; nothing added to product UI.

## 6. `app/admin/page.tsx` (new) — Overview
`await requireAdmin()`; `getOverviewMetrics()` + `getActiveUsersByDay()`. Render metric
cards, the 14-day activity table, funnel counts, logged-in vs anon split.

## 7. `app/admin/users/page.tsx` (new) — Users list
`await requireAdmin()`; read `searchParams` (Next 15: `searchParams` is a Promise — `await`
it) for `page`/`q`; `listUsers()`; table (email, displayName, name, createdAt, last activity,
total events, active) + `<Pagination>`; rows link to `/admin/users/[id]`.

## 8. `app/admin/users/[id]/page.tsx` (new) — User detail
`await requireAdmin()`; `await params` (Next 15) for `id`; `getUserDetail()` (→ `notFound()`
if null) + `listUserEvents()`. Safe profile fields, counts by type, paginated event feed.

## 9. `app/admin/events/page.tsx` (new) — Events feed
`await requireAdmin()`; `await searchParams` for `page`/`type`/`identity`; `listEvents()`;
filterable table; rows link to the user when `userId` present; `<Pagination>`.

## 10. `lib/analytics-events.ts` (modify)
Append `'login'` to `EVENT_TYPES`. No other change (shared client/server allowlist).

## 11. `auth.ts` (modify) — **restricted area; covered by explicit login-tracking approval**
Add to the NextAuth config:
```ts
events: {
  async signIn({ user, account }) {
    if (!user?.id) return
    try {
      await prisma.event.create({ data: {
        type: 'login', anonId: 'server', userId: user.id,
        props: { provider: account?.provider ?? null },
      }})
    } catch { /* best-effort; never block sign-in */ }
  },
},
```
No other auth behavior changes.

## 12. `README.md` (modify) — document env var
Add an "Admin dashboard" note: set `ADMIN_EMAILS=a@x.com,b@y.com` in `.env.local` + Vercel;
`/admin` is private and 404s for non-admins. **No `.env*` file is edited** (restricted).

## Tests
- `__tests__/lib/admin.test.ts` — mock `@/auth` + `@/lib/prisma` + `next/navigation`:
  unauthenticated → `notFound`; signed-in non-admin → `notFound`; allowlisted email
  (case/whitespace-insensitive) → returns identity; empty `ADMIN_EMAILS` → everyone denied.
- `__tests__/lib/admin-queries.test.ts` — mock Prisma: each function returns the expected
  shape; assert no forbidden column (`passwordHash`, `sessionToken`, `*_token`) appears in any
  `select`; `listEvents` resolves user identity via the batched lookup.
- `__tests__/auth/login-event.test.ts` — invoke the `signIn` event: writes one `login` event
  with correct `userId`/`provider`; a thrown `event.create` is swallowed (no rejection).
- `__tests__/app/admin-access.test.ts` — admin page renders for an allowlisted user; calls
  `notFound()` for a normal signed-in user.

## Acceptance criteria
- A non-admin (anonymous or signed-in) hitting `/admin`, `/admin/users`, `/admin/users/[id]`,
  or `/admin/events` gets a 404 — no admin data in the response.
- An allowlisted admin sees users (email/name/createdAt/last-activity/total-events/active),
  per-user event history, a global events feed (filterable by type + logged-in/anon), and
  overview metrics (signups, DAU/WAU, funnel, identity split, 14-day activity).
- No response ever contains a password hash, session token, OAuth token, or env secret.
- A successful sign-in writes a `login` event; a failure to write does not block sign-in.
- `npm run typecheck && npm run lint && npm test` all pass.

## Out of scope (deferred)
Mutating actions, `isAdmin` column, `Event → User` FK / any migration, charts, sort-by-last-
active, room/match/session/funnel-detail pages, cohort retention, CSV export, audit log.
