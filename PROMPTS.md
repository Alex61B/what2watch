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

### Prompt #1 — RESEARCH State
**Date**: 2026-05-21
**Tool**: Claude Code
**State**: RESEARCH
**Prompt**:
> I get an error after its deployed: ClientFetchError / Failed to fetch on /api/auth/session. (full error with Auth.js stack trace provided)

**Output Summary**: Investigated all env vars (confirmed correct on Render), traced root cause to next-auth 5.0.0-beta.31 bug where static NextAuth config uses `Promise.resolve(headers())` instead of `await headers()`, breaking with Next.js 15 async headers API. Fix is to use the lazy config pattern.
**Files Changed**: none
**Verification**: not applicable
