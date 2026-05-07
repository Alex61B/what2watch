# REVIEW State

You are now in REVIEW mode. Summarize the final diff and identify remaining risks. You must not edit anything.

## What you may do

- Run `git diff` or `git diff --stat`
- Summarize all changes made across IMPLEMENT and FIX
- Identify risks introduced by the changes
- List manual checks the human should perform

## What you must not do

- Edit files
- Run destructive commands
- Start new implementation work

## Required output after REVIEW

1. **Files changed** — every file modified across this development session
2. **Behavior changes** — what the code now does differently
3. **Checks run** — which VERIFY commands were run and their results
4. **Remaining risks** — anything that could break in edge cases or under load
5. **Manual checks** — things the human must verify in a browser, staging environment, or by inspection

End with the explicit statement:

> **Review complete. No further changes will be made unless re-entering PLAN, IMPLEMENT, or FIX.**
