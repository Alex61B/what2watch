# Research — WP1b: Enumeration / UX Hardening

> Follow-up to WP1a (limiter core, PR #22). Closes the remaining half of WP1 from the
> 2026-06-21 production-readiness audit: **M1** (room-roster GET over-exposure) and **M2**
> (user-search enumeration + email exposure). Direction was pre-decided with the user on
> 2026-06-21 (recorded in the WP1a research as OQ1/OQ2). **Migration-free, dependency-free.**

---

## 1. Requirements Summary

Two information-disclosure / enumeration findings, both reusing the existing durable limiter
`lib/rate-limit-db.ts` (no new infra, no schema change, no auth change).

**M1 — Unauthenticated room-roster GET (`GET /api/rooms/[code]`) over-exposes room state.**
Today the GET is fully unauthenticated and returns the **full** room state to anyone who knows
(or guesses) a code: the member roster (`id`, `displayName`, `isHost`, `lastSeenAt`), the matched
movie (incl. `watchUrl`/`streamingService`), and all room config (`streamingServices`, `filters`,
`watchedFilter`). Room codes are short and guessable (`ADJECTIVE-DD` = 100 × 90 = 9 000 combos,
`lib/room-code.ts`), so this is enumerable.
- **Decided (OQ1):** the unauthenticated/non-member response is restricted to **existence + room
  `name` + `status`** (plus `expired`, and the already-session-gated `currentMemberId`/
  `isCurrentUserHost`, which are `null`/`false` for non-members). `members`, `lastSeenAt`,
  `matchedMovie`, and room config become **members-only** (caller must hold a valid per-room
  session for that room). **Keep the short shareable code** — do not lengthen it.
- **Decided (OQ1):** add an **IP rate-limit** on the GET to throttle enumeration.

**M2 — User search (`GET /api/users/search` → `lib/friends.ts#searchUsers`) enables enumeration
and leaks email.** Today `searchUsers` substring-matches **both** `displayName` **and** `email`
(case-insensitive `contains`) on any non-empty query and returns `email` in the payload;
`components/FriendsClient.tsx` renders that email under every result. A single-character query
returns a broad slice of the user table, and email substring match turns the box into an
address-harvesting tool.
- **Decided (OQ2):** `displayName` **substring** match requires a **minimum of 2 characters**;
  `email` matches **exactly** (case-insensitive `equals`, not `contains`). **Drop `email` from the
  search response** and stop rendering it in `FriendsClient`. Add a **`userSearch` rate-limit**.

**Why now:** both are pre-launch hardening items (audit M1/M2). They are independent of WP1a but
share `lib/friends.ts` (WP1a added the friend-request cooldown there), which is why this branch is
stacked on the WP1a tip.

---

## 2. Stack Choices (reuse existing patterns — no new dependencies)

- **Rate limiting:** reuse `lib/rate-limit-db.ts` exactly as WP1a wired it. Add two scopes to
  `RATE_LIMITS` and call `checkRateLimit(scope, identifier, RATE_LIMITS.x)` → `tooManyRequests(...)`.
  - `roomGet`: **IP-keyed** (`getClientIp(request)`), **fail-open** (default) — best-effort
    enumeration throttle; the lobby must still load on a limiter-DB hiccup. Proposed **60 / min / IP**
    (legit callers fetch the GET a handful of times; polling uses `/poll`, not this route).
  - `userSearch`: **per-authenticated-user**-keyed (`session.user.id`, mirroring `friendRequest`),
    **fail-open**. Proposed **30 / min / user**.
- **Membership check:** reuse the existing `getSessionToken(code)` + `prisma.member.findFirst({ where:
  { sessionToken, roomId } })` already present in the GET handler — the gate is "did this browser
  resolve to a member of *this* room". Keep the current `room.findUnique({ include: { members } })`
  query shape (do **not** switch to `member.findMany`) so the existing `room-name.test.ts` prisma
  mock — which implements `room.findUnique({include})` + `member.findFirst` but **not**
  `member.findMany` — stays valid.
- **Search query change:** Prisma `where` only — `email: { equals: q, mode: 'insensitive' }` and an
  early `if (q.length < 2) return []`; narrow `select` to `{ id, displayName }`.
- **Types:** keep `PublicUser { id, displayName, email }` for `listFriends` (accepted friends /
  pending requests already have a relationship; email there is unrendered and out of M2's scope).
  Give `searchUsers` a **narrower** return type (`{ id: string; displayName: string }`) so email
  cannot leak through search. Mirror with a local result type in `FriendsClient`.

---

## 3. Environment Verification

- **Branch/state:** `feat/wp1b-enumeration-hardening` off the WP1a tip (`aa2a87a`); `.workflow_state`
  = RESEARCH, `.workflow_failures` = 0. WP1a is in review as PR #22.
- **Limiter is live:** `lib/rate-limit-db.ts` (Postgres-backed, cleanup cron) is in production after
  WP1a; the `RateLimit` table + scope pattern already exist — adding scopes needs **no migration**.
- **Verification command:** `bash scripts/verify.sh` (typecheck → lint → jest). Baseline on this
  branch is **green: 296 tests / 47 suites** (the WP1a-on-main count).
- **No `middleware.ts`** at the repo root — room pages are client-rendered and self-gate by fetching
  room state, so a non-member *can* navigate to any `/room/[code]/*` route. Consumer audit below
  accounts for this.
- **`./node_modules/.bin/prisma` only** (bare `npx prisma` pulls v7). Not needed this cycle — no
  schema change.

---

## 4. Risks & Edge Cases

- **Lobby consumer breakage (highest risk).** `app/room/[code]/lobby/page.tsx` is the share-link
  landing page hit by **non-members**, and it consumes the GET response **unconditionally** before
  the user joins: `setMemberCount(data.members.length)` (line 81) and `room.streamingServices.length`
  (line 218) both run for every caller. Dropping `members`/`streamingServices` from the non-member
  payload would throw `TypeError` and brick the lobby. **Mitigation:** harden the lobby to treat
  `members`/`streamingServices` as optional (`data.members?.length ?? 0`, `room.members ?? []`,
  `room.streamingServices?.length`). After joining, the lobby re-fetches the GET **as a member**
  (line 152) and receives the full payload, so the member list still renders post-join.
- **Other GET consumers are already safe** (audited): `done/page.tsx` uses only `data.name ?? null`;
  `setup/page.tsx` guards every field (`data.members ?? []`, `data.streamingServices ?? []`) **and**
  redirects non-hosts to the lobby (`if (!data.isCurrentUserHost) return router.replace(.../lobby)`)
  before touching members; `HostFilterEditor.tsx` runs only in an authenticated host context. No
  changes needed in those three.
- **Existing GET test stays green.** `__tests__/api/room-name.test.ts` exercises the GET **as a
  member** (cookie set via `applyCookies`) and asserts `.name`; `name` is in both the minimal and
  full payloads, and `checkRateLimit` is already mocked-ok there → passes unchanged (no edit needed).
- **searchUsers test must be updated.** `__tests__/lib/friends.test.ts` asserts the *exact* `where`
  (`email: { contains }`) and `select` (incl. `email`); M2 changes both, so this test is updated
  in-scope (email `equals`, `select` drops `email`, add min-2-char cases).
- **Rate-limit ordering.** Check the IP limit at the **top** of the GET (before `findUnique`) so
  probing **non-existent** codes is also throttled — otherwise 404s are a free enumeration oracle.
- **Shared-IP / NAT false positives.** 60/min/IP for `roomGet` is generous enough for households /
  small offices behind one IP loading a few rooms; fail-open avoids hard outages. (Codes remain
  guessable by design — OQ1 kept the short code; rate-limiting is the agreed mitigation, not secrecy.)
- **Residual, out of scope:** `listFriends` (and thus `GET /api/friends`) still returns `email` for
  accepted friends / pending requests in the JSON (unrendered). Lower risk (requires an existing
  relationship, not open enumeration); noted, not addressed this cycle.
- **No new fail-closed scopes** — both new scopes are fail-open; neither is an auth/brute-force
  vector, and availability of lobby/search is preferred on a limiter outage.

---

## 5. Assumptions & Open Questions

Direction was pre-decided (OQ1/OQ2), so the genuine unknowns are just tunable constants:

- **A1:** Non-member room payload = `{ code, name, status, expired, currentMemberId: null,
  isCurrentUserHost: false }`. Member payload is unchanged from today. *(Assumed from OQ1.)*
- **A2:** `roomGet` = **60/min/IP**, fail-open; `userSearch` = **30/min/user**, fail-open.
  *(Proposed defaults — tunable in PLAN; not blocking.)*
- **A3:** `searchUsers` min length = **2**; email match = exact case-insensitive `equals`; result
  shape = `{ id, displayName }`. *(Assumed from OQ2.)*
- **A4:** Keep `email` in `listFriends`/`PublicUser` (friends list); only the **search** path drops
  it. *(Scope decision — flagged in §4/§6.)*
- **OQ-b1 (non-blocking):** are the proposed limits (A2) acceptable, or tighter for `roomGet`?
  Default to A2 unless the user prefers otherwise at plan-approval.

---

## 6. Out of Scope

- Lengthening or changing the room-code format (`lib/room-code.ts`) — OQ1 explicitly keeps the short
  code; no code change there.
- Dropping `email` from `listFriends` / `GET /api/friends` (the unrendered friends-list email) —
  lower-risk residual, deferred.
- Any schema/migration change, Redis/Upstash, CAPTCHA, or new dependency.
- Other work packages: WP2 (headers/CSP), WP3 (Sentry), WP5 (env fail-fast), WP6 (privacy), WP7
  (ops/backup runbooks), WP8 (`next` 16).
- Auth/session logic (`auth.ts`, `app/api/auth/`) — untouched.

---

## 7. Readiness Verdict: READY FOR PLANNING

All call sites confirmed against current code: the only consumer needing a change is the lobby
(`app/room/[code]/lobby/page.tsx`); `done`/`setup`/`HostFilterEditor` are already null-safe; the
existing GET test passes unchanged; the `searchUsers` test is updated in-scope. The query-shape
decision (keep `room.findUnique({include})`) is dictated by the existing mock. Design decisions are
settled (OQ1/OQ2); only tunable limits remain (A2), which are not blocking. Ready to advance to PLAN.

---

# Research — Fix: cap the Postgres connection pool for serverless

## 1. Requirements Summary

Production `/admin` (and the app under load) 500s with Postgres
`XX000 (EMAXCONNSESSION) max clients reached in session mode - pool_size: 15`. Root cause:
`lib/prisma.ts` creates `new Pool({ connectionString })` with **no `max`**, so the `pg` driver
defaults to **10 connections per pool**. On Vercel each serverless instance holds its own pool,
so a few warm instances blow past the pooler's client cap. The admin overview
(`getOverviewMetrics`) fans out ~8 `count`/`$queryRaw` queries via `Promise.all`, so it's the
first thing to exhaust the pool. **Fix B:** cap the per-instance pool to 1 connection.
(**Fix A**, switching `DATABASE_URL` to Supabase's transaction-mode pooler on port 6543, is an
env change the user owns — out of scope for this code change.)

## 2. Stack Choices

- The project uses the Prisma **driver adapter** (`@prisma/adapter-pg` + `pg` `Pool`), so pool
  sizing is controlled by the `pg` `Pool`'s `max` option in code — the URL's `connection_limit`
  param is **not** honored by `pg`. So the fix lives in `lib/prisma.ts`: `new Pool({ ..., max: 1 })`.
- One connection per instance is the standard serverless value; paired with a transaction-mode
  pooler (Fix A) it scales cleanly without pinning sessions.

## 3. Environment Verification

- `lib/prisma.ts`: `new Pool({ connectionString: process.env.DATABASE_URL })` → `PrismaPg` adapter
  → `PrismaClient`. No `max` today.
- Error confirms `DATABASE_URL` currently points at the **session-mode** pooler (port 5432).
- Local dev: `max: 1` is harmless (single-user); the dev `globalForPrisma` reuse is unchanged.

## 4. Risks & Edge Cases

- **Within-instance serialization:** with `max: 1`, concurrent queries on one instance queue
  through a single connection. Most routes already `await` sequentially; the admin `Promise.all`
  counts will serialize (slightly slower page, not an error). Acceptable, and the proper remedy
  is Fix A (transaction pooler), not a bigger per-instance pool.
- **Throughput:** Vercel functions handle ~one request at a time per instance, so `max: 1`
  rarely bottlenecks; more instances scale out horizontally.
- Does **not** by itself raise the session-pooler 15 cap — Fix A is still required for headroom.
  This change bounds each instance to 1 connection so the cap is hit far later.

## 5. Assumptions & Open Questions

- User applies **Fix A** (DATABASE_URL → transaction pooler, port 6543) in Vercel; this code
  change is the complementary hardening. No blocking questions.

## 6. Out of Scope

- The Vercel env change (Fix A). Reducing the admin overview's query fan-out. Any broader
  Prisma/datasource refactor.

## 7. Readiness Verdict: READY FOR PLANNING
