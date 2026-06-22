# PLAN — WP7: Operational Recovery & Runbooks (H8 / H7 / M12)

> **State:** PLAN. Branch `feat/wp7-ops-runbooks` off `main` @ `9ec1fcd`.
> **DOCS-ONLY WP** (owner constraint 2026-06-22): create markdown only; **no application source, no
> CI/infra files, no env, no prod config, no migrations, no push/PR** without explicit approval.
> Research record: `docs/research.md`. Full WP7 cycle (RESEARCH→PLAN→IMPLEMENT→TEST) is owner-approved.

---

## Design overview

Five cross-linked markdown runbooks under a new **`docs/runbooks/`** folder, one per requested scope
item, grounded in current Supabase/Vercel docs (cited inline). The index (`README.md`) carries the
system overview, RPO/RTO recommendations, and launch-blocker classification. Any non-doc artifact
(GitHub Action backup workflow, `migrate deploy` build fix, plan upgrade, restore drill) appears **as a
copy-paste template / procedure inside the docs** and is explicitly labelled an **owner action** — WP7
does not create or run it.

Scope → file mapping:

| Requested scope item | Lives in |
|---|---|
| Operations runbook · RPO/RTO recommendations · launch-blocker classification | `docs/runbooks/README.md` |
| Backup/restore runbook · Supabase Free-plan backup-gap mitigation | `docs/runbooks/backup-restore.md` |
| Disaster recovery runbook | `docs/runbooks/disaster-recovery.md` |
| Release/rollback procedure (incl. H7 migrations + M12 expand/contract) | `docs/runbooks/deploy-release-rollback.md` |
| Incident triage checklist | `docs/runbooks/incident-triage.md` |

---

## File manifest (`.workflow_plan_files`)

| # | File | Action | Contents |
|---|------|--------|----------|
| 1 | `docs/runbooks/README.md` | **create** | Operations runbook + index. System map (Vercel push-deploy + `/api/cron/cleanup` 04:00 UTC; Supabase Postgres Free; Prisma migrations via `DIRECT_URL`); environments & key URLs (`/api/health`, `/admin`); ownership/on-call placeholders; **data criticality tiers**; **RPO/RTO recommendations** table; **launch-blocker classification**; links to the other four runbooks; "last reviewed" + open owner-decisions list. |
| 2 | `docs/runbooks/backup-restore.md` | **create** | **Free-plan gap statement.** Manual logical backup (`supabase db dump` and raw `pg_dump` against `DIRECT_URL`/5432, not the 6543 pooler); what's included/excluded; **dump = sensitive PII** handling (encrypt, off-site, retention). **Automation template:** a daily **GitHub Actions** workflow (shown as YAML in-doc; creating it + the DB secret = owner action). **Restore** into a *scratch* project step-by-step + verification queries. **Upgrade path:** Supabase Pro daily backups + PITR (cost/when). Citations. |
| 3 | `docs/runbooks/disaster-recovery.md` | **create** | Scenario playbooks with RPO/RTO + steps: (a) total DB loss / project deletion, (b) accidental data deletion/bad migration, (c) Supabase outage or Free-project pause, (d) Vercel outage, (e) leaked secret → rotation (`DIRECT_URL`/`DATABASE_URL`/`AUTH_SECRET`/`GOOGLE_*`/`TMDB_API_KEY`). **Mandatory restore-drill** procedure + "last tested" log. |
| 4 | `docs/runbooks/deploy-release-rollback.md` | **create** | Normal release flow; **how migrations are applied** (`./node_modules/.bin/prisma migrate deploy` via `DIRECT_URL`; never bare `npx prisma`; `migrate status` drift check) — **H7**; **expand/contract** ordering so a code rollback never needs a schema rollback — **M12**; **Vercel Instant Rollback** (dashboard + `vercel rollback`/`vercel promote`; Hobby = previous-only); recommended H7 build-command fix as an owner follow-up. Citations. |
| 5 | `docs/runbooks/incident-triage.md` | **create** | Severity matrix (SEV1–3 with examples); first-15-minutes checklist; where to look (Vercel runtime logs incl. `[csp-report]`, Supabase logs/advisors, `/api/health`, `/admin`); decision tree → which runbook; escalation + comms template; post-incident note. |

No application source, schema, API, component, dependency, or migration changes. (Plan/PROMPTS/handoff
docs are workflow records, not in the manifest, per repo convention.)

---

## Schema changes
**None.** Docs-only.

## API changes
**None.** Docs-only.

## Component changes
**None.** Docs-only.

---

## Acceptance criteria (one testable criterion per deliverable)

1. **`README.md`** exists and contains: the system map, a data-tier table, an **RPO/RTO table**, and an
   explicit **launch-blocker classification** (backup+tested-restore = blocker), with working relative
   links to the other four runbooks.
2. **`backup-restore.md`** documents a runnable manual backup command set (direct-connection caveat),
   the off-site/encryption handling, a GitHub Actions automation template, a restore-into-scratch
   procedure with verification, and the Pro/PITR upgrade path — with Supabase doc citations.
3. **`disaster-recovery.md`** contains ≥5 scenario playbooks each with steps + RPO/RTO, plus the
   mandatory restore-drill procedure and a "last tested" log line.
4. **`deploy-release-rollback.md`** documents the Prisma `migrate deploy`/`DIRECT_URL` flow (H7),
   expand/contract ordering (M12), and Vercel Instant Rollback (`vercel rollback`/`promote`, Hobby
   limit) — with Vercel doc citations.
5. **`incident-triage.md`** contains a severity matrix, a first-response checklist, the log/health
   locations, and an escalation/comms section.
6. **Whole WP is docs-only:** `git status` shows changes confined to `docs/` (+ workflow records);
   `scripts/verify.sh` stays green (no code touched).

**Owner acceptance (non-automatable, documented in the DR runbook):** perform one **restore drill** into
a scratch project and record the date — the true verification of the backup/restore runbook.

---

## Verification (TEST phase)
- `bash scripts/verify.sh` → typecheck + lint + jest must stay green (unchanged — no code touched);
  this is a regression guard, not a docs test.
- Doc sanity: every runbook exists, internal relative links resolve, and external citations are
  present. (No markdown linter is configured in-repo; checks are manual + `git`/`ls`/`rg`.)

---

## Out of scope (per research §6)
Application code; CI/infra files (`.github/workflows/*`), Vercel build-command/env changes, secret
creation, Supabase plan upgrade, and **running** any backup/restore/migration (all owner actions,
templated in-doc only); the RLS-disabled advisory ([[project-supabase-security-posture]]); WP3/WP5/WP8/
M4/CSP-enforce.
