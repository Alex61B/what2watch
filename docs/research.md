# Research: Prisma Migration Approval Gates

## Requirements Summary

Add `directUrl` to the Prisma datasource block to support Supabase's connection architecture. Supabase provides two PostgreSQL endpoints:
1. **Pooled connection** (`DATABASE_URL`): goes through PgBouncer; mandatory for serverless (Vercel) to avoid connection exhaustion; does NOT support Prisma migrations or schema introspection.
2. **Direct connection** (`DIRECT_URL`): bypasses PgBouncer; required for `prisma migrate deploy`, `prisma db push`, and `prisma db pull`.

Without `directUrl`, running any Prisma migration command against Supabase fails with a connection error because PgBouncer does not support the extended wire protocol used by Prisma's migration engine.

## Stack Choices

- **Prisma `directUrl` field** (added in Prisma 5.x): lets the schema declare two connection strings — one for the ORM at runtime, one for the migrate engine. Zero runtime overhead; only the migration engine uses `DIRECT_URL`.
- **No alternative**: there is no safe way to run migrations against Supabase without a direct (non-pooled) connection. Prisma's `datasource.directUrl` is the official solution.
- **Environment variable `DIRECT_URL`**: must be set in `.env.local` (dev) and in Vercel's environment dashboard (production). Supabase dashboard → Settings → Database → Connection string → "Direct connection".

## Environment Verification

- Prisma version in `package.json`: 6.x — `directUrl` is supported.
- `prisma/schema.prisma` datasource block currently only has `url = env("DATABASE_URL")`.
- `.env.local` has `DATABASE_URL`; `DIRECT_URL` must be added manually after migration to Supabase.
- One-line change: add `directUrl = env("DIRECT_URL")` inside the datasource block.
- `scripts/migrate-deploy.js` uses `process.env.DATABASE_URL` directly (pg Pool) — unaffected by this change.

## Risks & Edge Cases

- **Local dev without Supabase**: if `DIRECT_URL` is not set in `.env.local`, `prisma migrate dev` will throw `Environment variable not found: DIRECT_URL`. Mitigation: set `DIRECT_URL` equal to `DATABASE_URL` in local `.env.local`.
- **CI pipelines**: any CI step running `prisma migrate deploy` needs `DIRECT_URL` in the environment. Vercel preview builds do not run migrations (they use the pre-deployed schema), so this only affects intentional migration runs.
- **No schema logic change**: the change is datasource config only. No models, relations, or SQL are affected. Prisma Client generation is unaffected.

## Assumptions & Open Questions

- Assume Supabase will be the target database (as decided in the tech stack evolution plan).
- Assume `DIRECT_URL` will be populated by the developer when switching to Supabase. This PR only wires the schema; it does not set env vars.
- No open questions — the change is unambiguous and well-documented by Prisma.

## Out of Scope

- Setting env vars in `.env.local`, Vercel, or CI — that is an infrastructure step.
- Running the actual database migration to Supabase.
- Changes to `scripts/migrate-deploy.js` (it uses raw pg Pool, not Prisma migrate engine).
- Any model or relation changes.

## Readiness Verdict: READY FOR PLANNING

One file, one line added: `prisma/schema.prisma` — `directUrl = env("DIRECT_URL")` in the datasource block.
