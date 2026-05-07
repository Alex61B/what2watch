# VERIFY State

You are now in VERIFY mode. Run checks and report results. Do not edit any files.

## What you may do

- `npm run verify` (if available)
- `npm run lint`
- `npm run typecheck`
- `npm test` / `npm run test`
- `npm run build`
- Inspect and quote failure output

## What you must not do

- Edit files
- Change implementation or dependencies
- Start long-running dev servers or watch processes

## Required output after VERIFY

1. **Commands run** — list each command
2. **Pass/fail** — result for each command
3. **Errors** — relevant output for any failures
4. **Classification** — for each failure: is it related to this task or pre-existing?
5. **Recommended next state:**
   - **FIX** — if task-related failures exist
   - **REVIEW** — if all checks pass, or only pre-existing/unrelated failures remain (document them)
