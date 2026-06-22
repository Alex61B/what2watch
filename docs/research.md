# RESEARCH — WP6: Privacy & Data Lifecycle (PikFlix / What2Watch)

> **State:** RESEARCH (read-only). No application code touched. This document supersedes the
> prior WP1b research content; WP1b's durable record is `docs/plan-wp1b-enumeration-hardening.md`
> + `docs/session-handoff-2026-06-21-wp1b.md`.
> **Audit findings closed by this WP:** **C1** (no privacy/terms pages → launch blocker +
> Google OAuth suspension risk) and **M9** (PII grows unbounded; no account-deletion / erasure
> path; `Event.userId` not scrubbed).

---

## 1. Requirements Summary

**What WP6 delivers and why.** PikFlix collects real personal data (email, display name, Google
OAuth tokens, social graph, taste profile, behavioral analytics) but ships **zero** privacy/legal
surface and **no way for a user to delete their account**. This is the single calendar-critical
launch blocker (audit **C1**) and a standing legal + platform-policy exposure.

Three deliverables, each independently launch-gating:

1. **Publish a Privacy Policy (`/privacy`) and Terms of Service (`/terms`).**
   - *Legal basis:* GDPR Art. 13/14 (transparency) and CCPA/CPRA notice-at-collection both require
     a published privacy notice before collecting personal data.
   - *Platform basis (verified):* Google's OAuth consent screen requires the privacy policy to be
     **linked on the consent screen and hosted on the same domain as the homepage**; the policy must
     disclose how the app accesses/uses/stores/shares Google user data. Publishing to production
     triggers **brand + domain verification (~2–3 business days)**.

2. **Account-deletion / right-to-erasure flow (audit M9).**
   - *Legal basis:* GDPR Art. 17 (erasure), CCPA right to delete.
   - *Platform basis (verified):* Google's API Services User Data Policy requires any app that lets
     users create an account to provide an **in-app deletion option AND a web-accessible deletion
     request path**, and to delete the associated user data (retention permitted only for disclosed
     security/fraud/legal reasons).
   - *Technical:* a deletion must cascade `User` → `Account`/`Member`/`Friendship`/
     `UserMoviePreference` (FKs already cascade) **and explicitly scrub `Event.userId`** (nullable,
     **no FK** — orphaned analytics rows otherwise retain the user link for up to 90 days).

3. **Register the consent-screen URLs in Google Cloud Console** (homepage + `/privacy` + `/terms` on
   the production domain) and publish the app. **Owner action** (Console, not code) — but it depends
   on the pages from (1) being live on the real domain.

**Supporting UI:** footer/auth-form links to `/privacy` + `/terms` (currently `BrandFooter.tsx` is a
bare copyright line); a brief at-collection consent line on the signup form; disclosure of the
first-party analytics in the policy.

---

## 2. Stack Choices (reuse existing patterns)

- **Pages:** App Router **server components**, modeled on `app/profile/page.tsx` (`<main>` +
  centered container + Tailwind semantic tokens `bg-canvas`/`text-ink`). `/privacy` and `/terms` are
  static content pages — no client JS, no data fetching. No new deps.
- **Styling:** Tailwind with the existing semantic tokens (`tailwind.config.ts`) + `serif`
  (Playfair) for headings, matching the editorial look. No CSS modules.
- **Footer links:** extend `components/BrandFooter.tsx` (or add a small `LegalLinks` partial) — it is
  already rendered on the landing page (`app/page.tsx:289`).
- **Deletion endpoint:** new `DELETE /api/account` (or `/api/user`) server route, auth-gated via the
  existing `requireUserId()` / `ProfileGuard` pattern (server-side session check used across
  `app/profile/*`). Wrap the multi-table delete + `Event.userId` scrub in a single Prisma
  `$transaction` (same pattern WP1a used for the join cap). Apply a durable rate-limit scope from
  `lib/rate-limit-db.ts` (fail-closed — it is a destructive, authenticated action).
- **Deletion UI:** a "Delete account" control under `app/profile/settings/*` (client component with a
  type-to-confirm guard), plus the web-accessible request path Google requires (the same authenticated
  page satisfies "discoverable in-app"; document an email fallback in the policy for the
  "without reinstalling" clause).
- **Event scrub:** `prisma.event.updateMany({ where: { userId }, data: { userId: null } })` inside the
  deletion transaction — keeps aggregate analytics intact while severing the identity link.
- **Analytics opt-out (per decision 7):** add a persisted opt-out flag (localStorage, mirrors
  `pikflix_anon`) + an early-return guard in `lib/analytics.ts#track()`/`flush()`, surfaced as a toggle
  in `app/profile/settings/*`. No new dep; small, additive.
- **Migrations:** **none expected.** `Event.userId` is already nullable; no schema change needed for
  deletion. (If we later decide to also null `memberId`/`anonId` on events, still no schema change.)

---

## 3. Environment Verification (confirmed against live code)

- **Google scopes are non-sensitive only** — `auth.ts:31-34` configures the Google provider with no
  custom `scope`, so NextAuth's defaults (`openid email profile`) apply. ⇒ **no sensitive/restricted
  security assessment required**; only brand + domain verification.
- **IP is NOT persisted.** `app/api/events/route.ts` reads `x-forwarded-for` only to build the
  rate-limit key; the `Event` row has no `ip` column and none is written. **No User-Agent logging.**
  This materially shrinks the privacy policy's "what we collect" surface.
- **Analytics is first-party, pseudonymous, bounded.** `anonId` is a client UUID in
  `localStorage:pikflix_anon`; events are 90-day pruned by the cleanup cron
  (`app/api/cron/cleanup/route.ts`, `EVENT_RETENTION_MS`). Allowed event types/props are allow-listed
  (`lib/analytics-events.ts`) and carry no free-form PII.
- **Cascade FKs already exist** for `Account`, `Member`, `Friendship`, `UserMoviePreference`,
  `Vote`/`WatchedMovie` (via `Member`) → `User` deletion cleans them automatically. **Only
  `Event.userId` is an unguarded orphan link.**
- **Cookies are strictly functional:** `w2w_session_<CODE>` (httpOnly, sameSite=lax, secure in prod,
  7-day) + the NextAuth JWT session cookie. `w2w_theme` + `pikflix_anon` are functional localStorage.
  **No third-party/marketing/cross-site cookies.**
- **Third-party data recipients:** Supabase/Postgres (all data), Google (OAuth handshake → returns
  profile), Vercel (hosting/cron), TMDB (**no user data sent** — server-side API key + movie queries
  only), streaming-service deep links (movie title only, no user identity).
- **Domain is unknown in-repo:** `AUTH_URL=http://localhost:3000`; no `metadataBase`; production domain
  not committed (Vercel auto-domain or an undocumented custom domain). **This blocks the Google
  consent-screen registration and the `metadataBase`/canonical URL.** (Owner input.)
- **Branding:** product name **"PikFlix"** (package `what2watch`); **no legal entity, contact email,
  jurisdiction, or data-controller identity exists anywhere** in the repo.

---

## 4. Risks & Edge Cases

**Schedule / external:**
- **Google verification latency (~2–3 business days)** + domain verification of the homepage, privacy,
  and ToS URLs. The pages must be **live on the production domain** before this can start ⇒ deploy
  ordering matters; build slack into the launch calendar.
- If the production domain isn't finalized, the consent-screen registration cannot complete.

**Account-deletion correctness (the high-risk surface):**
- **JWT session strategy (`auth.ts:26`) means there is no server-side session to invalidate.** A
  deleted user's already-issued JWT stays cryptographically valid until expiry. Mitigation to weigh:
  short session lifetime, or a deleted-user check in the auth `session` callback (lookup user;
  invalidate if gone — note this adds a DB read per request).
- **`Event.userId` orphan scrub** must be inside the same transaction as the user delete, or a crash
  mid-delete leaves dangling identity links. No FK enforces this — easy to forget.
- **Host of an active room:** `Room` has no `userId` FK; deleting a user removes their `Member` row
  but the room persists (auto-expires later). Acceptable, but the deletion path must not throw on
  in-flight rooms/votes. Confirm cascade through `Member` → `Vote`/`WatchedMovie` doesn't deadlock
  with the room cleanup cron.
- **OAuth token disposal:** deleting the `Account` row removes our stored Google `refresh_token`/
  `access_token`, but does **not** revoke Google's grant. Optional best practice: call Google's token
  revocation endpoint on delete. Decide in/out of scope.
- **Authorization:** the delete must derive the target strictly from the authenticated session
  (`requireUserId()`), never from a client-supplied id — else it becomes an account-deletion IDOR.
  Add a type-to-confirm step + rate-limit (fail-closed) to prevent accidental/abusive deletion.
- **Idempotency / partial failure:** re-deleting or deleting a half-deleted account should be safe.

**Privacy-policy truthfulness:**
- The policy's retention claims must match reality (rooms: ~24h grace cron; events: 90d; account data:
  until deletion). Any promise we can't keep is itself a violation.
- **Residual email exposure** (carried from WP1b): `listFriends`/`GET /api/friends` still returns
  `email` for established friends. Not enumeration, but the policy must accurately describe what
  friends can see, or we close it here. (Decision — likely just disclose.)

**Cookie/analytics consent (legal ambiguity):**
- Strictly-necessary cookies need no consent. The **first-party, no-IP, pseudonymous analytics** is a
  gray area under EU ePrivacy: defensible as legitimate-interest with disclosure + opt-out, but a
  strict reading wants prior consent. Choosing "disclose + honor opt-out, no banner" is the
  pragmatic default; a banner is the conservative option. **Owner risk decision.**

---

## 5. Assumptions & Open Questions (gate PLAN — owner/decision inputs)

**Owner-supplied facts — RESOLVED / PLACEHOLDER (2026-06-21):**
1. **Data-controller / legal identity → "Alexander Smith"** (individual). Named in privacy policy + ToS.
2. **Contact email → PLACEHOLDER** (`[PRIVACY_CONTACT_EMAIL]`). Still unknown; insert as a placeholder
   token throughout the pages/policy so a single find-replace fills it at launch.
3. **Governing-law jurisdiction → State of Florida, USA.** ToS governing-law + venue clause.
4. **Production domain → PLACEHOLDER** (`[PROD_DOMAIN]`). Still unknown. **Launch prerequisite, not a
   drafting blocker** — pages/deletion flow/plan are written domain-agnostic with the placeholder; the
   domain-dependent steps (Google consent-screen verification, `AUTH_URL`, `metadataBase`, published
   policy URLs) are called out as a **pre-launch checklist**, not IMPLEMENT-cycle code.
   - **Product name: "PikFlix"** is a **working name and may change before launch** — treat the brand
     string as a single source-of-truth constant where practical so a rename is cheap.

**Design decisions — RESOLVED with the user 2026-06-21:**
5. **v1 auth surface → BOTH (Google + email/password).** ⇒ the Google consent-screen registration +
   brand/domain verification **IS a hard v1 launch blocker**; deploy ordering must put `/privacy` +
   `/terms` live on the production domain **before** verification can start.
6. **Deletion UX → self-serve in-app button (auth-gated, type-to-confirm) + documented email
   fallback.** Satisfies Google's "in-app option AND web-accessible request" requirement.
7. **Cookie/analytics consent → disclose + honor opt-out, no banner.** Treat first-party no-IP
   analytics as legitimate interest; IMPLEMENT adds a localStorage opt-out flag + `track()`/`flush()`
   guard + a settings toggle (see §2).
8. **Regulatory coverage → one policy covering GDPR + CCPA/CPRA generically.**

**Still on recommended defaults (proceed unless corrected at plan-approval):**
9. **Minimum age** — state a **13+** minimum (COPPA floor; 16 if targeting EU minors conservatively).
10. **Google token revocation on delete** — local token deletion only for v1 (deleting the `Account`
    row); calling Google's revocation endpoint is a noted follow-up.

**Owner-supplied facts (items 1–4 above) remain the only hard blocker to PLAN.**

**Assumptions (will proceed on these unless corrected):**
- Self-serve **data export/portability** is **not** built as code in WP6 — the policy commits to a
  manual email-based fulfillment of access/portability requests (revisit later).
- No schema/migration change is needed (deletion uses existing nullable `Event.userId` + cascade FKs).
- The deleted-user JWT-invalidation hardening is in scope to *evaluate*; whether to add the per-request
  DB check is a PLAN decision (perf trade-off).

---

## 6. Out of Scope (explicitly excluded from this cycle)

- **Actual Google Cloud Console configuration** (consent screen + domain verification) — owner action,
  not committable code; WP6 produces the pages/URLs it consumes.
- **Self-serve data-export/portability API** — deferred; satisfied via documented manual process.
- **A full cookie-consent banner** — excluded unless decision (7) selects the banner option.
- **Closing the WP1b residual** `GET /api/friends` email exposure as a *code* change — default is to
  disclose it in the policy, not re-engineer it here (revisit if the owner prefers removal).
- **WP2** (security headers/CSP), **WP3** (Sentry), **WP5** (env fail-fast incl. `AUTH_URL`/secret
  assertion), **WP7** (deploy + backup/restore runbooks — incl. the still-open Supabase Free-plan
  backup gap), **WP8** (next 16). Cross-WP note: WP5's `AUTH_URL`/prod-env work and WP6's domain need
  are coupled — sequence them together when the domain is known.

---

## 7. Readiness Verdict

**Technical approach: READY FOR PLANNING.** The code-side surface is fully mapped — the pages, the
footer/consent links, the `DELETE /api/account` transaction (cascade + `Event.userId` scrub), and the
deletion UI all reuse existing patterns with **no new dependencies and no migration**. All
launch-blocking privacy requirements are identified (C1 pages + Google consent registration; M9
deletion + event scrub; verified against Google's current OAuth + User-Data policies).

**Design decisions 5–8 are RESOLVED** (2026-06-21): launch with both auth methods (Google verification
is a v1 blocker), self-serve + email-fallback deletion, disclose-+-opt-out analytics, GDPR+CCPA
coverage. **Owner facts resolved** (controller = Alexander Smith, jurisdiction = Florida) **with two
launch-time placeholders** — `[PROD_DOMAIN]` and `[PRIVACY_CONTACT_EMAIL]`. Per the user's direction,
these placeholders do **not** block drafting the pages, the deletion flow, or the plan; the
domain-dependent items (Google OAuth verification, `AUTH_URL`, `metadataBase`, published policy URLs)
are documented as **launch prerequisites**. **READY TO ADVANCE TO PLAN.**
