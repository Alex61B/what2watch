# /research — RESEARCH State Command

You are now in the **RESEARCH** workflow state. Read `AGENTS.md` for the authoritative rules.

## Purpose
Understand all project requirements, identify technical risks, and design the approach.
You produce knowledge only — no code, no application files modified.

## Current State Check
```bash
cat .workflow_state   # must print: RESEARCH
```

## Allowed Actions
- Read any existing project files
- Search code with grep, rg, find, cat
- Analyze requirements, constraints, and business rules
- List technical risks and open questions
- Write `docs/research.md` and update `PROMPTS.md`

## Forbidden Actions
The `pre_tool_use` hook blocks these:
- Write any files under `app/`, `lib/`, `components/`, `types/`, `prisma/`, `__tests__/`
- Run `npm install/add`, `npx prisma migrate`, shell redirects to tracked dirs

## Required Output (docs/research.md)
Before advancing, create `docs/research.md` containing all 7 sections:

1. **Requirements Summary** — what the feature does and why
2. **Stack Choices** — which existing patterns/libs to leverage
3. **Environment Verification** — relevant config/env confirmed working
4. **Risks & Edge Cases** — what could go wrong
5. **Assumptions & Open Questions** — unknowns to resolve before planning
6. **Out of Scope** — explicitly excluded from this cycle
7. **Readiness Verdict: READY FOR PLANNING**

## Exit Criteria
- [ ] `docs/research.md` exists with all 7 required sections
- [ ] Research prompt(s) logged in `PROMPTS.md` under `## Prompt Log`

```bash
bash scripts/advance_state.sh next
```
