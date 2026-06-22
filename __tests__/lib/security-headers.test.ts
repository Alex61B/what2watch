/**
 * @jest-environment node
 *
 * Unit tests for the centralized security headers (WP2 / H4). Covers the static header set
 * (including HSTS WITHOUT preload), the production-gated Report-Only CSP and its tuned directives,
 * and the anti-drift guarantee that the script-src hash matches a fresh sha256 of THEME_INIT_SCRIPT.
 */
import { createHash } from 'node:crypto'
import {
  securityHeaders,
  buildCspReportOnly,
  STATIC_SECURITY_HEADERS,
  CSP_REPORT_PATH,
} from '@/lib/security-headers'
import { THEME_INIT_SCRIPT } from '@/lib/theme-init'

const asMap = (h: { key: string; value: string }[]) => Object.fromEntries(h.map((x) => [x.key, x.value]))

test('static headers are present with the expected values', () => {
  const m = asMap(STATIC_SECURITY_HEADERS)
  expect(m['X-Content-Type-Options']).toBe('nosniff')
  expect(m['X-Frame-Options']).toBe('DENY')
  expect(m['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  expect(m['Permissions-Policy']).toContain('camera=()')
  expect(m['Permissions-Policy']).toContain('microphone=()')
  expect(m['Permissions-Policy']).toContain('geolocation=()')
})

test('HSTS is set WITHOUT preload', () => {
  const hsts = asMap(STATIC_SECURITY_HEADERS)['Strict-Transport-Security']
  expect(hsts).toContain('max-age=')
  expect(hsts).toContain('includeSubDomains')
  expect(hsts).not.toContain('preload')
})

test('non-production emits no CSP header (static headers still present)', () => {
  const m = asMap(securityHeaders(false))
  expect(m['Content-Security-Policy-Report-Only']).toBeUndefined()
  expect(m['Content-Security-Policy']).toBeUndefined()
  expect(m['X-Content-Type-Options']).toBe('nosniff')
})

test('production emits Report-Only CSP and never an enforcing CSP', () => {
  const m = asMap(securityHeaders(true))
  expect(m['Content-Security-Policy']).toBeUndefined()
  expect(typeof m['Content-Security-Policy-Report-Only']).toBe('string')
  expect(m['Reporting-Endpoints']).toBe(`csp-endpoint="${CSP_REPORT_PATH}"`)
})

test('CSP carries the tuned directives for the real resource graph', () => {
  const csp = buildCspReportOnly()
  expect(csp).toContain(`default-src 'self'`)
  expect(csp).toContain(`img-src 'self' https://image.tmdb.org data:`)
  expect(csp).toContain(`font-src 'self'`)
  expect(csp).toContain(`connect-src 'self'`)
  expect(csp).toContain(`frame-ancestors 'none'`)
  expect(csp).toContain(`object-src 'none'`)
  expect(csp).toContain(`base-uri 'self'`)
  expect(csp).toContain(`form-action 'self'`)
  expect(csp).toContain(`report-uri ${CSP_REPORT_PATH}`)
})

test('script-src allow-lists the theme script by a hash of its exact bytes (anti-drift)', () => {
  const expected = `'sha256-${createHash('sha256').update(THEME_INIT_SCRIPT).digest('base64')}'`
  expect(buildCspReportOnly()).toContain(`script-src 'self' ${expected}`)
})
