/**
 * @jest-environment node
 *
 * Unit tests for the durable (Postgres-backed) rate limiter. The atomic upsert is
 * mocked; we assert the allow/deny decision, Retry-After, IP parsing, and the
 * fail-open behavior (a limiter outage must not take down signup/join).
 */
import { checkRateLimit, getClientIp } from '@/lib/rate-limit-db'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: jest.fn() } }))

const queryRaw = prisma.$queryRaw as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('getClientIp', () => {
  it('takes the leftmost x-forwarded-for hop', () => {
    const req = new Request('http://t', { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } })
    expect(getClientIp(req)).toBe('203.0.113.5')
  })

  it('falls back to "unknown" when the header is absent', () => {
    expect(getClientIp(new Request('http://t'))).toBe('unknown')
  })
})

describe('checkRateLimit', () => {
  const opts = { limit: 5, windowMs: 60_000 }

  it('allows when the post-increment count is within the limit', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 3 }])
    const res = await checkRateLimit('signup', 'ip:1.2.3.4', opts)
    expect(res.ok).toBe(true)
  })

  it('allows exactly at the limit', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 5 }])
    expect((await checkRateLimit('signup', 'ip:1.2.3.4', opts)).ok).toBe(true)
  })

  it('denies with a positive Retry-After once the count exceeds the limit', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 6 }])
    const res = await checkRateLimit('signup', 'ip:1.2.3.4', opts, Date.now())
    expect(res.ok).toBe(false)
    expect(res.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('fails open if the limiter query throws (availability over strictness)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    queryRaw.mockRejectedValueOnce(new Error('db down'))
    const res = await checkRateLimit('signup', 'ip:1.2.3.4', opts)
    expect(res.ok).toBe(true)
    spy.mockRestore()
  })
})
