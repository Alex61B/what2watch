# Research: Fix Prisma P2022 — Missing Columns in Production

## Requirements Summary

Fix `P2022: The column (not available) does not exist in the current database` thrown by `prisma.room.findUnique()` on the Render deployment. The production database is missing columns/tables added by recent migrations because `prisma migrate deploy` has never run against it.

## Stack Choices

- Prisma 6.19.3 with pg driver adapter (JS engine, no native binary)
- PostgreSQL on Render (internal network URL)
- 4 migrations in `prisma/migrations/`, none deployed to production

## Environment Verification

- `DATABASE_URL` is set in Render environment variables ✓
- `prisma` CLI is in `dependencies` (not devDependencies) so it's available at build time ✓
- Build script is `prisma generate && next build` — missing `prisma migrate deploy`

## Risks & Edge Cases

- `prisma migrate deploy` is idempotent and safe: applies only unapplied migrations in order, never drops or resets data.
- Running migrations during build (before `next build`) means the DB is updated before new code goes live — correct order for additive changes.
- If a migration has a destructive change (drop column, rename) in the future, a separate deployment strategy would be needed. Not applicable here.

## Assumptions & Open Questions

- All 4 migrations are safe to apply together (they are: additive schema changes).
- No open questions.

## Out of Scope

- Zero-downtime migration strategies.
- Rolling deployments.
- Database backups prior to migration (handled by Render's managed Postgres).

## Readiness Verdict: READY FOR PLANNING

Root cause confirmed. Fix is adding `prisma migrate deploy` to the build script in `package.json`.
