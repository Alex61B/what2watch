/**
 * @jest-environment node
 *
 * M2 — the user-search route requires auth, throttles per authenticated user, and never returns
 * email in its results (searchUsers drops it; this guards the route contract end-to-end).
 */
import { GET as searchRoute } from '@/app/api/users/search/route'
import { auth } from '@/auth'
import { searchUsers } from '@/lib/friends'
import { checkRateLimit } from '@/lib/rate-limit-db'

jest.mock('@/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/friends', () => ({ searchUsers: jest.fn() }))
jest.mock('@/lib/rate-limit-db', () => ({
  ...jest.requireActual('@/lib/rate-limit-db'),
  checkRateLimit: jest.fn(),
}))

const authMock = auth as unknown as jest.Mock
const searchMock = searchUsers as jest.Mock
const limitMock = checkRateLimit as jest.Mock

function req(q: string) {
  return new Request(`http://test/api/users/search?q=${encodeURIComponent(q)}`)
}

beforeEach(() => {
  jest.clearAllMocks()
  limitMock.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
})

test('returns 401 when unauthenticated', async () => {
  authMock.mockResolvedValueOnce(null)
  const res = await searchRoute(req('bob'))
  expect(res.status).toBe(401)
  expect(searchMock).not.toHaveBeenCalled()
})

test('returns 429 + Retry-After when the per-user limit is hit, without running the search', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'u1' } })
  limitMock.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 17 })
  const res = await searchRoute(req('bob'))
  expect(res.status).toBe(429)
  expect(res.headers.get('Retry-After')).toBe('17')
  expect(searchMock).not.toHaveBeenCalled()
})

test('returns matching users (keyed/limited per user) and no email in the payload', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'u1' } })
  searchMock.mockResolvedValueOnce([{ id: 'b', displayName: 'Bob' }])
  const res = await searchRoute(req('bob'))
  expect(res.status).toBe(200)
  expect(limitMock).toHaveBeenCalledWith('user-search', 'u1', expect.objectContaining({ limit: 30 }))
  expect(searchMock).toHaveBeenCalledWith('bob', 'u1')
  const body = await res.json()
  expect(body.users).toEqual([{ id: 'b', displayName: 'Bob' }])
  expect(body.users.every((u: Record<string, unknown>) => !('email' in u))).toBe(true)
})
