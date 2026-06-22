/**
 * @jest-environment node
 *
 * Route tests for POST /api/auth/signup — covers the durable per-IP rate limit (429 +
 * Retry-After), basic validation, and the happy path. Prisma, bcrypt, and the limiter
 * are mocked.
 */
import { POST as signup } from '@/app/api/auth/signup/route'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'

jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'u1' })) } },
}))
jest.mock('@/lib/rate-limit-db', () => ({
  ...jest.requireActual('@/lib/rate-limit-db'),
  checkRateLimit: jest.fn(async () => ({ ok: true, retryAfterSeconds: 0 })),
}))
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hashed') }))

const userFindUnique = prisma.user.findUnique as jest.Mock
const userCreate = prisma.user.create as jest.Mock
const mockCheck = checkRateLimit as jest.Mock

const post = (body: unknown) =>
  signup(
    new Request('http://t/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  userFindUnique.mockResolvedValue(null)
  userCreate.mockResolvedValue({ id: 'u1' })
  mockCheck.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
})

test('creates a user with valid input', async () => {
  const res = await post({ email: 'a@b.com', displayName: 'Al', password: 'password123' })
  expect(res.status).toBe(201)
  expect(userCreate).toHaveBeenCalled()
})

test('429 with Retry-After when rate-limited, and never touches the DB', async () => {
  mockCheck.mockResolvedValue({ ok: false, retryAfterSeconds: 42 })
  const res = await post({ email: 'a@b.com', displayName: 'Al', password: 'password123' })
  expect(res.status).toBe(429)
  expect(res.headers.get('Retry-After')).toBe('42')
  expect(userCreate).not.toHaveBeenCalled()
})

test('400 on an invalid email', async () => {
  const res = await post({ email: 'not-an-email', displayName: 'Al', password: 'password123' })
  expect(res.status).toBe(400)
})

test('uses the fail-closed signup scope so a limiter outage denies rather than opens (H2)', async () => {
  await post({ email: 'a@b.com', displayName: 'Al', password: 'password123' })
  expect(mockCheck).toHaveBeenCalledWith('signup', expect.any(String), expect.objectContaining({ failClosed: true }))
})
