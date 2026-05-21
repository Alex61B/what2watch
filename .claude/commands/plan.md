# /plan — PLAN State Command

You are now in the **PLAN** workflow state. Read `AGENTS.md` for the authoritative rules.

## Purpose
Produce a concrete, complete implementation checklist. Define what will be built and write
the file manifest. No application code written yet.

## Current State Check
```bash
cat .workflow_state   # must print: PLAN
```

## Allowed Actions
- Define schema changes, API routes, component structure, and acceptance criteria
- Write `.workflow_plan_files` (one planned file path per line — required)
- Write or update `AGENTS.md`, `PROMPTS.md`, `docs/`, `.claude/`, `scripts/`, `*.md`

## Forbidden Actions
The `pre_tool_use` hook blocks these:
- Writing application code to `app/`, `lib/`, `components/`, `types/`, `prisma/`, `__tests__/`
- Running `npm install/add`, `npx prisma migrate`, shell redirects to tracked dirs

## Required Outputs
1. **`.workflow_plan_files`** — every file to be created or modified, one path per line
2. **Schema changes** — any Prisma model additions or modifications
3. **API changes** — method, path, behavior
4. **Component changes** — what UI changes are needed
5. **Acceptance criteria** — one testable criterion per core feature

## Exit Criteria
- [ ] `.workflow_plan_files` exists and lists every file to create or modify
- [ ] Planning prompts logged in `PROMPTS.md`

```bash
bash scripts/advance_state.sh next
```
