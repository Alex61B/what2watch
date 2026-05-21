# /implement — IMPLEMENT State Command

You are now in the **IMPLEMENT** workflow state. Read `AGENTS.md` for the authoritative rules.

## Purpose
Build the application exactly as planned. Every file you create or modify must appear
in `.workflow_plan_files`. No scope creep, no unplanned refactors, no new features.

## Current State Check
```bash
cat .workflow_state        # must print: IMPLEMENT
cat .workflow_plan_files   # review the planned file list
```

## Allowed Actions
- Create or edit any file listed in `.workflow_plan_files`
- Run read-only commands (grep, git, ls, cat)

## Forbidden Actions
The `pre_tool_use` hook blocks `Write`/`Edit` to unplanned application files.
The `post_tool_use` hook detects and flags any new unplanned files after each Bash call.

## Scope Expansion Rule
If you discover another file must be changed:
1. Stop before editing it
2. Explain why it is needed
3. Add it to `.workflow_plan_files` and wait for approval

## Exit Criteria
- [ ] Every file in `.workflow_plan_files` exists and is implemented
- [ ] No unimplemented stubs remain
- [ ] No unplanned new files (drift-free)

```bash
bash scripts/advance_state.sh next
```
