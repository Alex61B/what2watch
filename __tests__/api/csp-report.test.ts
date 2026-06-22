/**
 * @jest-environment node
 *
 * Route tests for the CSP violation sink POST /api/csp-report (WP2 / H4). The endpoint logs
 * best-effort and must always return 204 (fail-open); non-POST is 405. console.warn is silenced.
 */
import { POST, GET } from '@/app/api/csp-report/route'

// Mirrors MAX_BODY_BYTES in the route (kept local so the test needs no extra export to import).
const MAX = 64 * 1024

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request('http://test/api/csp-report', { method: 'POST', body, headers }))

let warn: jest.SpyInstance
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

test('accepts a legacy application/csp-report body and returns 204', async () => {
  const body = JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'inline' } })
  const res = await post(body, { 'content-type': 'application/csp-report' })
  expect(res.status).toBe(204)
  expect(warn).toHaveBeenCalled()
})

test('accepts a modern application/reports+json body and returns 204', async () => {
  const body = JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'img-src' } }])
  const res = await post(body, { 'content-type': 'application/reports+json' })
  expect(res.status).toBe(204)
})

test('oversized body is dropped (still 204, fail-open) and not logged', async () => {
  const big = 'x'.repeat(MAX + 1)
  const res = await post(big, { 'content-length': String(big.length) })
  expect(res.status).toBe(204)
  expect(warn).not.toHaveBeenCalled()
})

test('empty body returns 204 without logging', async () => {
  const res = await post('')
  expect(res.status).toBe(204)
  expect(warn).not.toHaveBeenCalled()
})

test('non-POST method returns 405 with an Allow header', () => {
  const res = GET()
  expect(res.status).toBe(405)
  expect(res.headers.get('Allow')).toBe('POST')
})
