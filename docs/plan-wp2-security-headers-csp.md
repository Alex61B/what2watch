# PLAN — WP2: HTTP Security Headers & CSP Hardening (H4)

> **State:** PLAN. Branch `feat/wp2-security-headers-csp` off `main` @ `9ec1fcd`.
> **Scope (owner-approved 2026-06-22):** H4 only — **enforced static security headers immediately** +
> **CSP Report-Only first** + **first-party `/api/csp-report` sink**. **M4 (server-only TMDB split) is
> deferred** to its own cycle. **HSTS ships without `preload`** (domain strategy not finalized).
> Research record: `docs/research.md`.
> **No application code is written in this state.** This document + `.workflow_plan_files` are the PLAN
> deliverables; IMPLEMENT begins only after the owner approves this plan.

---

## Design overview

Two response-layer changes, wired through one small pure module:

1. **Static security headers** (enforced, all environments) and a **`Content-Security-Policy-Report-Only`**
   header (production only) are emitted for **every route** via `async headers()` in `next.config.ts`.
2. A **first-party `app/api/csp-report/route.ts`** receives violation reports (both legacy
   `report-uri` and modern Reporting-API formats), logs them best-effort, and returns `204`.

**Anti-drift hash design.** The one inline `<script>` (theme no-flash init, `app/layout.tsx:29`) is
extracted to a single shared constant `THEME_INIT_SCRIPT` (`lib/theme-init.ts`). Both `app/layout.tsx`
(renders it) and `lib/security-headers.ts` (hashes it for `script-src`) import that one source, so the
CSP `sha256` is **computed dynamically from the exact bytes that are rendered** — eliminating the
hash-drift risk flagged in research §4. No hardcoded hash.

**Why `next.config.ts` `headers()` and not `middleware.ts`:** Report-Only needs no per-request nonce,
so static config delivery is the smallest change and keeps routes statically rendered. A nonce
`middleware.ts` is only needed for the *enforce* flip (a later cycle) and is explicitly out of scope.

**Production gating:** the CSP header is emitted only when `process.env.NODE_ENV === 'production'` (dev
HMR/Fast-Refresh needs `'unsafe-eval'`/`ws:`; we don't want dev report noise). Static headers apply in
all environments (HSTS over http://localhost is simply ignored by browsers).

---

## File manifest (`.workflow_plan_files`)

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `lib/theme-init.ts` | **create** | Single source of truth: `export const THEME_INIT_SCRIPT` (the exact inline theme bootstrap string). |
| 2 | `lib/security-headers.ts` | **create** | Pure module. `STATIC_SECURITY_HEADERS` (HSTS no-preload, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy); `CSP_REPORT_PATH = '/api/csp-report'`; `buildCspReportOnly()` (assembles the directive string incl. the dynamically computed `'sha256-…'` of `THEME_INIT_SCRIPT` via `node:crypto`); `securityHeaders(isProd: boolean)` returning the full `{key,value}[]` (adds `Content-Security-Policy-Report-Only` + `Reporting-Endpoints` only when `isProd`). No secrets, no `server-only`. |
| 3 | `next.config.ts` | **modify** | Add `async headers()` returning `[{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV === 'production') }]`. Keep existing `images.remotePatterns`. |
| 4 | `app/layout.tsx` | **modify** | Replace the local `themeInitScript` const with `import { THEME_INIT_SCRIPT } from '@/lib/theme-init'`; render `dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}`. No behavior change. |
| 5 | `app/api/csp-report/route.ts` | **create** | `POST` handler: read body with a size cap, best-effort `console.warn('[csp-report] …')` (truncated), return `204`; fail-open (any error still `204`). Non-POST → `405`. `export const runtime = 'nodejs'`; no auth, no DB. |
| 6 | `__tests__/lib/security-headers.test.ts` | **create** | Unit tests for the header logic (see Acceptance). |
| 7 | `__tests__/api/csp-report.test.ts` | **create** | Route-handler tests for the sink (see Acceptance). |

No other files. No new dependencies. No Prisma/schema changes.

---

## Schema changes
**None.** No Prisma models added or modified; no migration.

---

## API changes

**`POST /api/csp-report`** (new, public, unauthenticated by design — browsers post here):
- **Accepts:** `application/csp-report` (`{ "csp-report": {…} }`) and `application/reports+json`
  (`[{ "type": "csp-violation", "body": {…} }]`). Body read as text, capped at **64 KB**; oversized or
  unparseable bodies are dropped (not an error).
- **Side effect:** one truncated `console.warn` line per report (Vercel runtime logs). No persistence,
  **no DB write, no rate-limit** — deliberately: the endpoint does no expensive work and stores
  nothing, so coupling it to the DB/rate-limiter would add risk without benefit. The size cap +
  truncation bound the log-spam surface. *(Documented tradeoff; revisit only if logs prove noisy.)*
- **Returns:** `204 No Content` on success **and on any internal error** (fail-open — never error a
  browser's beacon). **`405`** for any non-POST method.

No changes to any existing route. Auth, sessions, and the OAuth flow are untouched.

---

## Component changes

- **`app/layout.tsx`** — sole UI-adjacent change: source the inline theme script from the shared
  `THEME_INIT_SCRIPT` constant instead of a local literal. Rendered output is byte-identical, so the
  theme no-flash behavior is unchanged and the CSP hash matches exactly. No other component changes.

---

## Header values (exact, to implement)

**Static (enforced, all routes, all envs):**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains      # NO preload (per owner)
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

**Production only — `Content-Security-Policy-Report-Only`:**
```
default-src 'self';
script-src 'self' 'sha256-<computed from THEME_INIT_SCRIPT>';
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
report-uri /api/csp-report;
report-to csp-endpoint
```
plus (production only) `Reporting-Endpoints: csp-endpoint="/api/csp-report"` so the modern Reporting
API delivers to the same sink.

> **Expected Report-Only telemetry:** Next's own inline bootstrap/hydration scripts will generate
> `script-src` violation *reports* (no nonce yet) — this is intended; it is exactly the data the
> enforce-phase nonce middleware will be designed against. The theme script will **not** report
> (its hash is allow-listed).

---

## Acceptance criteria (one testable criterion per feature)

1. **Static headers present & correct** — `securityHeaders(false)` returns entries for all five static
   headers with the exact values above; **HSTS contains no `preload`**; CSP is absent in non-prod.
2. **CSP Report-Only in prod** — `securityHeaders(true)` includes a `Content-Security-Policy-Report-Only`
   (and **no** enforcing `Content-Security-Policy`) whose value contains: `default-src 'self'`,
   `img-src` with `https://image.tmdb.org` and `data:`, `font-src 'self'`, `connect-src 'self'`,
   `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
   `report-uri /api/csp-report`, and a `script-src` containing the `sha256` hash recomputed from
   `THEME_INIT_SCRIPT` (test recomputes and asserts membership — proves the anti-drift wiring).
3. **CSP report sink** — `POST /api/csp-report` with an `application/csp-report` body → `204`; with an
   `application/reports+json` body → `204`; with an oversized (>64 KB) or invalid body → still `204`
   (fail-open); `GET /api/csp-report` → `405`.

**Manual integration check (TEST phase, non-blocking for unit suite):** `next build && next start`,
then `curl -sI http://localhost:3000/` shows the five static headers, and a prod-mode response carries
`Content-Security-Policy-Report-Only`. (Automated header emission isn't unit-testable without a running
server; the unit tests cover the header *source of truth* and the build proves the wiring.)

---

## Verification (TEST phase)
`bash scripts/verify.sh` → `npm run typecheck` + `npm run lint` + `npm test` must all pass. New tests
(items 6–7) join the existing suite (handoff baseline: 334 tests / 54 suites) with **no regressions**.

---

## Out of scope (per research §6)
- CSP **enforce** flip and the per-request **nonce `middleware.ts`** it requires (later cycle).
- **M4** TMDB `server-only` split (deferred to its own cycle).
- HSTS **`preload`** (excluded per owner until domain strategy is finalized; `includeSubDomains` kept —
  drop it too if any subdomain won't be HTTPS).
- Adding `lh3.googleusercontent.com` to `img-src`/`remotePatterns` (no Google avatars rendered).
- Any auth/session change; any new dependency or migration.
