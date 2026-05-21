# PROMPTS.md — Development Prompt Log

**Required:** Every prompt used during development must be logged here, without exception.
This log is verified as part of the TEST state exit criteria.

---

## Log Format

Each entry must include:

### Prompt #N — [STATE] State
**Date**: YYYY-MM-DD
**Tool**: Claude Code
**State**: RESEARCH | PLAN | IMPLEMENT | TEST
**Prompt**:
> (full prompt text, verbatim)

**Output Summary**: Brief description of what was generated or returned.
**Files Changed**: path/to/file.ts, or "none"
**Verification**: passed | failed | not applicable

---

## Prompt Log

<!-- Entries go below this line, starting at #1 -->

### Prompt #3 — RESEARCH State
**Date**: 2026-05-21
**Tool**: Claude Code
**State**: RESEARCH
**Prompt**:
> Render build log showing: Error: Column type 'name' could not be deserialized from the database. schema_engine_wasm::wasm::engine::ApplyMigrations. Build failed.

**Output Summary**: Identified that prisma.config.ts sets engine:"js" which forces the WASM schema engine for ALL Prisma CLI commands including migrate deploy. The WASM schema engine cannot handle PostgreSQL's internal `name` type found in system catalog queries during initialization. Fix is a custom Node.js migration runner using the pg library directly, bypassing the WASM schema engine entirely.
**Files Changed**: none
**Verification**: not applicable

### Prompt #2 — RESEARCH State
**Date**: 2026-05-21
**Tool**: Claude Code
**State**: RESEARCH
**Prompt**:
> Prisma error P2022 "The column (not available) does not exist in the current database" from prisma.room.findUnique(). Should I update build command to add npx prisma generate?

**Output Summary**: Identified that 4 migrations exist locally but none deployed to Render. The build script runs `prisma generate` (client codegen only) but never `prisma migrate deploy`. Fix is adding `prisma migrate deploy` to the package.json build script. Adding `npx prisma generate` to Render's build command would be redundant and would not fix the issue.
**Files Changed**: none
**Verification**: not applicable

### Prompt #1 — RESEARCH State
**Date**: 2026-05-21
**Tool**: Claude Code
**State**: RESEARCH
**Prompt**:
> I get an error after its deployed: ClientFetchError / Failed to fetch on /api/auth/session. (full error with Auth.js stack trace provided)

**Output Summary**: Investigated all env vars (confirmed correct on Render), traced root cause to next-auth 5.0.0-beta.31 bug where static NextAuth config uses `Promise.resolve(headers())` instead of `await headers()`, breaking with Next.js 15 async headers API. Fix is to use the lazy config pattern.
**Files Changed**: none
**Verification**: not applicable
