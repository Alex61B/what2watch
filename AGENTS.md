# Backpressure Development Protocol

This file defines the AI-assisted development workflow for this repository. All AI agents (Claude, Gemini, GitHub Copilot, etc.) operating in this repo must follow these rules.

## Core Concept

"Backpressure" means each development state constrains what an agent is allowed to do until the right context exists. The five states are: PLAN → IMPLEMENT → VERIFY → FIX → REVIEW. Agents gather context, plan, implement, verify, fix, and review in separate modes instead of freely mixing all actions.

---

## State 1: PLAN

**Purpose:** Understand the task and inspect the codebase. Nothing changes.

### Allowed without asking
- Read any file
- Search code with grep, rg, find, tree, cat, head, tail, sed, wc
- Run: `pwd`, `ls`, `git status`, `git diff`, `git diff --stat`, `git log --oneline`

### Allowed only with justification
- `npm run lint`
- `npm run typecheck`
- `npm test` / `npm run test`
- `npm run build`

### Disallowed
- Editing, creating, deleting, or moving files
- Installing or changing packages/dependencies
- Running migrations or writing to databases
- Editing `.env*`, secrets, auth, billing, deployment, or production config
- Starting dev servers or long-running watch commands
- `git add`, `git commit`, `git reset`, `git checkout`
- Any external API write call

### Required PLAN output
1. Current understanding of the task
2. Relevant files inspected
3. Proposed implementation approach
4. Exact files expected to change
5. Risks and edge cases
6. Verification plan
7. Explicit statement: **"PLAN complete. No files were modified."**

---

## State 2: IMPLEMENT

**Purpose:** Make scoped code changes based on an approved plan.

### Allowed
- Edit only files named in the approved plan
- Create small helper files only if included in the plan
- Make focused, reversible changes
- Preserve existing architecture unless the task explicitly requests an architectural change

### Disallowed
- Broad rewrites
- Unrelated refactors
- Dependency changes unless explicitly approved
- Editing `.env*`, secrets, auth, billing, deployment, or production config
- Git commits
- Database migrations unless explicitly approved
- Silently expanding scope

### Required IMPLEMENT output
1. Files changed
2. What changed in each file
3. Why each change was necessary
4. Any scope expansion and why it was needed

---

## State 3: VERIFY

**Purpose:** Run checks and report results. No code edits.

### Allowed
- `npm run verify` (if available)
- `npm run lint`
- `npm run typecheck`
- `npm test` / `npm run test`
- `npm run build`
- Inspect failure output

### Disallowed
- Editing files
- Changing implementation or dependencies
- Starting long-running dev servers

### Required VERIFY output
1. Commands run
2. Pass/fail status per command
3. Relevant error output
4. Whether errors are task-related or pre-existing
5. Recommended next state:
   - **FIX** if task-related failures exist
   - **REVIEW** if checks pass or only unrelated failures remain

---

## State 4: FIX

**Purpose:** Make minimal targeted changes to address verification failures only.

### Allowed
- Edit only files needed to fix the specific verification failures
- Keep fixes minimal and focused
- Return to VERIFY afterward

### Disallowed
- Changing product scope
- Introducing new architecture
- Fixing unrelated warnings/errors unless explicitly asked
- Dependency changes unless explicitly approved

### Required FIX output
1. What failed
2. Root cause
3. Minimal fix applied
4. Files changed
5. Next verification command to run

---

## State 5: REVIEW

**Purpose:** Summarize the final diff and remaining risks. Read-only.

### Allowed
- Inspect `git diff`
- Summarize changes
- Identify risks
- List manual checks the human should do

### Disallowed
- Editing files
- Running destructive commands
- Starting new implementation work

### Required REVIEW output
1. Files changed
2. Behavior changes introduced
3. Tests and checks run (with results)
4. Remaining risks
5. Manual checks for the human to perform
6. Explicit statement: **"Review complete. No further changes will be made unless re-entering PLAN, IMPLEMENT, or FIX."**

---

## State Transition Rules

```
PLAN → IMPLEMENT       Only after an explicit approved plan exists
IMPLEMENT → VERIFY     After changes are made
VERIFY → FIX           Only if relevant checks fail
FIX → VERIFY           After fixes are applied
VERIFY → REVIEW        Once checks pass or remaining failures are unrelated/documented
REVIEW → (any state)   Only if the human explicitly requests re-entry
```

---

## Scoped Permission Rules

1. Agents may only edit files listed in the current approved plan.
2. If another file must be edited, the agent must explain the scope expansion **before** editing.
3. Prefer the smallest safe change.
4. Avoid broad rewrites.
5. Do not change package/dependency files unless explicitly approved.
6. Do not modify secrets, `.env*`, auth config, billing config, deployment config, or production config unless explicitly requested.
7. Preserve existing architecture unless the task explicitly asks for an architectural change.

---

## Restricted Areas

Agents may **inspect** these areas when needed, but must **not edit** them unless explicitly requested:

- `.env*` and all environment variable files
- Secrets and credential files
- Auth and session logic
- Billing and payment logic
- Deployment configuration
- Database migrations
- Package and dependency files (`package.json`, `package-lock.json`, `yarn.lock`, `requirements.txt`, `pyproject.toml`, etc.)
- Generated files (build output, compiled assets)
- Production configuration

---

## Command Approval Policy

- **Do not ask** before running read-only inspection commands.
- **Ask before** commands that are mutating, expensive, long-running, or outside task scope.
- **If unsure** whether a command mutates state, ask first.

---

## Example Workflow

**Task:** "Add Active category to what2watch"

1. **PLAN** — Inspect the category enum, option templates, UI filter components, and API routes. Identify the exact files to change. Produce a plan. State "PLAN complete. No files were modified."
2. **IMPLEMENT** — Edit only the files named in the approved plan. Add the Active category to the enum, template, filter component, and route handler.
3. **VERIFY** — Run `npm run lint`, `npm run typecheck`, `npm test`. Report pass/fail.
4. **FIX** — If a type error appears on the new enum value, fix only that. Return to VERIFY.
5. **REVIEW** — Summarize the diff, list manual checks (e.g., "verify filter renders in browser"), state "Review complete."
