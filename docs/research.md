# RESEARCH — WP7: Operational Recovery & Runbooks (PikFlix / What2Watch)

> **State:** RESEARCH (read-only). **Docs-only WP** — no application source code is touched in any
> state of this cycle (owner constraint 2026-06-22). Supersedes the prior WP6 research content; WP6's
> durable record is `docs/plan-wp6-privacy-legal.md` + `docs/session-handoff-2026-06-22.md`.
> **Audit findings in scope:** **H8** (no backup/restore/DR runbook; restore untested — the top
> operational risk), **H7** (prod migrations applied manually / undocumented; no `migrate deploy` in
> the build), **M12** (no rollback runbook / expand-contract discipline).
> **Source:** 2026-06-21 production-readiness audit + `session-handoff-2026-06-22.md` §5 ("top
> operational risk: Supabase Free = no managed backups").

---

## 1. Requirements Summary

**What WP7 delivers and why.** The application has **no operational recovery documentation and no
backups**. If the Postgres database is lost, corrupted, or a row is deleted by mistake, there is
currently **no way to recover** — the production data store (Supabase, **Free plan**) has no managed
daily backups and no point-in-time recovery, and no manual export process exists. This is the single
largest remaining production risk after the WP1/WP6 security & privacy work.

WP7 is a **documentation-only** work package that produces the operational runbooks the project needs
before a real-user launch. Deliverables (one markdown file each, under `docs/runbooks/`):

1. **Backup/restore runbook** — how to take and verify logical backups, and how to restore. Includes
   the **Supabase Free-plan backup-gap mitigation** (scheduled `supabase db dump` / `pg_dump` to
   off-site encrypted storage; GitHub Actions automation template) and the upgrade path (Supabase Pro
   managed daily backups + optional PITR).
2. **Disaster-recovery (DR) runbook** — scenario playbooks: total DB loss, accidental data deletion,
   Supabase outage, Vercel outage, leaked secret/credential rotation, with step-by-step recovery and
   RPO/RTO targets per scenario.
3. **Operations runbook (index)** — system overview (Vercel + Supabase + cron), environments,
   ownership/on-call basics, the **RPO/RTO recommendations**, the **launch-blocker classification**,
   and links to the other runbooks.
4. **Release / rollback procedure** — the deploy flow, **how migrations are actually applied** (Prisma
   `migrate deploy` via `DIRECT_URL` — H7), **expand/contract discipline**, Vercel **Instant Rollback**,
   and the DB-rollback caveats (M12).
5. **Incident triage checklist** — severity levels, the first-15-minutes checklist, where to look
   (Vercel runtime logs, Supabase logs, `/api/health`), escalation and comms.

**Why now / why these:** WP7 is owner-operated infrastructure documentation — it closes the recovery
gap without any code change, and it is the one remaining work package the handoff flags as the *top*
operational risk. The runbooks also make every later change safer (a tested restore + a rollback
procedure de-risk WP3/WP5/WP8).

---

## 2. Stack Choices (mechanisms to leverage, with current vendor docs)

- **Logical backups — Supabase CLI `supabase db dump` (preferred) or `pg_dump`.** `supabase db dump`
  runs `pg_dump` in a container, excludes Supabase-managed schemas (`auth`/`storage`/extensions),
  strips reserved roles, and adds idempotent `IF NOT EXISTS` clauses; `--data-only` / `--role-only`
  control contents; needs `supabase link` (or `--db-url`) and Docker. Raw `pg_dump` against
  `DIRECT_URL` also works and needs no Docker (simplest for a GitHub Action). For **Free-tier
  projects, Supabase explicitly recommends regular `db dump` exports kept off-site.** Sources:
  [Backup & Restore via CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
  [`supabase db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump),
  [Database Backups](https://supabase.com/docs/guides/platform/backups).
- **Backup automation — GitHub Actions.** Supabase documents a CI backup workflow; this is the right
  home for automation here (a scheduled GH Action running `pg_dump`/`supabase db dump` → encrypted
  off-site store) because **Vercel cron cannot run `pg_dump`** (serverless runtime, no Postgres client
  binary, execution-time limits). Source:
  [Automated backups using GitHub Actions](https://supabase.com/docs/guides/deployment/ci/backups).
  *(WP7 documents and templates this workflow; actually committing `.github/workflows/*` + setting the
  DB secret is an owner action, out of this docs-only WP — see §5/§6.)*
- **Managed backups / PITR (upgrade path) — Supabase Pro.** Daily backups are included on Pro/Team/
  Enterprise; **PITR is a paid add-on (~$100/mo per 7-day retention, up to 28 days)**; Free has
  neither. Sources:
  [Database Backups](https://supabase.com/docs/guides/platform/backups),
  [PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery),
  [Pricing](https://supabase.com/pricing).
- **Restore** — `psql`/`supabase db` restore of a dump into a **scratch project first** (never prod),
  per the CLI backup-restore guide above + [Restoring a downloaded backup](https://supabase.com/docs/guides/local-development/restoring-downloaded-backup).
- **Release rollback — Vercel Instant Rollback.** Revert prod to a previous deployment via the
  dashboard (⋮ → Instant Rollback) or `vercel rollback <url|id>`; **Hobby plan can roll back to the
  *previous* deployment only** (Pro/Enterprise: any eligible one). After a rollback Vercel disables
  prod-domain auto-assignment until you `vercel promote`. Sources:
  [Instant Rollback](https://vercel.com/docs/instant-rollback),
  [Rolling back production](https://vercel.com/docs/deployments/rollback-production-deployment),
  [`vercel rollback`](https://vercel.com/docs/cli/rollback),
  [Promoting deployments](https://vercel.com/docs/deployments/promoting-a-deployment).
- **DB migrations — Prisma, not Supabase CLI.** Confirmed live: the schema is tracked in
  `_prisma_migrations` (Supabase's own `list_migrations` is empty). Apply with
  `./node_modules/.bin/prisma migrate deploy` against `DIRECT_URL` (never bare `npx prisma` → pulls v7,
  breaks this v6 project, see [[reference-prisma-migrate-local-cli]]). Code rollback is easy (Vercel);
  **DB rollback is the hard part** — Prisma has no auto down-migrations, so the runbook prescribes
  **expand/contract** (additive-then-cleanup) so a code rollback never needs a schema rollback.
- **Doc format/structure:** plain markdown under a new `docs/runbooks/` folder, cross-linked from a
  `README.md` index. No new dependency, no tooling.

---

## 3. Environment Verification (confirmed against the live system)

- **Hosting = Vercel; one cron.** `vercel.json` defines a single cron `GET /api/cron/cleanup` at
  `0 4 * * *` (04:00 UTC daily). Deploys are git-push driven (no `vercel.json` build override).
- **Build does NOT run migrations.** `package.json` build = `prisma generate && next build` — **no
  `prisma migrate deploy`** ⇒ migrations are applied **out-of-band, manually** (confirms **H7**).
- **DB = Supabase Postgres, dual-URL.** `schema.prisma` datasource: `url = DATABASE_URL` (pooled,
  runtime; capped to 1 conn/instance per `lib/prisma.ts`), `directUrl = DIRECT_URL` (direct;
  migrations). `prisma.config.ts` builds the migration adapter from `DIRECT_URL ?? DATABASE_URL` and
  loads `.env.local` then `.env`. (Pooled vs direct matters for restore — see §4.)
- **Live DB state (read-only MCP check, 2026-06-22):**
  - **11/11 Prisma migrations applied, none rolled back — no drift** (`init` 2026-05-26 … `add_ratelimit`
    2026-06-20). Production schema matches the repo.
  - 15 public tables. Approx row counts: `User` 6, `Account` 2, `Friendship` 5, `UserMoviePreference`
    33, `MovieCache` 26, `Event` 239, `Room`/`Member` ~1, `RateLimit` 5 (counts are `reltuples`
    estimates). **Small, early-stage dataset** → fast dumps/restores; favors cheap logical backups now.
- **Backup posture = NONE (the gap).** Supabase **Free** plan ⇒ no managed daily backups, no PITR
  (verified vs current docs, §2). No manual export process exists. **Effective RPO = ∞ / RTO = ∞ for a
  destructive event today.**
- **Rollback posture:** Vercel Instant Rollback is available (code). No DB rollback story exists.
- **Recovery aids that already exist:** `prisma/migrations` (schema rebuild), `prisma/seed.ts` (seed
  data), `GET /api/health` (liveness), `/admin` overview, first-party event log. **MovieCache and
  Event are regenerable/expendable** (TMDB re-fetch; 90-day pruned analytics).
- **Data criticality tiers (drives RPO/RTO):**
  - **Tier 1 — irreplaceable:** `User`, `Account` (OAuth links + `passwordHash`), `Friendship`,
    `UserMoviePreference`, `WatchedMovie`, `User.savedServices/savedFilters`. Loss = real user harm.
  - **Tier 2 — transient:** `Room`, `Member`, `Vote`, `RoomQueue`, `MemberQueue` (rooms auto-expire
    ≤48h; in-flight loss is annoying, self-heals).
  - **Tier 3 — regenerable/ephemeral:** `MovieCache` (TMDB), `Event` (90-day analytics), `RateLimit`,
    `VerificationToken`.

---

## 4. Risks & Edge Cases (these shape the runbook content)

- **Unrecoverable data loss (the core risk).** With no backups, accidental `DELETE`/`DROP`, a bad
  migration, or a Supabase project deletion is **permanent**. The backup runbook + a *tested* restore
  is the mitigation; until a backup exists, this stays the top risk.
- **A backup you've never restored isn't a backup.** The DR runbook must mandate a **restore test into
  a scratch project** (never prod) with a recorded "last tested" date; untested restores routinely fail
  on roles/extensions/ownership.
- **Dump connection target.** Take dumps against the **direct** connection (`DIRECT_URL` / port 5432),
  not the transaction-mode pooler (6543) — pooled connections break `pg_dump`. Document explicitly.
- **`supabase db dump` excludes managed schemas by design** — restoring into a *new* Supabase project
  re-creates `auth`/`storage` separately; document that a full DR restore may need the managed-schema
  handling from the Supabase restore guide, not just the public-schema dump.
- **Secrets needed for backup/restore.** Dumps require `DIRECT_URL` (a DB credential). The runbook must
  say: store it as a CI/secret manager entry, never in the repo; treat dump artifacts as **sensitive
  PII** (emails, `passwordHash`) → encrypt at rest + access-controlled off-site store + retention/erase
  policy (consistent with the WP6 privacy posture).
- **Migration/rollback hazards (M12).** A destructive (contract) migration deployed *before* the code
  that stops using the old column makes a Vercel code-rollback insufficient (the column is already
  gone). Expand/contract ordering in the release runbook prevents this. Note Prisma has no built-in
  down-migration.
- **Vercel Hobby rollback limit.** Only the *immediately previous* deployment is one-click reversible
  on Hobby; the runbook should note keeping known-good deployment IDs and the `vercel promote` undo.
- **Free-tier project pausing.** Supabase pauses inactive Free projects — a relevant availability note
  for the ops runbook (and another reason to schedule regular dumps / consider Pro).
- **Out-of-band migrations drift risk (H7).** Because the build doesn't run `migrate deploy`, a deploy
  whose code expects a not-yet-applied migration will 500. The release runbook must order
  "apply migration → then deploy code" (expand) and document the drift check
  (`prisma migrate status` against `DIRECT_URL`).
- **Docs-only verification limit.** A pure-docs WP has no meaningful automated test; `scripts/verify.sh`
  will pass unchanged. The real "test" of these runbooks is the owner executing a **restore drill** —
  called out as an explicit owner acceptance step, not an automated check.

---

## 5. Assumptions & Open Questions

**Recommendations are baked into the docs (the task asked for recommendations, not gated questions).**
The following are documented as **owner decisions with a recommended default**, not blockers:

- **Backup strategy (recommended): two-phase.** *Now (Free, zero cost):* a **daily GitHub Action**
  running `pg_dump`/`supabase db dump` against `DIRECT_URL` → an **encrypted off-site store**, + a
  documented one-off manual procedure. *At/Before real-user launch:* **upgrade to Supabase Pro** (~$25/mo)
  for managed daily backups, and add **PITR** if/when data value justifies the ~$100/mo. The runbook
  presents both; owner picks the off-site destination + when to upgrade.
- **RPO/RTO (recommended targets).** *Pre-launch / now:* **RPO ≤ 24 h** (daily dump), **RTO ≤ 4 h**
  (manual restore into a fresh project). *At launch (Pro):* **RPO ≤ 24 h** (daily) or **≤ ~2 min**
  (PITR add-on) for Tier-1 data; **RTO ≤ 1–2 h**. Tier-2/3 data carries no recovery objective (self-heals
  / regenerable).
- **Launch-blocker classification (recommended).**
  - **LAUNCH BLOCKER (must exist before real-user launch):** a working **backup** + a **tested restore**
    (H8). Without it, any data-loss event is terminal.
  - **STRONGLY RECOMMENDED pre-launch (not a hard blocker):** the release/rollback procedure (M12) and
    the deploy-migration runbook (H7) — the app already deploys & rolls back via Vercel; these reduce
    incident blast radius.
  - **NICE TO HAVE at launch:** incident-triage checklist + DR scenario depth (valuable, but can mature
    post-launch).
- **Owner inputs the runbooks will leave as named placeholders** (not drafting blockers): the off-site
  backup destination + encryption key custody; on-call contact/escalation; the Supabase project ref;
  the production domain (overlaps WP5/WP6).

**Genuinely open (will be surfaced, not silently assumed):** whether the owner wants WP7 to *also*
deliver the GitHub Action backup workflow and the `migrate deploy` build-command fix **as files** — both
are **non-doc config/code** and therefore **out of this docs-only WP**; the runbooks include them as
ready-to-apply templates and flag them as the recommended immediate follow-up (owner to apply, or a
separate small WP with explicit approval).

---

## 6. Out of Scope

- **Any application source-code change.** Docs only (owner constraint). No `package.json` build-command
  edit, no `app/`/`lib/` change.
- **Creating/enabling CI or infra files** — `.github/workflows/db-backup.yml`, Vercel build-command
  changes, secret creation, plan upgrades, and **running an actual backup/restore/migration** are
  **owner actions**, documented as templates/procedures but not executed here. (Stop-and-ask gates.)
- **The RLS-disabled advisory** surfaced by the Supabase MCP (15 tables). It is the **known latent**
  finding (no anon-key path; all DB access is server-side Prisma via direct credentials) tracked in
  [[project-supabase-security-posture]] — **not** a WP7 (recovery) concern; flagged, not addressed.
- **WP3 (Sentry/observability), WP5 (env fail-fast), WP8 (`next` 16), M4 (TMDB split), WP2 enforce-CSP**
  — separate cycles.
- **Fixing H7 in code** (adding `migrate deploy` to the build) — documented as a recommendation; the
  *fix* is a future code WP.

---

## 7. Readiness Verdict: READY FOR PLANNING

The operational surface is fully mapped: **Vercel (push-deploy + one cleanup cron) + Supabase Postgres
Free (no managed backups/PITR) + Prisma out-of-band migrations (11/11 applied, no drift)**, with a
small early-stage dataset and clear Tier-1/2/3 data criticality. The recovery gap (H8) is the top risk;
H7 and M12 are the supporting deploy/rollback gaps. The deliverable is a set of **five cross-linked
markdown runbooks** under `docs/runbooks/`, grounded in current Supabase/Vercel docs (cited above),
with recommended backup strategy, RPO/RTO targets, and a launch-blocker classification baked in.

**This is a docs-only cycle**; no application code will be modified in PLAN/IMPLEMENT/TEST. The only
non-doc items (GH Action backup workflow, `migrate deploy` build fix, plan upgrade, restore drill) are
explicitly owner actions and remain out of scope. **Ready to proceed to PLAN.**
