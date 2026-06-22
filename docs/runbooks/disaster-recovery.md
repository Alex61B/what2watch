# Disaster Recovery (DR) Runbook

> **Parent:** [Operations Runbook](./README.md) · **Closes:** audit **H8** (DR scenarios + tested
> restore). Pairs with [Backup & Restore](./backup-restore.md) and
> [Release/Rollback](./deploy-release-rollback.md). **Last reviewed:** 2026-06-22.

## How to use this
Identify the scenario, follow the steps, respect the **stop-and-ask** gates (anything that mutates prod
env, secrets, or the database needs an explicit decision). Targets reference
[README §3 RPO/RTO](./README.md#3--rpo--rto-recommendations).

---

## A. Total database loss / project deletion
**Symptom:** `/api/health` → 503; app errors everywhere; Supabase project missing/unreachable.
**RPO:** age of last good dump (target ≤24h). **RTO:** ≤4h (Free) / ≤1–2h (Pro).
1. Confirm it's the DB (not Vercel): check `GET /api/health`, Supabase dashboard/status.
2. Stand up a fresh Supabase project (or use Pro restore if available).
3. Restore the latest verified dump per [Backup & Restore §3](./backup-restore.md#3-restore-procedure)
   **into the new project**, then `prisma migrate deploy` if restoring schema-only.
4. **Verify row counts** before exposing it.
5. **[stop-and-ask]** Repoint Vercel `DATABASE_URL` + `DIRECT_URL` to the restored project and redeploy.
6. Post-incident: record gap (data lost between last dump and failure); see [§ Restore drill](#mandatory-restore-drill).

## B. Accidental data deletion / bad migration
**Symptom:** specific rows/tables gone or wrong after a deploy or manual query.
**RPO/RTO:** as above; **PITR makes this near-zero** (strongest argument for the add-on).
1. **Stop further writes if feasible** (pause the offending path; do not "fix forward" blindly).
2. If a **migration** caused it → also see [Release/Rollback](./deploy-release-rollback.md). Prisma has
   no auto down-migration; recover data from the latest dump, not by reversing the migration.
3. Restore the affected data **into a scratch project**, extract the needed rows, and
   **[stop-and-ask]** apply them to prod surgically (targeted `INSERT`/`UPDATE`), or do a full restore
   if loss is broad.
4. If on **PITR** (Pro): restore to a timestamp just before the incident
   ([restore time guide](https://supabase.com/docs/guides/troubleshooting/how-long-does-it-take-to-restore-a-database-from-a-point-in-time-backup-pitr-qO8gOG)).

## C. Supabase outage or Free-project pause
**Symptom:** DB unreachable but project exists; or Free project auto-paused after inactivity.
1. Check [Supabase status](https://status.supabase.com) — if platform-wide, **wait + communicate**
   (see [Incident Triage](./incident-triage.md)); no data action needed.
2. If **paused** (Free behavior), resume from the Supabase dashboard. **Mitigation:** regular activity /
   the daily backup job keeps it warm; Pro doesn't auto-pause — another launch reason to upgrade.
3. App behavior during outage: `/api/health` 503; reads/writes fail. No data loss from an outage alone.

## D. Vercel outage / bad deploy
**Symptom:** app down or broken but `/api/health` (if reachable) shows DB ok; or a deploy shipped a bug.
1. Bad deploy → **Vercel Instant Rollback** (see [Release/Rollback](./deploy-release-rollback.md)).
2. Platform outage → check [Vercel status](https://www.vercel-status.com); communicate; no DB action.

## E. Leaked secret / credential rotation
**Symptom:** a secret committed, logged, or exposed.
**Rotate (in Vercel project env; never commit):** `DIRECT_URL` / `DATABASE_URL` (rotate the DB password
in Supabase → update both URLs), `AUTH_SECRET` (rotating invalidates all JWT sessions — users re-login),
`GOOGLE_CLIENT_SECRET` (Google Cloud console), `TMDB_API_KEY` (TMDB), `CRON_SECRET`, `ADMIN_EMAILS`.
1. Rotate at the source, then update Vercel env, then **redeploy** so new values take effect.
2. If the **DB credential** leaked, assume read access occurred → review Supabase logs; treat as a
   privacy incident per WP6 if user data was exposed.
3. **[stop-and-ask]** before rotating `AUTH_SECRET` in a way that mass-logs-out users — coordinate timing.

---

## Mandatory restore drill

A backup is only real once a restore has succeeded. **Run a drill at least quarterly and after any
schema change of note.**
1. Take (or fetch) the latest dump.
2. Restore into a **throwaway scratch project** ([Backup & Restore §3](./backup-restore.md#3-restore-procedure)).
3. Run the verification query; confirm Tier-1 counts are sane.
4. Tear down the scratch project.
5. **Record it below.**

| Date | Dump date | Result | By | Notes |
|------|-----------|--------|----|-------|
| _none yet_ | — | — | — | **First drill is a launch blocker (H8).** |
