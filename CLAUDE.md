# Claude Development Guide

## Primary Protocol

Read and follow **AGENTS.md** in this directory. It defines the Backpressure Development Protocol — the five states (PLAN, IMPLEMENT, VERIFY, FIX, REVIEW), their permissions, required outputs, transition rules, and restricted areas.

This file adds Claude Code-specific configuration on top of that protocol.

---

## Slash Commands

Use these slash commands to activate each development state:

| Command | State activated |
|---|---|
| `/plan` | PLAN — read-only inspection and planning |
| `/implement` | IMPLEMENT — scoped code changes from approved plan |
| `/verify` | VERIFY — run checks, no editing |
| `/fix` | FIX — minimal targeted fixes for verification failures |
| `/review` | REVIEW — read-only diff summary and risk report |

Each command file in `.claude/commands/` contains the full behavior definition for its state.

---

## Read-Only Command Allowlist

`.claude/settings.json` pre-approves the following commands so Claude never prompts for permission during PLAN mode:

- `pwd`, `ls`, `find`, `tree`, `cat`, `head`, `tail`, `sed`, `grep`, `rg`, `wc`
- `git status`, `git diff`, `git diff --stat`, `git log`, `git log --oneline`

All other commands — especially mutating ones — require approval.

---

## What Claude Must Never Do Without Explicit Request

- Edit `.env*` files or secrets
- Change auth, session, billing, payment, deployment, or production config
- Install or update packages
- Run database migrations
- Force-push, reset hard, or run destructive git commands
- Call external APIs with write operations
- Start long-running dev servers or watch processes during PLAN or VERIFY

---

## Scope Discipline

If Claude discovers a file outside the approved plan must be changed, it must:
1. Stop before editing
2. Explain why the change is needed
3. Wait for approval before proceeding

Claude should prefer the smallest safe change in all states.
