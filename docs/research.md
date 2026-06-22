# RESEARCH — WP2: HTTP Security Headers & CSP Hardening (PikFlix / What2Watch)

> **State:** RESEARCH (read-only). No application code touched. This document **supersedes** the
> prior WP6 research content; WP6's durable record is `docs/plan-wp6-privacy-legal.md` +
> `docs/session-handoff-2026-06-22.md`.
> **Audit findings in scope:** **H4** (no HTTP security headers, no Content-Security-Policy) and —
> *pending the scope decision in §5* — **M4** (`lib/tmdb.ts` is not `server-only`; a client import
> pulls the TMDB fetch module into the browser bundle).
> **Source:** 2026-06-21 production-readiness audit; next code cycle per
> `session-handoff-2026-06-22.md` §4/§7 ("WP2 is the only remaining pure-code WP with zero external
> dependency").

---

## 1. Requirements Summary

**What WP2 delivers and why.** The app currently ships **no HTTP security headers and no
Content-Security-Policy** (verified: `next.config.ts` sets only `images.remotePatterns`; there is no
`middleware.ts`; a repo-wide search for `Content-Security-Policy`/`X-Frame-Options`/
`Strict-Transport-Security`/`headers()` returns nothing). Every response is therefore served with
browser defaults — no clickjacking protection, no MIME-sniff protection, no transport pinning, no
referrer control, no script/connect allow-listing. This is **audit finding H4** and the last
HTTP-layer gap after the WP1 abuse/enumeration work and the WP6 privacy work.

Two logically separable deliverables (the H4/M4 split is the central scope question — see §5):

1. **H4 — Security response headers + a phased CSP.**
   - Add the standard static security headers to **all** responses (enforced immediately, no breakage
     risk): `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options` (and/or CSP
     `frame-ancestors`), `Referrer-Policy`, `Permissions-Policy`.
   - Introduce a **Content-Security-Policy in Report-Only mode first** (see "phasing" below), tuned to
     the app's real resource graph (TMDB images, self-hosted fonts, first-party analytics), observe
     violations, then flip to enforce in a later cycle.

2. **M4 — `server-only` TMDB split** *(in scope only if the §5 decision keeps it here).*
   - Split `lib/tmdb.ts` into a server-only fetch module (add `import 'server-only'`; keep
     `tmdbFetch`/`discoverMovies`/`getMovieById`/`getWatchProviders`) and a client-safe module
     (constants/types/pure helpers: `TMDB_GENRES`, `STREAMING_SERVICES`, `DEPTH_BANDS`, `ServiceId`,
     `buildStreamingUrl`, `parseMovieResult`, `parseWatchProviders`). Repoint the 4 client importers.

**Why phase the CSP (immediate vs. report-only — the key H4 question).** A strict enforced CSP would
**break the app on contact** because:
- `app/layout.tsx:39` injects a **static inline `<script>`** (the theme-no-flash init) via
  `dangerouslySetInnerHTML`. A strict `script-src 'self'` blocks inline scripts unless they carry a
  matching **hash** or per-request **nonce**.
- Next.js App Router injects its **own inline bootstrap/hydration scripts**; a strict policy needs a
  per-request **nonce via `middleware.ts`** (which opts routes into dynamic rendering) or a blanket
  `'unsafe-inline'` (which defeats the point).
- We have **no production telemetry** on what real browsers actually request.

Therefore the safe, reversible path is: **enforce the static headers now + ship CSP as
`Content-Security-Policy-Report-Only`**, collect violation reports, then enforce in a follow-up.
Report-Only never blocks a single request, so it is safe to deploy immediately.

---

## 2. Stack Choices (leverage existing patterns)

- **Delivery mechanism — `async headers()` in `next.config.ts` (recommended for this cycle).**
  Static headers and a **static Report-Only CSP** map cleanly onto Next's `headers()` config. This is
  the smallest change, requires **no `middleware.ts`**, and does **not** opt the app out of static
  rendering. `next.config.ts` is a tracked *root application file* (per `AGENTS.md`) and is **not** on
  the "Restricted Areas" list, so it is editable under the normal PLAN→IMPLEMENT gate.
  - *Deferred to the enforce phase:* a `middleware.ts` that mints a per-request nonce. Nonces are only
    needed once we flip CSP to **enforce**; they are out of scope for a Report-Only first cycle.
- **Inline theme script:** it is **static**, so a `sha256-…` hash in `script-src` is the clean,
  nonce-free way to allow exactly it. (The hash is computed over the exact bytes of `themeInitScript`;
  computed during IMPLEMENT.)
- **CSP violation collection:** add a first-party **`app/api/csp-report/route.ts`** that accepts the
  `application/csp-report` (and `application/reports+json`) POST and logs it — mirroring the existing
  first-party `/api/events` ingest pattern (`lib/analytics.ts` → `/api/events`). Keeps reports
  in-house, no third-party collector, no new dependency. (Endpoint is a new file → belongs in the PLAN
  manifest.)
- **Apply CSP in production only.** Dev (HMR / React Fast Refresh) requires `'unsafe-eval'` and a
  `ws:`/`connect-src` websocket; gate the CSP header on `process.env.NODE_ENV === 'production'` so the
  dev server is unaffected. Static headers (HSTS etc.) can apply in all environments.
- **No new runtime dependencies.** Everything uses Next's built-in `headers()` + a plain route
  handler. (Consistent with the audit's "migration-free, dependency-free" WP cadence.)

---

## 3. Environment Verification (the app's real resource graph)

Confirmed by reading the code — the CSP must allow exactly these and nothing more:

| Resource class | Where it comes from | CSP directive implication |
|---|---|---|
| **Movie posters / provider logos** | `https://image.tmdb.org/t/p/…` — 3 raw `<img src={m.posterUrl}>` (`MovieListClient`, `SharedSessionClient`, `FriendDetailClient`) + 2 `next/image` (`VotingCard`, `MatchResult`). `next.config.ts` allow-lists `image.tmdb.org`. | `img-src 'self' https://image.tmdb.org data:` (raw `<img>` hit TMDB directly; `next/image` proxies via same-origin `/_next/image`; `data:` covers blur/placeholder URIs) |
| **Fonts** | `next/font/google` (`Inter`, `Playfair_Display`) — **self-hosted at build**, served from `/_next/static/media/*`. No runtime call to `fonts.googleapis.com`/`fonts.gstatic.com`. | `font-src 'self'` — **no Google Fonts domains needed** |
| **First-party analytics** | `lib/analytics.ts` → `sendBeacon`/`fetch('/api/events')` (same-origin). No GA/gtag/Vercel Analytics/Plausible/PostHog anywhere. | `connect-src 'self'` |
| **Google OAuth sign-in** | `auth.ts` (NextAuth 5, Google + Credentials). Sign-in is a **top-level 302 redirect** to `accounts.google.com`; NextAuth POSTs to same-origin `/api/auth/*`. **Not** a fetch, XHR, or iframe. | `form-action 'self'`, `frame-src 'none'` — **no Google domains needed**. (CSP does not govern top-level navigations.) |
| **Google avatars** | **Not rendered** — repo search for `user.image`/avatar rendering returns nothing. (If avatars are added later, `img-src` + `next.config` `remotePatterns` would need `lh3.googleusercontent.com`.) | none today |
| **Inline `<script>`** | `app/layout.tsx:39` theme-init via `dangerouslySetInnerHTML` (static). | needs `script-src` **hash** (or nonce in enforce phase) |
| **Inline styles** | Tailwind compiles to a same-origin stylesheet, but `next/font`/Next may inject inline `<style>`. | likely `style-src 'self' 'unsafe-inline'` (style nonces are impractical; confirm via Report-Only) |
| **iframes / objects / workers** | None found. | `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'` |
| **Third-party hosts (any)** | **None.** Repo search for `googleusercontent`/`youtube`/`fonts.g*`/`gtag`/`cdn.*`/`unpkg`/`jsdelivr` → no matches in `app/`, `components/`, `lib/`. | clean — no external allow-list entries |

**Proposed initial CSP (Report-Only target):**
```
default-src 'self';
script-src 'self' 'sha256-<theme-init-hash>';
style-src 'self' 'unsafe-inline';
img-src 'self' https://image.tmdb.org data:;
font-src 'self';
connect-src 'self';
frame-ancestors 'none';
frame-src 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests;
report-uri /api/csp-report; report-to csp-endpoint;
```

**Proposed static (enforced) headers:**
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` ·
`X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` ·
`Referrer-Policy: strict-origin-when-cross-origin` ·
`Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`

---

## 4. Risks & Edge Cases

- **CSP enforced too early → blank/broken app.** Mitigated: Report-Only first. Report-Only emits
  violation reports but **blocks nothing**, so it is safe to deploy. Enforce is a separate, later
  decision driven by observed reports.
- **Dev HMR breakage.** React Fast Refresh needs `'unsafe-eval'` + a websocket `connect-src`. Mitigated:
  gate the CSP header to `NODE_ENV === 'production'`.
- **Hash drift.** If the inline theme script's bytes change, its `sha256` must be regenerated or the
  script silently fails (in enforce) / reports (in Report-Only). Note in the IMPLEMENT step; keep the
  hash adjacent to the script or document the regenerate step.
- **`next/image` vs raw `<img>` for posters.** `next/image` proxies through same-origin
  `/_next/image`, but the 3 raw `<img>` load `image.tmdb.org` **directly** — so `img-src` MUST include
  `https://image.tmdb.org` (dropping it would break posters on the list/shared/friend views).
- **HSTS `preload` is sticky.** `includeSubDomains; preload` is hard to undo and affects all
  subdomains. Acceptable for a single production domain, but call it out for owner awareness; can ship
  without `preload` first if the domain strategy is unsettled.
- **`Permissions-Policy` over-restriction.** The app uses none of camera/mic/geo, so denying them is
  safe; keep the list to features we can prove unused.
- **Report endpoint as a noise/abuse sink.** `/api/csp-report` is unauthenticated by nature (browsers
  post to it). Mitigate with a body-size cap and best-effort logging (drop on error), mirroring the
  `/api/events` fail-open posture; consider reusing the existing rate-limit primitive from WP1a.
- **M4 (if in scope): no behavior change expected, but broad import churn.** The split repoints
  imports across 4 client + several server files; risk is purely mechanical (wrong import path →
  typecheck failure, caught by `verify.sh`). The secret value does **not** currently leak (see §5), so
  there is no live regression to guard against — only build-graph hygiene.

---

## 5. Assumptions & Open Questions

> **Checkpoint resolutions (owner, 2026-06-22):** Q1 → **H4 only, defer M4.** Q2/Q3 → **Report-Only
> CSP first + first-party `/api/csp-report` sink.** Recorded below.

**Q1 — WP2 scope: is M4 (the `server-only` TMDB split) in this cycle? → RESOLVED: NO (H4 only).**
- The 2026-06-21 audit/handoff bundled **H4 + M4** under "WP2 — HTTP hardening." The task framing
  ("HTTP headers / CSP hardening only") scoped WP2 down to **H4**; **M4 is deferred to its own
  follow-up cycle.**
- **Finding that informed the call:** M4 is **latent, not an active leak.** `lib/tmdb.ts` reads
  `process.env.TMDB_API_KEY` (line 88) — a **non-`NEXT_PUBLIC_`** var. Next.js **does not inline**
  non-public env into client bundles; it substitutes `undefined`. So when `components/FilterControls.tsx`
  imports the *value* `TMDB_GENRES` and drags the module in, the **key value never reaches the
  browser** — only dead fetch/`Authorization`-header code does. The real win of `import 'server-only'`
  is turning any *future* mistaken client import into a **build error** (defense-in-depth + bundle
  hygiene), not closing a live hole — which is why deferring it is safe.

**Q2 — CSP enforcement posture → RESOLVED: Report-Only first.** Ship
`Content-Security-Policy-Report-Only` via `next.config.ts` `headers()`, gated to production. The
**enforce** flip + any nonce `middleware.ts` are deferred to a later cycle once reports are observed.

**Q3 — CSP report sink → RESOLVED: yes.** Add a first-party `app/api/csp-report/route.ts` (mirrors
`/api/events`) to capture violations from real users.

**OPEN QUESTION 4 — HSTS `preload` (still open, owner-facing).** Assumption: include
`includeSubDomains; preload`. If the production domain / subdomain strategy is unsettled, ship without
`preload` first. Overlaps the WP5/WP6 domain prerequisites; can be confirmed at PLAN time.

**Standing assumptions:** production is HTTPS (Vercel) so HSTS is meaningful; the production domain is
single-host; no third-party embeds/scripts will be added within this cycle.

---

## 6. Out of Scope

- **Flipping CSP to enforce** and the **per-request nonce `middleware.ts`** it requires — deferred to a
  follow-up cycle after Report-Only telemetry.
- **WP3 (Sentry/observability), WP5 (env fail-fast), WP7 (runbooks/backups), WP8 (`next` 16).**
- **Any auth/session change** (`auth.ts`, `app/api/auth/`) — restricted; the CSP is tuned *around* the
  existing OAuth redirect flow, not modifying it.
- **`next.config.ts` `images.remotePatterns`** changes (e.g., adding `lh3.googleusercontent.com`) —
  only needed if Google avatars are introduced, which they are not.
- **New dependencies / migrations.**
- **M4 (TMDB split) — OUT OF SCOPE** (per the Q1 resolution above; deferred to its own follow-up cycle).

---

## 7. Readiness Verdict: READY FOR PLANNING

The HTTP-layer surface is fully mapped: the app has **zero** security headers/CSP today; its real
resource graph is **TMDB images + self-hosted fonts + first-party `/api/events` analytics + a
redirect-based Google OAuth flow + one static inline theme script**, with **no third-party hosts**. The
technical approach is settled and low-risk: **enforce static headers immediately + ship CSP
Report-Only via `next.config.ts`**, with a first-party `/api/csp-report` sink, gated to production.

**Confirmed scope for WP2 (this cycle): H4 only** — static security headers (enforced) + a
**Report-Only** CSP via `next.config.ts`, plus a first-party `app/api/csp-report/route.ts` sink, all
gated to production. **M4 is deferred.** Anticipated `.workflow_plan_files` manifest (for PLAN):
`next.config.ts` (headers + Report-Only CSP) and `app/api/csp-report/route.ts` (new), plus a test
(`__tests__/...`) asserting the headers/CSP are present.

**The cycle remains paused at the PLAN approval checkpoint.** The scope decision is made, but per the
instruction no PLAN/IMPLEMENT work proceeds until the owner gives the go-ahead to enter PLAN
(`/plan` / `bash scripts/advance_state.sh next`). No application code has been written.
