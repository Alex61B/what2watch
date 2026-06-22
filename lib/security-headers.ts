// lib/security-headers.ts
// Centralized HTTP security headers for every response (WP2 / audit H4). Pure module — no secrets,
// safe to import from next.config.ts (Node config context) and from tests.
//
// CSP is shipped Report-Only FIRST (production only); the enforce flip + a per-request nonce
// middleware are a deliberate later cycle (research §6). HSTS ships WITHOUT `preload` until the
// production domain strategy is finalized (owner decision, 2026-06-22).
import { createHash } from 'node:crypto'
import { THEME_INIT_SCRIPT } from './theme-init'

/** Path of the first-party CSP violation sink (app/api/csp-report/route.ts). */
export const CSP_REPORT_PATH = '/api/csp-report'

/**
 * base64 sha256 of the exact inline theme script, formatted as a CSP `script-src` source.
 * Computed from THEME_INIT_SCRIPT — the same constant app/layout.tsx renders — so the allow-listed
 * hash can never drift from the served bytes.
 */
export const THEME_SCRIPT_HASH = `'sha256-${createHash('sha256').update(THEME_INIT_SCRIPT).digest('base64')}'`

/** Static security headers — enforced on every response in all environments. */
export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  // No `preload` (owner decision): the preload list is sticky and the domain strategy isn't final.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
]

/**
 * The Report-Only CSP, tuned to the app's real resource graph (research §3):
 *  - TMDB poster/logo images (raw <img> hit image.tmdb.org directly) → img-src
 *  - self-hosted next/font → font-src 'self' (no Google Fonts domains)
 *  - first-party /api/events analytics → connect-src 'self'
 *  - redirect-based Google OAuth (a top-level navigation, not fetch/iframe) → no external entries
 *  - the one inline theme script → allow-listed by hash
 *
 * Next's own inline bootstrap/hydration scripts will *report* (there is no nonce yet) — that
 * telemetry is intentional and will drive the enforce-phase nonce middleware in a later cycle.
 */
export function buildCspReportOnly(): string {
  return [
    `default-src 'self'`,
    `script-src 'self' ${THEME_SCRIPT_HASH}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' https://image.tmdb.org data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to csp-endpoint`,
  ].join('; ')
}

/**
 * Full header set for next.config.ts `headers()`. Static headers always; the Report-Only CSP and
 * its Reporting-Endpoints companion are added only in production — dev HMR / React Fast Refresh need
 * 'unsafe-eval' and a websocket connect-src, and we don't want dev report noise.
 */
export function securityHeaders(isProd: boolean): { key: string; value: string }[] {
  const headers = [...STATIC_SECURITY_HEADERS]
  if (isProd) {
    headers.push({ key: 'Content-Security-Policy-Report-Only', value: buildCspReportOnly() })
    headers.push({ key: 'Reporting-Endpoints', value: `csp-endpoint="${CSP_REPORT_PATH}"` })
  }
  return headers
}
