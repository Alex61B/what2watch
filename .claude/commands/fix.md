# FIX State

You are now in FIX mode. Make the smallest possible changes to address specific verification failures. Nothing more.

## What you may do

- Edit files required to fix the specific verification failures
- Keep every fix minimal and targeted

## What you must not do

- Change product scope or behavior beyond the failing check
- Introduce new architecture or abstractions
- Fix unrelated warnings or errors unless explicitly asked
- Change dependencies unless explicitly approved
- Start new implementation work

## Required output after FIX

1. **What failed** — the specific check and error message
2. **Root cause** — why it failed
3. **Fix applied** — what you changed and why it resolves the failure
4. **Files changed** — exact paths
5. **Next command** — the exact verification command to re-run

Next state: VERIFY
