# AGENTS.md — Backpressure Agentic Workflow

This file is the **source of truth** for the agentic workflow. All agents, hooks, and scripts defer to rules defined here.

---

## Project Context

**What2Watch** is a Next.js 15 / TypeScript / Prisma / PostgreSQL application for collaborative movie-watching decisions. Users create rooms, vote on movies, and the app finds matches.

**Tech stack:** Next.js App Router, TypeScript, Prisma ORM, PostgreSQL, NextAuth 5, TailwindCSS, Jest, ESLint.

**Tracked application directories:** `app/`, `lib/`, `components/`, `types/`, `prisma/`, `__tests__/`

**Root application files:** `auth.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `jest.config.ts`, `jest.setup.ts`, `eslint.config.mjs`, `postcss.config.js`, `prisma.config.ts`

**Verification commands:** `npm run typecheck` → `npm run lint` → `npm test`

---

## Official Workflow

The four required states, in order:

```
RESEARCH → PLAN → IMPLEMENT → TEST
```

An agent **cannot advance** to the next state until the current state satisfies its deterministic exit criteria (backpressure).

**Backpressure definition:** Each state has explicit exit criteria that must be verifiably met before the agent transitions forward. If a gate fails, the agent narrows its behavior to the failing requirement only, and remains in a constrained remediation loop until the gate passes.

---

## State Machine

| From | To | Trigger |
|------|----|---------|
| RESEARCH | PLAN | Exit criteria met → `bash scripts/advance_state.sh next` |
| PLAN | IMPLEMENT | Exit criteria met → `bash scripts/advance_state.sh next` |
| IMPLEMENT | TEST | Exit criteria met → `bash scripts/advance_state.sh next` |
| TEST | RESEARCH | Verification failure → `bash scripts/advance_state.sh fail` |
| TEST | (done) | All checks pass → `bash scripts/advance_state.sh next` |

State is persisted in `.workflow_state`. Failure count is persisted in `.workflow_failures`.

---

## State Gates

### State 1: RESEARCH

**Purpose:** Understand requirements, assess risks, justify technical approach.

**Forbidden actions (enforced by pre_tool_use.sh):**
- Writing any files under `app/`, `lib/`, `components/`, `types/`, `prisma/`, `__tests__/`
- Running `npm install/add/remove`, `npx prisma migrate`, `npx prisma db push`

**Exit criteria:**
- [ ] `docs/research.md` exists with all 7 required sections

```bash
bash scripts/advance_state.sh next
```

---

### State 2: PLAN

**Purpose:** Produce a concrete implementation checklist. No application code written.

**Forbidden actions (enforced by pre_tool_use.sh):**
- Writing application code to tracked directories
- Running database migrations or package installs

**Exit criteria:**
- [ ] `.workflow_plan_files` exists and lists every file to create or modify (one path per line)

```bash
bash scripts/advance_state.sh next
```

---

### State 3: IMPLEMENT

**Purpose:** Build exactly what was planned. No scope creep.

**Forbidden actions (enforced by pre_tool_use.sh + post_tool_use.sh):**
- Writing to files **not** listed in `.workflow_plan_files`
- Adding unplanned features or dependencies

**Exit criteria:**
- [ ] Every file in `.workflow_plan_files` exists and is implemented
- [ ] No unplanned new files (drift-free)

```bash
bash scripts/advance_state.sh next
```

---

### State 4: TEST

**Purpose:** Run deterministic verification and confirm all requirements are met.

**Forbidden actions:**
- Adding new features while any check is failing
- Changing assertions to force a pass

**Exit criteria:**
- [ ] `bash scripts/verify.sh` exits 0 (runs typecheck + lint + jest)

```bash
bash scripts/advance_state.sh next
```

---

## Failure Behavior

If any TEST exit criterion fails:

1. Run `bash scripts/advance_state.sh fail` — returns state to RESEARCH, increments `.workflow_failures`.
2. Enter a **constrained remediation loop** scoped **only** to the failing check.
3. If the same failure repeats **3 times**, `advance_state.sh` exits with a blocker message.
4. Stop all code changes and provide a written blocker summary.

---

## Restricted Areas (never edit without explicit request)

- `.env*` and all environment variable files
- Auth/session logic (`auth.ts`, `app/api/auth/`)
- Database migrations (`prisma/migrations/`)
- `package.json`, `package-lock.json`
- Production/deployment configuration

---

## Hook and Script Reference

| File | Responsibility |
|------|---------------|
| `.claude/hooks/pre_tool_use.sh` | Blocks forbidden tool calls based on `.workflow_state` |
| `.claude/hooks/post_tool_use.sh` | Records tool activity; triggers drift detection in IMPLEMENT |
| `.claude/hooks/stop.sh` | Reminds agent to update `PROMPTS.md` |
| `scripts/advance_state.sh` | Enforces valid state transitions with exit gates |
| `scripts/verify.sh` | Runs typecheck + lint + jest; writes `.workflow_verified` on success |
| `scripts/check_drift.sh` | Scans for new unplanned files in tracked directories (git-based) |
