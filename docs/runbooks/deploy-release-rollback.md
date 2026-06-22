# Release / Rollback Runbook

> **Parent:** [Operations Runbook](./README.md) · **Closes:** audit **H7** (undocumented prod
> migrations) + **M12** (no rollback procedure / expand-contract). **Last reviewed:** 2026-06-22.

## 1. Normal release flow

PikFlix deploys via **Vercel on push to `main`** (PR → merge → auto build & deploy). The build runs
`prisma generate && next build` — it **does NOT run `prisma migrate deploy`**. **Migrations are applied
out-of-band** (H7), so the **order matters**.

**Release with NO migration:** merge to `main` → Vercel builds & promotes. Verify `GET /api/health` and
a smoke path. Done.

**Release WITH a migration — apply the migration FIRST, then deploy the code** (expand step, §3):
```bash
# from a trusted machine with the prod DIRECT_URL exported (NEVER bare `npx prisma` — pulls v7,
# breaks this v6 project; see reference-prisma-migrate-local-cli)
DIRECT_URL="<prod direct url, port 5432>" ./node_modules/.bin/prisma migrate status   # check drift
DIRECT_URL="<prod direct url, port 5432>" ./node_modules/.bin/prisma migrate deploy   # apply
# then merge the code that uses the new schema → Vercel deploys
```
> **[stop-and-ask]** Running a prod migration is a gated action. Always `migrate status` first; take a
> fresh **[backup](./backup-restore.md)** before any destructive (contract) migration.

**Recommended H7 fix (future, code change — not done in this docs-only WP):** add `prisma migrate deploy`
to the deploy pipeline (build command or a deploy hook) using `DIRECT_URL`, so schema and code ship
atomically. Until then, the manual order above is the contract.

---

## 2. Rolling back the CODE — Vercel Instant Rollback

Reverting the app is fast and safe **as long as the DB schema is still compatible** (see §3).

- **Dashboard:** Deployments → previous known-good deployment → ⋮ → **Instant Rollback**.
- **CLI:** `vercel rollback <previous-deployment-url-or-id>`.
- **Hobby plan limit:** you can roll back to the **immediately previous** deployment only (Pro/Enterprise:
  any eligible one). Keep a note of the last known-good deployment ID.
- After a rollback, Vercel **disables prod-domain auto-assignment** (new pushes won't auto-replace the
  rolled-back deploy). To resume normal deploys: `vercel promote <deployment>` (or undo in the dashboard).

Sources: [Instant Rollback](https://vercel.com/docs/instant-rollback) ·
[Rolling back production](https://vercel.com/docs/deployments/rollback-production-deployment) ·
[`vercel rollback`](https://vercel.com/docs/cli/rollback) ·
[Promoting deployments](https://vercel.com/docs/deployments/promoting-a-deployment).

---

## 3. Rolling back the DATABASE — expand/contract (M12)

**Prisma has no automatic down-migrations.** A code rollback does **not** undo a migration. So design
migrations so a code rollback never *needs* a schema rollback:

**Expand → migrate code → contract:**
1. **Expand** (backward-compatible): add the new column/table/index as **nullable / with a default**;
   deploy it *before* the code that uses it. Old code keeps working.
2. **Migrate code:** ship code that writes/reads the new shape (dual-write if needed).
3. **Contract** (destructive): only after the new code is stable in prod and you're confident you won't
   roll back past it, drop the old column/table in a later migration.

**Consequences:**
- Rolling back **expand-only** changes is safe (old code ignores the new nullable field).
- Rolling back code **past a contract** is unsafe (the column is already gone) → recover via
  [Backup & Restore](./backup-restore.md), not a code rollback. **Never contract and change code in the
  same release.**
- Before any contract migration: **fresh backup + `migrate status`**.

---

## 4. Post-release verification
- `GET /api/health` → `200 {db:ok}`.
- Smoke: sign in, create a room, vote, open `/profile`.
- Watch Vercel runtime logs for new errors (and `[csp-report]` once WP2 ships).
- `/admin` overview sane.

## 5. Checklist (per release)
- [ ] Migration? → `migrate status` clean, backup taken, `migrate deploy` **before** code merge.
- [ ] Expand/contract respected (no contract + code change together).
- [ ] Post-deploy health + smoke passed.
- [ ] Know the previous deployment ID for one-click rollback.
