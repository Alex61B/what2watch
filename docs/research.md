# Research — WP1: Abuse & Rate-Limit Hardening

> Cycle: WP1 of the 2026-06-21 production-readiness audit. Closes audit findings **H1, H2, H3**
> and the abuse-related **M-set** (room-code enumeration / unauth roster, user-search enumeration,
> unauth-join member cap, vote type-confusion + throttle, friend-request spam + DECLINED reopen).
> Read-only audit confirmed every finding against current `HEAD` (`5a97134`).

## 1. Requirements Summary

Make the abuse-exposed surfaces resistant to brute-force, forgery, enumeration, and spam **without
breaking legitimate UX** (rapid swipe-voting, the pre-join lobby view, friend search). Concretely:

| ID | Finding (confirmed against code) | Target behavior |
|----|----------------------------------|-----------------|
| **H1** | Login has **no throttle/lockout**. Credentials flow runs `bcrypt.compare` per attempt with no cap (`auth.ts:40-52`; POST handled by `app/api/auth/[...nextauth]/route.ts:1-2`). | Throttle the credentials callback by client IP (fixed window) → 429 before bcrypt. |
| **H2** | Durable limiter **fails OPEN** on any DB error (`lib/rate-limit-db.ts:59-65`); IP taken from leftmost `x-forwarded-for` (`:29-33`). | **Fail CLOSED for auth scopes** (login/signup); keep fail-open for best-effort `events`. IP-trust: see §3 — the leftmost-XFF half is **platform-mitigated**, fix is optional defense-in-depth. |
| **H3** | Events ingest durable cap is keyed on **client-supplied `anonId`** (`app/api/events/route.ts:30,36`) → rotate `anonId` to bypass; `roomId`/`memberId` stored unbounded (`:68-69`) and `roomId`(=code) feeds the recommender dwell signal (`queue/route.ts:12-32,126-133`). | Key the durable cap on **IP** (rotation-proof); bound `roomId`/`memberId` length. (Ranking-influence is already bounded — see §4.) |
| **M-code** | `generateRoomCode` = 100 adjectives × 90 two-digit = **9,000 combos** (`lib/room-code.ts:14-18`); roster GET is **unauthenticated** and returns members, `lastSeenAt`, name, status, matched movie to anyone with a code (`app/api/rooms/[code]/route.ts:7-60`). | Decision pending (§5 OQ1): raise entropy and/or trim non-member fields and/or rate-limit the GET. |
| **M-search** | `searchUsers` does `contains` (substring) on **email + displayName** with **no min length**, returns **email** in output (`lib/friends.ts:96-110`); route only requires auth (`app/api/users/search/route.ts`). 1-char query enumerates the user table + emails. | Decision pending (§5 OQ2): min query length, exact-email match, drop/mask email, rate-limit. |
| **M-join** | Room join has an IP rate-limit but **no member cap** (`app/api/rooms/[code]/members/route.ts`). Unbounded members per room. | Add a max-active-members check **inside the existing join transaction**. |
| **M-vote** | Vote accepts `tmdbMovieId` with only a truthy check — **no `typeof` guard** (`app/api/rooms/[code]/votes/route.ts:50-51`); no throttle. | Add `typeof tmdbMovieId === 'string'`; add a **per-member** throttle generous enough for swipe-voting. |
| **M-friend** | `sendFriendRequest` **re-opens a DECLINED** friendship in the new direction (`lib/friends.ts:39-43`) → declined user can re-spam; request route has **no rate-limit** (`app/api/friends/requests/route.ts`). | Rate-limit the request route; change DECLINED handling (§5 OQ4: hard-block vs cooldown). |

## 2. Stack Choices (reuse existing patterns — no new dependencies)

- **Durable limiter** `lib/rate-limit-db.ts` — Postgres `RateLimit` table, fixed-window, atomic
  `INSERT … ON CONFLICT DO UPDATE … RETURNING count`. Already wired at signup/room-create/room-join/events.
  Add new `RATE_LIMITS` entries (`login`, `vote`, `friendRequest`, `userSearch`) and a `failClosed?`
  option to `checkRateLimit` (default `false`).
- **In-memory fast-path** `lib/rate-limit.ts` — per-instance pre-DB blunt; reused as-is.
- **429 helper** `tooManyRequests(retryAfterSeconds)` — reused.
- **IP** `getClientIp` — reused (Vercel-overwritten XFF, see §3); optional `x-real-ip` fallback adds no dependency.
- **Login throttle** — wrap the exported `POST` in `app/api/auth/[...nextauth]/route.ts`, gate **only**
  the `…/callback/credentials` path, key on IP, **without reading the request body** (NextAuth needs the
  stream). No change to `auth.ts`.
- **Cleanup** — expired `RateLimit` rows already purged by `app/api/cron/cleanup/route.ts:41`; new scopes need no new sweep.
- **Tests** — extend the existing jest suites (`__tests__/lib/rate-limit-db.test.ts`, `…/api/votes.test.ts`,
  `…/api/events.test.ts`, `…/api/signup.test.ts`, `…/lib/friends.test.ts`, `…/lib/room-code.test.ts`). Baseline: 284/284 green.

## 3. Environment Verification

- **Deploy target = Vercel.** Per Vercel request-headers docs: *"Vercel overwrites [`x-forwarded-for`]
  and does not forward external IPs to prevent spoofing, unless a trusted proxy is enabled for Enterprise."*
  The project is on **Hobby** → the header is **edge-controlled and not client-spoofable**. So the
  "trusts spoofable leftmost XFF" half of **H2 is largely platform-mitigated**; the actionable H2 work is
  the **fail-open→fail-closed (auth scopes)** change. Canonical helper `ipAddress()` lives in
  `@vercel/functions`, which is **not installed** (adding it = a package install → restricted/approval).
  We can get the same robustness with `x-real-ip` (Vercel-set) as a fallback, **no new dependency**.
- **Fail-closed is safe for auth scopes:** login and signup already require the DB (user lookup / create).
  If the limiter's DB query throws, the subsequent auth query would throw too — so failing the limiter
  *closed* removes no availability that the outage hadn't already removed. (Events stay fail-open: best-effort telemetry.)
- **RateLimit table + cron sweep** confirmed present and wired (`lib/rate-limit-db.ts`, `app/api/cron/cleanup/route.ts`).
- **UI coupling:** `components/FriendsClient.tsx:7,39` defines `PublicUser { …; email }` and renders the
  email under each search result — so any change to the search output shape touches the client component.

## 4. Risks & Edge Cases

- **Login throttle correctness:** must match only the credentials-callback sub-path of `[...nextauth]`,
  never signout/session/csrf/Google-callback; must not consume the body. IP-only keying avoids both traps.
- **Restricted area:** `app/api/auth/[...nextauth]/route.ts` is under `app/api/auth/` (auth/session →
  restricted). Editing it needs **explicit user approval** (OQ3). `auth.ts` itself is **not** touched.
- **Vote throttle vs swipe UX:** swipe-voting is intentionally rapid; the cap must be **per-member** and
  generous (e.g. ≥1/sec sustained) so real users are never 429'd. Per-IP would punish multiple members on one network.
- **Member cap race:** count active (`leftAt: null`) members **inside** the existing `$transaction` so two
  concurrent joins can't both slip past the cap.
- **Events IP-keying:** users behind shared NAT share the `events` cap; acceptable because the cap is high (240/min).
- **Recommender-influence (H3) is already bounded:** `loadDwellByMovie` dwell only *weights* movies that
  also have a **real `Vote` row** in that room (`queue/route.ts:127-133`). A forged `card_decided` event
  with no matching real vote contributes nothing — so WP1 only needs to stop key-rotation + bound storage,
  not redesign the recommender (that stays out of scope).
- **Room-code entropy vs UX:** raising entropy lengthens the shareable code (printed links, "say it aloud"
  UX). Restricting the roster GET to members breaks the **pre-join lobby preview**. → design decision, not a mechanical fix.
- **User-search shape vs UX:** dropping email from results changes `FriendsClient`. Exact-email match means
  you can only find someone by their *full* email or display-name substring. → design decision.
- **DECLINED friend re-open:** a hard block traps users who legitimately reconcile; a cooldown is friendlier
  but more code. → design decision.

## 5. Assumptions & Open Questions

**Assumptions:** no new npm dependencies (everything reuses `lib/rate-limit*`); migrations untouched
(`RateLimit` table already exists); `auth.ts` untouched; verification stays `scripts/verify.sh`.

**Open questions (resolve before PLAN — they shape the manifest):**

- **OQ1 — room code / roster.** Pick: (a) raise code entropy (longer/typed code), (b) keep the code but
  **restrict the unauth roster GET** to existence + name only (hide members/`lastSeenAt`/matched movie from
  non-members) + rate-limit the GET, or (c) both. (b) preserves the share-a-short-code UX; (a) changes it.
- **OQ2 — user search.** Min query length (2 or 3?); **exact email match vs substring**; **drop, mask, or
  keep** email in results (drop = `FriendsClient` no longer shows it). Plus a `userSearch` rate-limit.
- **OQ3 — restricted auth edit.** Approve editing `app/api/auth/[...nextauth]/route.ts` to add the IP login
  throttle (H1)? No `auth.ts` change required.
- **OQ4 — DECLINED friend requests.** Hard-block re-open, or allow re-open after a cooldown window?
- **OQ5 — scope/size.** WP1 spans ~9 files + tests. Ship as **one** RESEARCH→…→TEST cycle, or split into
  **WP1a** (limiter core: H1, H2, H3, member cap, vote guard+throttle, friend-request throttle) and **WP1b**
  (enumeration/UX: room-code/roster, user-search) so the UX decisions don't block the security-critical core?

## 6. Out of Scope

- Other work packages: WP2 (security headers/CSP), WP3 (Sentry/observability), WP5 (env fail-fast),
  WP6 (privacy/legal), WP7 (ops/backup runbooks), WP8 (`next` 16).
- Migrating the limiter to Redis/Upstash; any change to the `RateLimit` schema/migration.
- Full recommender-integrity redesign (forged-event ranking influence — already bounded, §4).
- Adding `@vercel/functions` or any new dependency; CAPTCHA / email-verification / account-lockout-email flows.
- `auth.ts` credential logic (restricted; not needed for IP throttling).

## 6a. Decisions (resolved with user, 2026-06-21)

- **OQ5 → SPLIT.** This cycle = **WP1a (limiter core)**: H1 login throttle, H2 fail-closed (auth
  scopes), H3 events ingest, M-join member cap, M-vote `typeof` guard + per-member throttle, M-friend
  request rate-limit + DECLINED cooldown. **WP1b** (room-code/roster restriction + user-search
  enumeration) is a **follow-up cycle** with direction already set (below).
- **OQ3 → APPROVED.** May edit `app/api/auth/[...nextauth]/route.ts` to wrap the NextAuth `POST` with an
  IP login throttle (credentials-callback path only, no body read, no `auth.ts` change).
- **OQ1 → (WP1b)** restrict the unauth roster GET to existence + name + status; members/`lastSeenAt`/
  matched-movie only for authenticated members; rate-limit the GET; **keep the short code**.
- **OQ2 → (WP1b)** display-name substring (min 2) + **exact** email match; **drop email** from the
  response (update `FriendsClient`); add a `userSearch` rate-limit.
- **OQ4 → COOLDOWN.** `Friendship.updatedAt` exists, so DECLINED re-open is allowed only after a cooldown
  window (propose **24h**) rather than a permanent block — migration-free, less user-hostile.
- **Confirmed migration-free & dependency-free:** new `RATE_LIMITS` scopes only; member cap counts
  `Member.leftAt: null` inside the existing join `$transaction`; no `@vercel/functions`.

## 7. Readiness Verdict: READY FOR PLANNING

All findings confirmed against current code; H2's XFF half corrected (platform-mitigated); the genuine
design decisions are isolated as OQ1–OQ5. Pending the user's answers (esp. OQ1, OQ2, OQ3, OQ5), this is
ready to advance to PLAN.
