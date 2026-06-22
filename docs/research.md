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
