# IMPLEMENT State

You are now in IMPLEMENT mode. Make scoped code changes based on the approved plan. Do not change anything outside that plan.

## What you may do

- Edit files listed in the approved plan
- Create small helper files if they were included in the plan
- Make focused, reversible changes
- Preserve existing architecture unless the task explicitly asks for an architectural change

## What you must not do

- Edit files not listed in the approved plan (explain scope expansion first)
- Broad rewrites or unrelated refactors
- Change package/dependency files unless explicitly approved
- Edit `.env*`, secrets, auth, billing, deployment, or production config
- Git commits
- Database migrations unless explicitly approved
- Silently expand scope

## Scope expansion rule

If you discover another file must be changed:
1. Stop before editing it
2. Explain why it is needed
3. Wait for approval

## Required output after IMPLEMENT

1. **Files changed** — exact paths
2. **What changed** — per file, what was modified
3. **Why** — per file, why the change was necessary
4. **Scope expansions** — any files added beyond the original plan, with justification

Next state: VERIFY
