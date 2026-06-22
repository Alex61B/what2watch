/**
 * @jest-environment node
 *
 * H1: the [...nextauth] route wraps NextAuth's POST to throttle credential login attempts by
 * client IP. Only the .../callback/credentials path is gated; every other NextAuth POST passes
 * straight through. NextAuth's handlers and the limiter are mocked.
 */
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/[...nextauth]/route'
import { handlers } from '@/auth'
import { checkRateLimit } from '@/lib/rate-limit-db'

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/auth', () => ({
  handlers: {
    GET: jest.fn(),
    POST: jest.fn(async () => new Response('delegated', { status: 200 })),
  },
}))
jest.mock('@/lib/rate-limit-db', () => ({
  ...jest.requireActual('@/lib/rate-limit-db'),
  checkRateLimit: jest.fn(async () => ({ ok: true, retryAfterSeconds: 0 })),
}))

const delegate = handlers.POST as jest.Mock
const post = (path: string) => POST(new NextRequest(`http://test${path}`, { method: 'POST' }))

beforeEach(() => {
  delegate.mockClear()
  ;(checkRateLimit as jest.Mock).mockClear()
  ;(checkRateLimit as jest.Mock).mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
})

test('throttles the credentials callback with 429 (before delegating to NextAuth)', async () => {
  ;(checkRateLimit as jest.Mock).mockResolvedValueOnce({ ok: false, retryAfterSeconds: 60 })
  const res = await post('/api/auth/callback/credentials')
  expect(res.status).toBe(429)
  expect(res.headers.get('Retry-After')).toBe('60')
  expect(delegate).not.toHaveBeenCalled()
})

test('delegates the credentials callback to NextAuth when under the limit', async () => {
  const res = await post('/api/auth/callback/credentials')
  expect(checkRateLimit).toHaveBeenCalledWith('login', expect.any(String), expect.objectContaining({ failClosed: true }))
  expect(delegate).toHaveBeenCalledTimes(1)
  expect(res.status).toBe(200)
})

test('never throttles non-credentials NextAuth POSTs', async () => {
  ;(checkRateLimit as jest.Mock).mockResolvedValue({ ok: false, retryAfterSeconds: 60 })
  const res = await post('/api/auth/session')
  expect(checkRateLimit).not.toHaveBeenCalled()
  expect(delegate).toHaveBeenCalledTimes(1)
  expect(res.status).toBe(200)
})
