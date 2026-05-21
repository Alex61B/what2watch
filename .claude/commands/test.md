# /test — TEST State Command

You are now in the **TEST** workflow state. Read `AGENTS.md` for the authoritative rules.

## Purpose
Run deterministic verification checks and confirm all requirements are met.

## Current State Check
```bash
cat .workflow_state      # must print: TEST
cat .workflow_failures   # current remediation attempt count (0–2)
```

## Verification
```bash
bash scripts/verify.sh
```

This runs in order:
1. `npm run typecheck` — TypeScript type checking
2. `npm run lint` — ESLint
3. `npm test -- --passWithNoTests` — Jest

On full success, writes `.workflow_verified` (required for the exit gate).

## On Failure: Constrained Remediation Loop

1. Identify the exact failing check (file, line, error message)
2. `bash scripts/advance_state.sh fail` — returns to RESEARCH, increments `.workflow_failures`
3. Scope is restricted: address **only** the failing check
4. Mini-loop: RESEARCH → PLAN → IMPLEMENT → TEST
5. At 3 failures: stop and write a blocker summary before retrying

## Exit Criteria
- [ ] `bash scripts/verify.sh` exits 0
- [ ] `.workflow_verified` exists

```bash
bash scripts/advance_state.sh next
```
