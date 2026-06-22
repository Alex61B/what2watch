# PikFlix / What2Watch — Operations Runbook

> **Audience:** whoever is operating PikFlix in production (today: the owner).
> **Scope:** how the system is deployed, what can go wrong, and where to go to fix it.
> **Status:** WP7 (audit H7/H8/M12). Docs-only — these runbooks describe procedures; the owner
> executes the infra actions (backups, plan upgrade, restore drills).
> **Last reviewed:** 2026-06-22.

---

## 1. System map

| Layer | What | Notes |
|---|---|---|
| **App** | Next.js 15 (App Router) on **Vercel** | Push-to-`main` auto-deploys production. Project: `alex61bs-projects/what2watch`. |
| **DB** | **Supabase Postgres** (**Free plan**) | Runtime via pooled `DATABASE_URL` (1 conn/instance, `lib/prisma.ts`); migrations via direct `DIRECT_URL`. **No managed backups / no PITR on Free** — see [backup-restore](./backup-restore.md). |
| **Migrations** | **Prisma** (`_prisma_migrations`) | Applied **out-of-band** with `./node_modules/.bin/prisma migrate deploy` (the build does *not* run them — H7). 11/11 applied, no drift (2026-06-22). |
| **Cron** | `GET /api/cron/cleanup` @ `0 4 * * *` UTC (`vercel.json`) | `CRON_SECRET` bearer. Deletes rooms 24h past expiry, events >90d, soft-leaves members idle >1h, purges expired `RateLimit`. |
| **Auth** | NextAuth 5 (Google + credentials), JWT sessions | No server-side session table; deleted-user JWTs valid until expiry. |
| **3rd-party** | Google OAuth, TMDB (server-side key) | TMDB receives no user data. |

**Health & visibility**
- **Liveness/DB probe:** `GET /api/health` → `200 {status:ok,db:ok}` or `503 {db:down}` (no detail leaked).
- **Admin overview:** `/admin` (gated by `ADMIN_EMAILS`).
- **Logs:** Vercel runtime logs (incl. `[csp-report]` CSP violations once WP2 ships); Supabase logs &
  advisors (Supabase dashboard / MCP `get_logs`, `get_advisors`).

**Environments / secrets** (Vercel project env — never in the repo):
`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_URL` (prod), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `TMDB_API_KEY`, `CRON_SECRET`, `ADMIN_EMAILS`, `NEXT_PUBLIC_SITE_URL`.
Rotation procedure → [disaster-recovery](./disaster-recovery.md#e-leaked-secret--credential-rotation).

---

## 2. Data criticality tiers (drives recovery objectives)

| Tier | Tables | Recoverability |
|---|---|---|
| **1 — irreplaceable** | `User`, `Account` (OAuth + `passwordHash`), `Friendship`, `UserMoviePreference`, `WatchedMovie`, `User.savedServices/savedFilters` | Loss = real user harm. **Backups must protect these.** |
| **2 — transient** | `Room`, `Member`, `Vote`, `RoomQueue`, `MemberQueue` | Rooms auto-expire ≤48h; in-flight loss self-heals (users re-create). |
| **3 — regenerable/ephemeral** | `MovieCache` (re-fetch from TMDB), `Event` (90-day analytics), `RateLimit`, `VerificationToken` | No recovery objective. |

---

## 3. RPO / RTO recommendations

> **RPO** = max acceptable data loss (age of last good backup). **RTO** = max acceptable time to
> restore service. Targets apply to **Tier-1** data; Tier-2/3 carry no objective.

| Phase | Backup mechanism | RPO target | RTO target |
|---|---|---|---|
| **Now (Free, pre-launch)** | Daily logical dump (manual → automate via GitHub Action) | **≤ 24 h** | **≤ 4 h** (manual restore into a fresh project) |
| **At real-user launch (recommend Supabase Pro)** | Managed **daily** backups | **≤ 24 h** | **≤ 1–2 h** |
| **When data value justifies it** | **PITR** add-on (~$100/mo per 7-day) | **≤ ~2 min** | **≤ 1–2 h** |

**Recommendation:** stand up the **daily dump now** (zero cost, closes the gap), and **upgrade to
Supabase Pro before opening to real users**. See [backup-restore](./backup-restore.md).

---

## 4. Launch-blocker classification

| Item | Classification | Why |
|---|---|---|
| **Backup exists + a *tested* restore** (H8) | 🔴 **LAUNCH BLOCKER** | Without it, any data-loss event is **permanent**. Must exist before real-user launch. |
| Release/rollback procedure (M12) | 🟡 Strongly recommended pre-launch | App already deploys & rolls back via Vercel; this reduces blast radius. |
| Deploy/migration runbook (H7) | 🟡 Strongly recommended pre-launch | Out-of-band migrations are error-prone without a documented order. |
| DR scenario depth + incident triage | 🟢 Nice-to-have at launch | Valuable; can mature post-launch. |

*(Separate, non-WP7 launch prerequisites still open: WP6 prod domain/email + Google consent-screen
publish; WP5 env fail-fast. See `docs/session-handoff-2026-06-22-wp2.md`.)*

---

## 5. The runbooks

1. **[Backup & Restore](./backup-restore.md)** — Free-plan gap mitigation, manual & automated backups,
   restore into a scratch project, Pro/PITR upgrade path.
2. **[Disaster Recovery](./disaster-recovery.md)** — scenario playbooks (DB loss, accidental deletion,
   Supabase/Vercel outage, secret leak) + the mandatory restore drill.
3. **[Release / Rollback](./deploy-release-rollback.md)** — deploy flow, Prisma `migrate deploy`,
   expand/contract, Vercel Instant Rollback.
4. **[Incident Triage](./incident-triage.md)** — severity matrix, first-15-minutes, escalation.

---

## 6. Open owner decisions (tracked, not blocking these docs)

- [ ] **Off-site backup destination** + encryption key custody (recommend an encrypted private object
  store, not GitHub artifacts).
- [ ] **When to upgrade to Supabase Pro** (recommend: before real-user launch).
- [ ] **On-call / escalation contact** (placeholder `<ONCALL_CONTACT>` throughout).
- [ ] **Run the first restore drill** and record the date in [disaster-recovery](./disaster-recovery.md).
- [ ] **Apply the recommended H7 build-command fix** (`prisma migrate deploy` in the deploy flow) — a
  small **code/config** change, intentionally *not* made in this docs-only WP.
