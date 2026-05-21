# Claude Development Guide

## Primary Protocol

Read and follow **AGENTS.md** in this directory. It defines the Backpressure Development Protocol — the four states (RESEARCH, PLAN, IMPLEMENT, TEST), their permissions, required outputs, transition rules, and restricted areas.

This file adds Claude Code-specific configuration on top of that protocol.

---

## Slash Commands

Use these slash commands to activate each development state:

| Command | State activated |
|---|---|
| `/research` | RESEARCH — read-only inspection and requirements gathering |
| `/plan` | PLAN — define .workflow_plan_files, no application code |
| `/implement` | IMPLEMENT — scoped code changes from approved plan |
| `/test` | TEST — run verify.sh, remediation loop if failing |

Each command file in `.claude/commands/` contains the full behavior definition for its state.

---

## Workflow State

Current state is always in `.workflow_state`. Check it at any time:

```bash
cat .workflow_state      # RESEARCH | PLAN | IMPLEMENT | TEST
cat .workflow_failures   # remediation loop count (0–3)
```

Advance state:
```bash
bash scripts/advance_state.sh next    # forward transition (enforces exit gate)
bash scripts/advance_state.sh fail    # TEST failure → RESEARCH (increments counter)
```

---

## Read-Only Command Allowlist

`.claude/settings.json` pre-approves the following commands so Claude never prompts for permission:

- `pwd`, `ls`, `find`, `tree`, `cat`, `head`, `tail`, `sed`, `grep`, `rg`, `wc`
- `git status`, `git diff`, `git diff --stat`, `git log`, `git log --oneline`
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- `bash scripts/*` (workflow advancement and verification)

All other commands — especially mutating ones — require approval.

---

## What Claude Must Never Do Without Explicit Request

- Edit `.env*` files or secrets
- Change auth, session, billing, payment, deployment, or production config
- Install or update packages (`npm install`, `npm add`)
- Run database migrations (`npx prisma migrate`, `npx prisma db push`)
- Force-push, reset hard, or run destructive git commands
- Call external APIs with write operations
- Start long-running dev servers or watch processes during RESEARCH or PLAN

---

## Scope Discipline

If Claude discovers a file outside the approved plan must be changed, it must:
1. Stop before editing
2. Explain why the change is needed
3. Wait for approval before proceeding

Claude should prefer the smallest safe change in all states.
