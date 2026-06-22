/**
 * WP6 — first-party analytics opt-out. When opted out, track() drops events entirely (nothing is
 * buffered or sent). The preference is stored in localStorage and persists across reloads.
 * jsdom has no fetch and no sendBeacon, so flush() falls through to fetch (which we spy on).
 */
import { track, isAnalyticsOptedOut, setAnalyticsOptOut } from '@/lib/analytics'

const OPTOUT_KEY = 'pikflix_analytics_optout'

beforeEach(() => {
  localStorage.clear()
  jest.useFakeTimers()
  global.fetch = jest.fn(() => Promise.resolve({ ok: true } as Response)) as unknown as typeof fetch
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test('default (not opted out): track() sends an event to /api/events', () => {
  expect(isAnalyticsOptedOut()).toBe(false)
  track('page_view', { path: '/x' })
  jest.runAllTimers() // fire the scheduled flush
  expect(global.fetch).toHaveBeenCalledWith('/api/events', expect.objectContaining({ method: 'POST' }))
})

test('opted out: track() sends nothing', () => {
  setAnalyticsOptOut(true)
  expect(isAnalyticsOptedOut()).toBe(true)
  track('page_view', { path: '/x' })
  jest.runAllTimers()
  expect(global.fetch).not.toHaveBeenCalled()
})

test('re-enabling clears the flag and resumes sending', () => {
  setAnalyticsOptOut(true)
  setAnalyticsOptOut(false)
  expect(isAnalyticsOptedOut()).toBe(false)
  track('feature_used', { feature: 'share_link' })
  jest.runAllTimers()
  expect(global.fetch).toHaveBeenCalled()
})

test('opt-out persists in localStorage and survives a reload', () => {
  setAnalyticsOptOut(true)
  expect(localStorage.getItem(OPTOUT_KEY)).toBe('1')
  // Simulate a page reload: drop the module registry; localStorage lives on window and persists.
  jest.resetModules()
  const reloaded = require('@/lib/analytics') as typeof import('@/lib/analytics')
  expect(reloaded.isAnalyticsOptedOut()).toBe(true)
  reloaded.track('page_view', { path: '/y' })
  jest.runAllTimers()
  expect(global.fetch).not.toHaveBeenCalled()
})
