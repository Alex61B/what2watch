/**
 * @jest-environment node
 *
 * Route tests for GET /api/health — a minimal DB-connectivity probe. Returns 200 when a
 * trivial query succeeds, 503 when it throws, and never leaks the underlying error.
 */
import { GET } from '@/app/api/health/route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: jest.fn() } }))

const queryRaw = prisma.$queryRaw as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('returns 200 ok when the database responds', async () => {
  queryRaw.mockResolvedValueOnce([{ ok: 1 }])
  const res = await GET()
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' })
})

test('returns 503 and leaks nothing when the database query throws', async () => {
  queryRaw.mockRejectedValueOnce(new Error('connection refused at 10.0.0.1'))
  const res = await GET()
  expect(res.status).toBe(503)
  const body = await res.json()
  expect(body.status).toBe('error')
  expect(JSON.stringify(body)).not.toMatch(/connection refused|10\.0\.0\.1/)
})
