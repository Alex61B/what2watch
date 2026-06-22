# Incident Triage Checklist

> **Parent:** [Operations Runbook](./README.md) · Fast path from "something's wrong" to the right
> runbook. **Last reviewed:** 2026-06-22.

## Severity matrix

| Sev | Definition | Examples | Response |
|-----|------------|----------|----------|
| **SEV1** | Data loss / breach, or full outage with no quick fix | DB lost/corrupted; leaked DB credential; user data exposed | Drop everything; → [DR](./disaster-recovery.md); notify `<ONCALL_CONTACT>` immediately |
| **SEV2** | Major function broken for most users; recoverable | Bad deploy; auth broken; DB unreachable (outage) | Roll back / mitigate within the hour |
| **SEV3** | Degraded / partial / cosmetic | One route failing; elevated errors; slow | Fix in normal flow; monitor |

When unsure, **treat as one level higher** until proven otherwise.

---

## First 15 minutes
1. **Confirm scope.** Hit `GET /api/health`:
   - `503 {db:down}` → database problem → [DR §A/§C](./disaster-recovery.md).
   - `200` but app broken → likely a **bad deploy** → [Release/Rollback §2](./deploy-release-rollback.md).
   - unreachable entirely → Vercel problem → [DR §D](./disaster-recovery.md).
2. **Check platform status:** [Vercel status](https://www.vercel-status.com) ·
   [Supabase status](https://status.supabase.com). If platform-wide → communicate & wait (no data action).
3. **Check what changed:** last Vercel deployment (time/author), any recent manual migration or SQL.
   Recent deploy + new errors → **roll back first, diagnose after**.
4. **Read the logs:** Vercel runtime logs (filter by route; `[csp-report]` is CSP noise, not an
   incident once WP2 ships); Supabase logs & `get_advisors`; `/admin` overview.
5. **Decide & route** using the decision tree below. **Do not** run destructive fixes (prod SQL, env
   rotation, restore-over-prod) without the stop-and-ask gate in the target runbook.

---

## Decision tree
```
/api/health?
├─ 503 db:down ───────► DB down → Supabase status?
│                         ├─ platform outage → wait + comms (DR §C)
│                         └─ project gone/corrupt → restore (DR §A/§B)
├─ 200 but broken ────► changed recently?
│                         ├─ recent deploy → Vercel Instant Rollback (Release §2)
│                         └─ recent migration → expand/contract issue? (Release §3 / DR §B)
└─ unreachable ───────► Vercel outage (DR §D) or DNS/domain → check Vercel status
```

---

## Escalation & communications
- **Escalate to** `<ONCALL_CONTACT>` for any SEV1, or SEV2 unresolved in ~30 min.
- **User comms template** (status page / banner / social):
  > "We're aware of an issue affecting <feature> since <time UTC>. We're working on it and will update
  > by <time>. Your data is safe." *(Only claim "data is safe" if backups confirm it.)*
- **Privacy incident?** If user data may be exposed (leaked DB credential, breach), follow the WP6
  privacy obligations in addition to technical recovery.

---

## After the incident
- Confirm `GET /api/health` 200 + smoke path.
- Write a short post-incident note: what happened, timeline, root cause, data impact (RPO actually
  realized vs target), and one prevention follow-up.
- If recovery exposed a gap (e.g., backup too old, restore slow), update the relevant runbook and the
  [README RPO/RTO](./README.md#3--rpo--rto-recommendations) targets.
