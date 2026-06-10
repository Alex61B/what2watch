# Research — Event tracking pipeline (Phase 1)

Full design + task plan already exist:
- Spec: `docs/superpowers/specs/2026-06-10-event-tracking-pipeline-design.md`
- Plan: `docs/superpowers/plans/2026-06-10-event-tracking-pipeline.md`

This RESEARCH doc covers the **Phase 1 (pipeline core)** cycle being implemented now.

## Requirements Summary

Ship the durable, first-party behavioral event pipeline's core: a Postgres `Event` table,
an unauthenticated `POST /api/events` ingest (validate against a shared allowlist, in-memory
rate-limit, stamp `userId`/`ts`, `createMany`), a client `track()`/`flush()` over `sendBeacon`,
and a mounted `<AnalyticsTracker/>` emitting `session_start` + a strict-mode-safe `page_view`.
Pseudonymous (logged-in `userId` + client `anonId`); no PII. Approved amendments: `pikflix_`
storage prefix, `clientTs` → `props._clientTs`, test-only rate-limiter reset.

Phase 2 (dwell on the vote page, `feature_used`/funnel emits, queries doc) is a separate cycle.

## Stack Choices

- **Prisma `Event` model**, no relations (analytics must survive user/room deletion; `User` untouched).
- **`navigator.sendBeacon`** + `fetch(keepalive)` fallback for non-blocking sends.
- **Shared allowlist module** (`lib/analytics-events.ts`) imported by client and the ingest validator.
- **Pure, clock-injected helpers** for the rate limiter (`lib/rate-limit.ts`) so they're unit-testable
  with mocked time, matching the repo's Jest-mocks-Prisma convention.
- **Mount point:** `<AnalyticsTracker/>` inside `SessionProviderWrapper` in `app/layout.tsx`
  (confirmed existing wrapper); `useSearchParams` wrapped in `<Suspense>` (matches `signin/page.tsx`).

## Environment Verification

- `app/layout.tsx` has `SessionProviderWrapper` (mount point) and an existing `w2w_theme` key
  (out of scope — not renamed).
- No existing `Event` model, `/api/events` route, or tracking code (greenfield).
- `DIRECT_URL` present in `.env.local` → the gated `prisma migrate dev` will run when approved.
- Schema edit needs `npx prisma generate` (safe, no DB write) so `prisma.event` typechecks before
  the migration is run. Tests mock Prisma, so they pass without the table existing.

## Risks & Edge Cases

- **Migration is gated** — `prisma migrate dev` is restricted; it runs only on explicit user
  approval (asked at the migration step). Generated migration SQL trips `.workflow_drift`; recovery
  is `advance_state.sh drift-to-plan` (user-run) per `feedback-workflow-drift-recovery`. To keep this
  cycle clean, the migration is deferred: schema is edited + `prisma generate`d now; the DB migration
  is a separate gated step.
- **In-memory rate limit is per serverless instance** (not global) — documented; Redis is the upgrade.
- **Best-effort ingest** must never 500 the client: malformed body / unknown types / oversized props
  are dropped, returning `204`; `429` only on rate limit.
- **`page_view` double-fire** under React strict mode (dev) — mitigated by a `lastUrl` ref dedupe.
- **SSR safety** — client analytics guard on `typeof window`; no-op on the server.

## Assumptions & Open Questions

- `anonId` is client-generated and trusted (pseudonymous product analytics; spoofing not a threat).
- `clientTs` is advisory only (ordering within a batch); server `ts` is authoritative.
- No blocking open questions. Migration timing is the one user gate.

## Out of Scope

- Phase 2 instrumentation (dwell/vote page, feature/funnel emits, queries doc) — next cycle.
- Third-party analytics, dashboards, automated retention cron, server-minted identity cookie,
  batched/offline client buffer.
- Renaming `w2w_theme` or the `w2w_session_<CODE>` room cookie.

## Readiness Verdict: READY FOR PLANNING
