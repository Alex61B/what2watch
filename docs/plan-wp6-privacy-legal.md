# PLAN — WP6: Privacy & Data Lifecycle (PikFlix / What2Watch)

> Cycle artifact for WP6. Research: `docs/research.md`. Closes audit **C1** (no privacy/terms →
> launch blocker + Google OAuth suspension risk) and **M9** (no account-deletion / erasure path;
> `Event.userId` not scrubbed). **Migration-free, dependency-free.**
>
> **Resolved inputs:** controller = **Alexander Smith** (individual); jurisdiction = **Florida, USA**;
> auth at launch = **Google OAuth + email/password**; deletion = **self-serve + email fallback**;
> analytics = **disclose + opt-out, no banner**; coverage = **GDPR + CCPA/CPRA**.
> **Placeholders (single find-replace at launch):** `[PROD_DOMAIN]`, `[PRIVACY_CONTACT_EMAIL]`.
> **Working brand name "PikFlix" may change** → new copy references a single `lib/brand.ts` constant.

---

## 1. Schema changes

**NONE.** No Prisma model add/modify, no migration. Erasure uses existing nullable `Event.userId`
+ the existing cascade FKs. (`./node_modules/.bin/prisma` is not invoked this cycle.)

---

## 2. API changes

### `DELETE /api/account` — **NEW** (`app/api/account/route.ts`)
- **Auth:** `auth()`; no session → `401`. Target is **always** the session user id — never read an id
  from the body (prevents an account-deletion IDOR).
- **Rate limit:** new scope `accountDelete`, keyed per authenticated user. **Fail-OPEN** — approved by
  the user 2026-06-21 as a deliberate change from research §2's "fail-closed". Rationale (documented
  here per request):
  - **Auth-gated** — the endpoint requires a valid session and acts only on the session user, so it is
    not an anonymous brute-force surface a fail-open window could be abused through.
  - **Self-destructive / idempotent** — the operation deletes the caller's own account and re-running it
    is a no-op (`deleteMany`), so a limiter outage opening the window enables nothing an attacker wants.
  - **Right-to-erasure availability** — a user must not be blocked from exercising their deletion right
    by a transient rate-limit-store (Postgres) outage; erasure availability outweighs the throttle.
  - A modest limit (`5 / hour / user`) still curbs accidental rapid re-submits. Fail-CLOSED is a
    one-line flip (`failClosed: true`) if the posture is ever reconsidered.
- **Erasure transaction** (single `prisma.$transaction([...])`, order matters):
  1. `prisma.event.updateMany({ where: { userId }, data: { userId: null } })` — scrub the orphan
     identity link (no FK enforces this).
  2. `prisma.member.deleteMany({ where: { userId } })` — remove the user's per-room rows (carries
     their `displayName`); cascades `Vote` / `WatchedMovie` / `MemberQueue` via `onDelete: Cascade`.
     **Must precede the user delete**, else `Member.userId`'s default `SetNull` orphans these rows.
  3. `prisma.user.deleteMany({ where: { id: userId } })` — `deleteMany` (not `delete`) so a
     re-delete / already-gone account is **idempotent** (no `P2025`). Cascades `Account` (Google
     tokens), `Friendship` (both relations), `UserMoviePreference`.
- **Response:** `200 { ok: true }` on success or already-deleted (idempotent). Errors → existing
  `serverError()` envelope (no internals leaked).
- **Post-delete (client side):** `DeleteAccountSection` calls `signOut({ callbackUrl: '/' })` to clear
  the JWT cookie. (Stale-JWT note: a JWT can outlive its user row; the app already tolerates this —
  `app/api/user/preferences` returns 401 and `app/profile/settings` redirects when the user is gone —
  so a deleted-user token is bounced to sign-in on the next DB-backed action. Per-request DB
  invalidation in the auth `session` callback is **out of scope** for v1, noted in research §4.)

### No other route changes.
- `lib/login-event.ts` (server-side `type:'login'` audit events) intentionally **bypasses** the
  client analytics opt-out — it is security/audit, disclosed separately in the policy.

---

## 3. Component / UI changes

### New static legal pages (non-async server components — pure JSX, renderable in jsdom for tests)
- **`app/privacy/page.tsx`** — Privacy Policy. Required sections: controller identity (Alexander Smith)
  + `[PRIVACY_CONTACT_EMAIL]`; **data we collect** (account email/displayName/passwordHash; Google
  OAuth profile + stored tokens; per-room member display names; taste data — votes/watchlist/seen;
  friends graph; **first-party analytics** — pseudonymous `anonId` + allow-listed event types, **no IP,
  no User-Agent**); **how/why** + **legal bases** (contract, legitimate interest, consent);
  **cookies & local storage** (functional session cookies + theme + anonId; analytics + **opt-out**);
  **sub-processors** (Supabase, Vercel, Google, TMDB — what each receives; **TMDB attribution**);
  **retention** (account until deletion; rooms ~24h post-expiry; events 90 days — matches
  `cron/cleanup`); **your rights** (GDPR: access/rectify/erase/port/restrict/object/withdraw/complain;
  **CCPA/CPRA**: know/delete/correct, **we do not sell or share**, non-discrimination); **how to
  exercise** (in-app deletion + email); **children** (13+); **international transfers**; **security**;
  **changes**; **contact**.
- **`app/terms/page.tsx`** — Terms of Service. Sections: acceptance; service description; **eligibility
  13+**; accounts/security; acceptable use; user content license; third-party services (**TMDB
  attribution**, streaming deep-links); disclaimers (no affiliation/endorsement); limitation of
  liability; **termination / account deletion**; **governing law — Florida, USA** + venue; changes;
  contact.
- Both modeled on `app/profile/page.tsx` layout (`<main className="min-h-screen bg-canvas text-ink …">`
  + centered container), `serif` headings, Tailwind semantic tokens. Brand via `lib/brand.ts`;
  controller / jurisdiction / contact-email via `lib/legal.ts` (no inlined identity literals).

### New components
- **`components/DeleteAccountSection.tsx`** (`'use client'`) — "Delete account" danger zone. A
  **type-to-confirm** input (must type e.g. `DELETE`) gates an otherwise-disabled button; on confirm →
  `DELETE /api/account` → on ok `signOut({ callbackUrl: '/' })`; shows error on failure. Also renders
  the email-fallback line (`[PRIVACY_CONTACT_EMAIL]`).
- **`components/AnalyticsOptOut.tsx`** (`'use client'`) — a toggle bound to the `lib/analytics.ts`
  opt-out helpers (localStorage). Reflects current state; flipping it sets/clears the flag.

### Modified components / pages
- **`components/BrandFooter.tsx`** — keep the copyright line; add `next/link` links to **`/privacy`**
  and **`/terms`** (satisfies the homepage-privacy-link requirement; BrandFooter renders on the landing
  page `app/page.tsx:289` and the results screen).
- **`app/profile/settings/page.tsx`** — render `<AnalyticsOptOut />` and `<DeleteAccountSection />`
  below `<SettingsClient/>` (settings is the auth-gated, discoverable account surface). Deletion is
  thus "readily discoverable in-app" per Google policy.
- **`app/auth/signup/page.tsx`** & **`app/auth/signin/page.tsx`** — add an at-collection consent line
  ("By continuing you agree to our Terms and Privacy Policy") linking `/terms` + `/privacy`.
- **`app/layout.tsx`** — add `metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000')`
  to `metadata` (env-driven, safe localhost fallback). Setting `NEXT_PUBLIC_SITE_URL` in prod is a
  launch prerequisite (below), not blocking dev/build.

### Library changes
- **`lib/analytics.ts`** — add `isAnalyticsOptedOut()` / `setAnalyticsOptOut(bool)` (localStorage key
  `pikflix_analytics_optout`, SSR-safe, try/catch) and an early `if (isAnalyticsOptedOut()) return` at
  the top of `track()` (suppresses `session_start` + `page_view` + all events; nothing buffers).
- **`lib/rate-limit-db.ts`** — add `accountDelete: { limit: 5, windowMs: 60 * 60_000 }` (per-user,
  fail-open) to `RATE_LIMITS`.
- **`lib/brand.ts`** — **NEW** `export const BRAND_NAME = 'PikFlix'` (+ optional tagline) so the
  working name is one-line-renameable; referenced by the new legal pages + `DeleteAccountSection`.
- **`lib/legal.ts`** — **NEW** single source of truth for legal identity + placeholder centralization
  (item 4). Exports:
  - `DATA_CONTROLLER = 'Alexander Smith'`
  - `GOVERNING_LAW = 'State of Florida, United States'`
  - `PRIVACY_CONTACT_EMAIL = '[PRIVACY_CONTACT_EMAIL]'` — **the only code-literal placeholder**; one
    find-replace at launch. Imported by `app/privacy/page.tsx`, `app/terms/page.tsx`, and
    `components/DeleteAccountSection.tsx` — **never inlined** as a duplicated string.
  - `SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? '[PROD_DOMAIN]'` — for any display copy that needs
    the domain. **`[PROD_DOMAIN]` is otherwise NOT hardcoded anywhere** — the runtime domain is the
    single `NEXT_PUBLIC_SITE_URL` env var (consumed by `layout.tsx` `metadataBase`) and the
    `AUTH_URL`/Google-console config; there are no scattered domain literals to replace.

---

## 4. Acceptance criteria & verification matrix

Every row below is an explicit, required test (incorporates the user's item-3 matrix + the item-2 host
edge cases). All four test files are already in the manifest; **no extra files needed** (signup/signin
consent is asserted inside the legal-surface test via mocked `next-auth/react` + `next/navigation`).

| # | Criterion (testable) | Test file |
|---|----------------------|-----------|
| 1 | **Unauthenticated** `DELETE /api/account` → **401** | `__tests__/api/account-delete.test.ts` |
| 2 | **Credential account** deletion → user row gone, `200 {ok:true}` | account-delete |
| 3 | **Google (OAuth) account** deletion → the user's **`Account` row(s)** (Google tokens) are deleted via cascade, `200` | account-delete |
| 4 | **`Event.userId` scrub happens BEFORE user removal** — assert `event.updateMany({userId→null})` is invoked, and its call order precedes `user.deleteMany` (array order in the single `$transaction`); event rows are **retained** with `userId=null` | account-delete |
| 5 | **`member.deleteMany({userId})` is invoked** (cascades votes/watched/queue) and **precedes** the user delete | account-delete |
| 6 | **Sole-host deletion is safe** — user who hosts an **active** room can be deleted: transaction does not throw, member rows removed, `200` (downstream host-less 403s are existing route behavior, not re-tested here) | account-delete |
| 7 | **Last-member / sole-occupant deletion is safe** — deleting the only member does not throw; `200` | account-delete |
| 8 | **Idempotent re-delete** — second `DELETE` still `200`, no `P2025` throw | account-delete |
| 9 | **Rate-limit breach → 429** with `Retry-After` (scope `accountDelete`) | account-delete |
| 10 | **Analytics opt-out suppresses tracking** — flag set ⇒ `track()` buffers/sends nothing; unset ⇒ event buffered | `__tests__/lib/analytics-optout.test.ts` |
| 11 | **Opt-out persists across reloads** — set flag, re-read `localStorage` (simulated reload) ⇒ still opted out / `track()` still no-ops | analytics-optout |
| 12 | **`/privacy` renders complete** — controller `Alexander Smith`, analytics opt-out disclosure, retention (90 days), GDPR + CCPA rights, and the `PRIVACY_CONTACT_EMAIL` constant (from `lib/legal.ts`) | `__tests__/app/legal-pages.test.tsx` |
| 13 | **`/terms` renders complete** — **`Florida`** governing law, **13+** eligibility, account-deletion/termination | legal-pages |
| 14 | **Footer links render** — `BrandFooter` has links to `/privacy` and `/terms` | legal-pages |
| 15 | **Signup consent text renders** — signup page shows the consent line linking `/privacy` + `/terms` (render with mocked `signIn`/`useRouter`; no fetch fired on render) | legal-pages |
| 16 | **Signin consent text renders** — signin page shows the consent line linking `/privacy` + `/terms` | legal-pages |
| 17 | **Delete UI gating** — `DeleteAccountSection` keeps the button **disabled until** the confirm text matches; on confirm calls `DELETE /api/account` then `signOut` | `__tests__/components/DeleteAccountSection.test.tsx` |
| 18 | **Whole suite green** — `bash scripts/verify.sh` (typecheck + lint + jest) passes; drift-free | (verify.sh) |

---

## 5. File manifest (= `.workflow_plan_files`; IMPLEMENT may touch only these)

**New (9):**
- `app/privacy/page.tsx`
- `app/terms/page.tsx`
- `app/api/account/route.ts`
- `components/DeleteAccountSection.tsx`
- `components/AnalyticsOptOut.tsx`
- `lib/brand.ts`
- `lib/legal.ts`
- `__tests__/api/account-delete.test.ts`
- `__tests__/lib/analytics-optout.test.ts`

**New tests (2 more):**
- `__tests__/components/DeleteAccountSection.test.tsx`
- `__tests__/app/legal-pages.test.tsx`

**Modify (7):**
- `components/BrandFooter.tsx`
- `app/profile/settings/page.tsx`
- `app/auth/signup/page.tsx`
- `app/auth/signin/page.tsx`
- `lib/analytics.ts`
- `lib/rate-limit-db.ts`
- `app/layout.tsx`

(PROMPTS.md + this plan doc are PLAN-state docs, not IMPLEMENT targets, so they are not in the manifest.)

---

## 6. Launch prerequisites (owner / domain-dependent — NOT IMPLEMENT-cycle code)

These are gated on the two placeholders and the production deploy; they do **not** block drafting or
implementing the pages/flow:
1. Finalize the two placeholders — both are **single-source** (item 4): set **`PRIVACY_CONTACT_EMAIL`**
   in `lib/legal.ts` (one constant), and set **`NEXT_PUBLIC_SITE_URL`** for `[PROD_DOMAIN]` (env, not a
   code literal). No repo-wide token hunt required.
2. Set **`NEXT_PUBLIC_SITE_URL`** (and **`AUTH_URL`** — overlaps WP5) in Vercel prod env.
3. Deploy so **`/privacy` + `/terms` are live on `[PROD_DOMAIN]`** (Google requires the privacy URL on
   the same domain as the homepage).
4. **Google Cloud Console:** set homepage + privacy + ToS URLs on the OAuth consent screen, verify the
   domain, publish to production → **brand/domain verification (~2–3 business days)**. Only non-sensitive
   scopes (openid/email/profile) ⇒ no security assessment.
5. (Optional follow-up) Google token **revocation** on delete; per-request JWT invalidation hardening.

---

## 7. Risks & mitigations (carried from research §4)

- **Erasure leaves PII** if `member.deleteMany` is skipped (`SetNull` orphans) or `Event.userId` not
  scrubbed → both are explicit, ordered steps in one transaction; the API test asserts both.
- **Deletion IDOR** → target derived solely from `auth()` session; never from the body.
- **Mid-room / host deletion — VERIFIED behavior (item 2, 2026-06-21 audit), documented & tested, no
  new functionality:**
  - Host is assigned **only at room creation** (`app/api/rooms/route.ts:51`); joiners are always
    `isHost:false` (`app/api/rooms/[code]/members/route.ts:57`). **No host-reassignment/transfer logic
    exists anywhere** — confirmed by scanning every `isHost` write. Ownership **never** transfers
    automatically. (We are intentionally **not** adding transfer logic.)
  - **(a) Sole host deleted from an active room → graceful, not a crash.** Host-only actions return
    **403**: start (`start/route.ts:37`), approve joiner (`approvals/route.ts:20`), requeue
    (`requeue/route.ts:43`), config PATCH (`[code]/route.ts:90`). Voting/polling/match still work. A
    LOBBY room can no longer be started; pending joiners can't be approved → the room is **inert until
    it expires**. Acceptable: erasure must not be blocked because the user hosts a live room.
  - **(b) Last member deleted → room lingers inert** (`memberCount=0`); roster/match queries key on
    `leftAt:null` + `approved:true` and handle the empty set safely (`lib/match.ts:16-20`). No throw.
  - **(c) Automatic ownership transfer:** **none** (by design).
  - **(d) Orphan cleanup makes it safe:** `expiresAt = now + 24h` (`rooms/route.ts:36`); the cron
    deletes rooms by `expiresAt` + 24h grace **alone** (`cron/cleanup/route.ts:28-30`), independent of
    host/member state → any host-less or empty room **auto-deletes within ≤48h**. It is the **only**
    room-deletion path. So no permanent orphan.
  - Our `member.deleteMany({ where:{ userId } })` **hard-deletes** (cascades votes/watched/queue),
    so the member vanishes from all `leftAt:null` queries — the intended erasure outcome. The deletion
    transaction does **not** throw when the user hosts/sole-occupies in-flight rooms.
  - **UI copy:** `DeleteAccountSection` notes that deleting removes the user from any active rooms.
- **Policy must be truthful** → retention/Sub-processor copy mirrors actual code
  (`cron/cleanup` 90-day events, ~24h room grace; no IP/UA stored).
- **Stale JWT post-delete** → client signs out immediately; app already 401s dead sessions. v1-accepted.

---

## 8. Exit

`.workflow_plan_files` written (§5). Advance to IMPLEMENT with `bash scripts/advance_state.sh next`,
then build strictly within the manifest (serial — no parallel agents through the protocol).
