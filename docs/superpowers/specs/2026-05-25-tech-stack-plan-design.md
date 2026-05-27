# Tech Stack Evolution Plan — What2Watch

## Context

What2Watch is an MVP room-based movie recommendation app built on Next.js 15, Prisma, PostgreSQL, and NextAuth. The current stack is deployed on Render (staging only, no real user data). The goal is to update the tech stack now so that three upcoming feature categories are architecturally possible without rewrites later:

1. **Advanced recommendations** — requires event tracking and vector search
2. **Social features** — requires real-time communication (room sync, friend presence)
3. **Gamification** — requires background job scheduling and fast in-memory leaderboards

No features are being built yet. This document covers what to adopt, why, and in what order.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Vercel                           │
│  Next.js 15 (App Dir)  │  Edge  │  Cron Jobs       │
└──────────────┬──────────────────────────────────────┘
               │
       ┌───────┴────────────────────────┐
       ▼                                ▼
┌─────────────────────────┐   ┌────────────────────┐
│       Supabase          │   │   Upstash Redis     │
│  PostgreSQL (Prisma)    │   │  (add when needed)  │
│  pgvector extension     │   │  • Leaderboards     │
│  Realtime               │   │  • Rate limiting    │
│  Storage                │   └────────────────────┘
└─────────────────────────┘
```

**Unchanged:** All Next.js code, Prisma schema, NextAuth 5 + Prisma Adapter, Tailwind, TMDB API, Google OAuth.

---

## Services

### Vercel (replaces Render)

- **Why:** Next.js is built by Vercel — best integration, no cold starts on free tier (Render spins down after 15 min inactivity)
- **What you get free:** Unlimited deployments, preview deploys per PR, 100GB bandwidth, Cron Jobs (12/day), edge network
- **Cron Jobs:** `vercel.json` with a `crons` entry handles streak resets — no separate scheduler needed
- **Migration effort:** Connect GitHub repo, paste env vars in dashboard. Zero code changes.

### Supabase (replaces Render PostgreSQL)

- **Why:** Same PostgreSQL under the hood — Prisma continues to work with only a `DATABASE_URL` change
- **What you get that enables future features:**
  - `pgvector` extension — vector similarity search for recommendation embeddings (one SQL command to enable)
  - Supabase Realtime — WebSocket subscriptions for room sync and friend presence; no Pusher/Ably needed
  - Storage buckets — file/media storage for room recap content
  - Row Level Security — fine-grained access control for social data
- **Free tier:** 500MB DB, 1GB Storage, 2M Realtime messages/month, 50K MAU
- **Migration effort:** Export Render Postgres → import to Supabase → update `DATABASE_URL` + `DIRECT_URL` → `npx prisma migrate deploy`

### Upstash Redis (add when building gamification)

- **Why:** Serverless Redis, billed per request (~$0 at low traffic). Redis sorted sets are the standard pattern for points leaderboards.
- **When to add:** Only when starting streaks/points work. Not needed today.
- **Free tier:** 10K commands/day

---

## What Does NOT Change

| Item | Status |
|---|---|
| Prisma schema + ORM | Unchanged — Supabase is PostgreSQL |
| NextAuth 5 + Prisma Adapter | Unchanged — works with any Postgres |
| All Next.js app code | Unchanged |
| TMDB API integration | Unchanged |
| Google OAuth | Unchanged |
| Tailwind CSS | Unchanged |

---

## Migration Sequence

1. Create Supabase project (free tier)
2. Export existing Render PostgreSQL (`pg_dump`)
3. Import to Supabase (`psql` or Supabase dashboard)
4. Update `.env.local`: set `DATABASE_URL` to Supabase pooled connection, `DIRECT_URL` to Supabase direct connection
5. Run `npx prisma migrate deploy` to verify schema
6. Run `CREATE EXTENSION IF NOT EXISTS vector;` in Supabase SQL editor (enables pgvector)
7. Create Vercel project: connect GitHub repo, paste all env vars
8. Add `vercel.json` with `crons` block (empty initially, populated when building streaks)
9. Smoke test on Vercel preview URL
10. Update DNS if applicable, disable Render services

**Estimated code changes: 0 lines.** Only env var updates and one new config file.

---

## Future Feature → Service Mapping

| Feature | Service | When |
|---|---|---|
| Track user events (recommendations) | Supabase Postgres + pgvector | When building recommendation engine |
| Real-time room sync | Supabase Realtime + supabase-js client | When building live room features |
| Friend presence indicators | Supabase Realtime | When building social graph |
| Room memories / recaps media | Supabase Storage | When building room memories |
| Streak resets | Vercel Cron | When building gamification |
| Points leaderboard | Upstash Redis sorted sets | When building gamification |

---

## Verification Checklist

After migration:
- [ ] `npx prisma db pull` returns schema matching current models
- [ ] Local dev connects to Supabase successfully
- [ ] Vercel preview deploy builds and loads the app
- [ ] Auth (NextAuth Google OAuth) works on Vercel domain
- [ ] TMDB API returns results in the app
- [ ] No Render cold start delays
