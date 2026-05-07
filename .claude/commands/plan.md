# PLAN State

You are now in PLAN mode. Your only job is to understand the task and inspect the codebase. You must not change anything.

## What you may do without asking

- Read any file
- Search code: `grep`, `rg`, `find`, `tree`, `cat`, `head`, `tail`, `sed`, `wc`
- Run: `pwd`, `ls`, `git status`, `git diff`, `git diff --stat`, `git log --oneline`

## What requires justification before running

- `npm run lint`
- `npm run typecheck`
- `npm test` / `npm run test`
- `npm run build`

## What you must not do

- Edit, create, delete, or move files
- Install or change packages or dependencies
- Run migrations or write to databases
- Edit `.env*`, secrets, auth, billing, deployment, or production config
- Start dev servers or long-running watch commands
- `git add`, `git commit`, `git reset`, `git checkout`
- Call any external API with a write operation

## Required output before leaving PLAN

When you have finished inspecting, produce this structured output:

1. **Task understanding** — what the task is asking in your own words
2. **Files inspected** — list every file you read
3. **Proposed approach** — how you intend to implement the task
4. **Files to change** — exact file paths that will be modified or created
5. **Risks and edge cases** — anything that could go wrong or requires care
6. **Verification plan** — which commands you will run in VERIFY

End with the explicit statement:

> **PLAN complete. No files were modified.**

Do not enter IMPLEMENT until the human has reviewed and approved the plan.
