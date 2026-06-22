# Backup & Restore Runbook

> **Parent:** [Operations Runbook](./README.md) · **Closes:** audit **H8** (no backups, restore
> untested). **Last reviewed:** 2026-06-22.

## 0. TL;DR / the gap

PikFlix runs on **Supabase Free**, which has **no managed daily backups and no point-in-time recovery**
([Supabase — Database Backups](https://supabase.com/docs/guides/platform/backups)). **Today there is no
backup of production.** Until the steps below are running, a dropped table, bad migration, or project
deletion is **unrecoverable**. Closing this is a **launch blocker** (see [README §4](./README.md)).

**Recommended path:** (1) start **daily logical dumps now** (free), (2) **upgrade to Supabase Pro
before real-user launch** for managed daily backups, (3) add **PITR** when data value justifies it.

---

## 1. Manual logical backup (do this first, today)

Take the dump against the **direct** connection (`DIRECT_URL`, port **5432**) — **not** the
transaction pooler (6543), which breaks `pg_dump`.

**Option A — Supabase CLI (recommended; excludes Supabase-managed schemas, idempotent):**
```bash
# requires Docker + `supabase link` to the project (or pass --db-url "$DIRECT_URL")
supabase db dump --db-url "$DIRECT_URL" -f backup_$(date +%F).sql            # schema + roles (no data)
supabase db dump --db-url "$DIRECT_URL" --data-only -f backup_data_$(date +%F).sql
```
([`supabase db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump) ·
[Backup & Restore via CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore))

**Option B — raw `pg_dump` (no Docker; simplest for CI):**
```bash
pg_dump "$DIRECT_URL" --no-owner --no-privileges -Fc -f backup_$(date +%F).dump
# -Fc = custom format (compressed, restore with pg_restore). For our public schema this is sufficient;
# Supabase auth/storage schemas are recreated by the platform on a fresh project (see §3).
```

**Handle dumps as sensitive PII.** They contain emails and `passwordHash`. Therefore:
- **Encrypt at rest** (e.g., `age`/`gpg`) before uploading.
- Store **off-site** in an access-controlled, **private** location — **not** a public bucket, **not**
  committed to git, **not** plain GitHub Actions artifacts for anything but short-lived test runs.
- Set a **retention window** (e.g., 30 daily + keep monthlies) consistent with the WP6 privacy posture.

**Verify every dump** (a dump you can't read is not a backup):
```bash
ls -lh backup_*.dump           # non-trivial size
pg_restore -l backup_$(date +%F).dump | head     # table of contents lists our tables
```

---

## 2. Automated daily backup (template — owner applies)

Supabase documents a CI backup pattern ([Automated backups with GitHub Actions](https://supabase.com/docs/guides/deployment/ci/backups)).
**GitHub Actions is the right home — Vercel cron cannot run `pg_dump`** (no Postgres binary,
serverless time limits).

> ⚠️ **Owner action, NOT part of this docs-only WP.** Creating `.github/workflows/db-backup.yml`,
> adding the `DIRECT_URL` repo secret, and choosing the encrypted destination are infra changes —
> apply them deliberately (or as a small follow-up WP with approval). Template:

```yaml
# .github/workflows/db-backup.yml   (TEMPLATE — review before enabling)
name: db-backup
on:
  schedule: [{ cron: "0 5 * * *" }]   # 05:00 UTC daily (after the 04:00 cleanup cron)
  workflow_dispatch: {}
jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: pg_dump (direct connection)
        run: pg_dump "${{ secrets.DIRECT_URL }}" --no-owner --no-privileges -Fc -f backup.dump
      - name: Encrypt
        run: gpg --batch --yes --passphrase "${{ secrets.BACKUP_PASSPHRASE }}" -c backup.dump
      - name: Upload to off-site store
        run: echo "TODO: push backup.dump.gpg to <ENCRYPTED_PRIVATE_STORE> (rclone/aws s3 cp/etc.)"
        # Do NOT rely on default GH artifacts for long-term backups (short retention, repo-scoped).
```
Pin the Postgres client version to match the server major; add a failure alert (the job must page
`<ONCALL_CONTACT>` if a daily backup fails — a silently-failing backup is worse than none).

---

## 3. Restore procedure

**Always restore into a SCRATCH Supabase project first — never overwrite production while diagnosing.**

1. Create a new (scratch) Supabase project; capture its `DIRECT_URL`.
2. Restore:
   ```bash
   # custom-format dump:
   pg_restore --no-owner --no-privileges -d "$SCRATCH_DIRECT_URL" backup_YYYY-MM-DD.dump
   # plain SQL dump:
   psql "$SCRATCH_DIRECT_URL" -f backup_YYYY-MM-DD.sql
   ```
3. If the dump was schema-only or you're rebuilding from the repo instead, apply migrations:
   ```bash
   DIRECT_URL="$SCRATCH_DIRECT_URL" ./node_modules/.bin/prisma migrate deploy
   ```
4. **Verify** (row counts should match expectations from [README §2](./README.md)):
   ```sql
   SELECT 'User' t, count(*) FROM "User"
   UNION ALL SELECT 'Account', count(*) FROM "Account"
   UNION ALL SELECT 'Friendship', count(*) FROM "Friendship"
   UNION ALL SELECT 'UserMoviePreference', count(*) FROM "UserMoviePreference";
   ```
5. Only after verification, decide whether to **promote** the scratch project (repoint Vercel
   `DATABASE_URL`/`DIRECT_URL`) or restore into the original. **Repointing prod env is an owner action**
   (stop-and-ask).

**Note on managed schemas:** `supabase db dump` excludes `auth`/`storage`; a brand-new project recreates
them. Our app only uses the `public` schema (auth is NextAuth/Prisma in `public`), so a public-schema
restore is sufficient for full recovery. See
[Restoring a downloaded backup](https://supabase.com/docs/guides/local-development/restoring-downloaded-backup).

---

## 4. Upgrade path (managed backups)

| Plan | Backups | PITR | Cost |
|---|---|---|---|
| **Free (current)** | none | none | $0 — **dumps are mandatory** |
| **Pro** | **daily** managed | optional add-on | ~$25/mo base |
| **Pro + PITR** | daily + continuous | **≤ ~2 min RPO**, 7–28 day retention | +~$100/mo per 7-day |

Sources: [Database Backups](https://supabase.com/docs/guides/platform/backups),
[PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery),
[Pricing](https://supabase.com/pricing). **Recommendation:** Pro before real-user launch; PITR when the
dataset's value warrants ≤2-min RPO. Even on Pro, keep an **independent off-site dump** (defense against
account-level loss).

---

## 5. Checklist

- [ ] First manual dump taken, encrypted, stored off-site, and **restore-verified** in a scratch project.
- [ ] Daily automation enabled with failure alerting (owner).
- [ ] Restore drill scheduled & logged in [disaster-recovery](./disaster-recovery.md).
- [ ] Pro upgrade decision made before launch.
