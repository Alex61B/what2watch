# Research: Fix prisma migrate deploy — WASM schema engine name type error

## Requirements Summary

`prisma migrate deploy` fails on Render with `Error: Column type 'name' could not be deserialized from the database` in `schema_engine_wasm`. Migrations need to run against the production database without using the WASM schema engine.

## Stack Choices

- Prisma 6.19.3 with `engine: "js"` in `prisma.config.ts` (WASM, no native binary)
- `pg` v8 already a production dependency — can be used for direct SQL execution
- Node.js scripts in `scripts/` are CommonJS (`package.json` has no `"type": "module"`)

## Environment Verification

- `DATABASE_URL` is set in Render environment variables ✓
- `pg` is in `dependencies` (not devDependencies) — available at build time ✓
- `prisma.config.ts` forces WASM engine for ALL Prisma CLI commands including `migrate deploy`
- WASM schema engine cannot deserialize PostgreSQL's internal `name` type from system catalogs
- Native binary engine not viable on Render (OpenSSL issue, see git commits 3beacb7 and 74cc409)

## Risks & Edge Cases

- Custom migration runner must use the exact `_prisma_migrations` schema Prisma expects, so `prisma studio` and other Prisma tools still work correctly.
- Each migration runs in a transaction; if it fails, it rolls back and the build fails — no partial state.
- Script is idempotent: already-applied migrations are skipped.
- `crypto.randomUUID()` requires Node.js 15.6+ — Render uses Node.js 18+ ✓

## Assumptions & Open Questions

- All 4 existing migrations will apply cleanly to the production database.
- No open questions.

## Out of Scope

- Upgrading Prisma or switching from the JS engine.
- Zero-downtime migrations.

## Readiness Verdict: READY FOR PLANNING

Root cause confirmed. Fix is a new `scripts/migrate-deploy.js` script + one-line change to the `package.json` build script.
