import {
  rateLimit,
  __resetRateLimit,
  WINDOW_MS,
  MAX_REQUESTS,
  MAX_EVENTS,
} from '@/lib/rate-limit'

beforeEach(() => __resetRateLimit())

describe('rateLimit', () => {
  test('allows requests under the per-window request cap, blocks one over', () => {
    const now = 1_000_000
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect(rateLimit('k1', 1, now)).toBe(true)
    }
    expect(rateLimit('k1', 1, now)).toBe(false)
  })

  test('blocks when the event cap is exceeded in a window', () => {
    const now = 2_000_000
    expect(rateLimit('k2', MAX_EVENTS, now)).toBe(true)
    expect(rateLimit('k2', 1, now)).toBe(false)
  })

  test('resets after the window elapses', () => {
    const now = 3_000_000
    expect(rateLimit('k3', MAX_EVENTS, now)).toBe(true)
    expect(rateLimit('k3', 1, now)).toBe(false)
    expect(rateLimit('k3', 1, now + WINDOW_MS)).toBe(true)
  })

  test('keys are independent', () => {
    const now = 4_000_000
    expect(rateLimit('a', MAX_EVENTS, now)).toBe(true)
    expect(rateLimit('b', 1, now)).toBe(true)
  })
})
