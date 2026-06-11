/**
 * @jest-environment node
 *
 * Route tests for /api/user/preferences. The PUT must NOT 500 when the JWT session
 * outlives its User row (deleted account / dev DB reset) — it returns 401 so the
 * client can re-authenticate. Prisma + auth are mocked (repo convention).
 */
import { GET, PUT } from '@/app/api/user/preferences/route'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    member: { findFirst: jest.fn() },
  },
}))
jest.mock('@/auth', () => ({ auth: jest.fn() }))

const mockAuth = auth as unknown as jest.Mock
const userFindUnique = prisma.user.findUnique as jest.Mock
const userUpdateMany = prisma.user.updateMany as jest.Mock
const memberFindFirst = prisma.member.findFirst as jest.Mock

const putReq = (body: unknown) =>
  new Request('http://test/api/user/preferences', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  mockAuth.mockReset()
  userFindUnique.mockReset()
  userUpdateMany.mockReset().mockResolvedValue({ count: 1 })
  memberFindFirst.mockReset().mockResolvedValue(null)
})

describe('GET /api/user/preferences', () => {
  test('401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  test('404 when the session user no longer exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    userFindUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(404)
  })

  test('returns prefs, defaultName falling back to the account name', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    userFindUnique.mockResolvedValue({ displayName: 'Alice', savedServices: ['netflix'], savedFilters: null })
    const body = await (await GET()).json()
    expect(body).toMatchObject({ displayName: 'Alice', defaultName: 'Alice', savedServices: ['netflix'] })
  })
})

describe('PUT /api/user/preferences', () => {
  test('401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await PUT(putReq({ displayName: 'X' }))).status).toBe(401)
  })

  test('400 when the display name is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    expect((await PUT(putReq({ displayName: '   ' }))).status).toBe(400)
  })

  test('200 ok when the user exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    userUpdateMany.mockResolvedValue({ count: 1 })
    const res = await PUT(putReq({ displayName: 'Alice', savedServices: ['netflix'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('401 (NOT 500) when the session user no longer exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'gone' } })
    userUpdateMany.mockResolvedValue({ count: 0 }) // stale session — no row matched
    const res = await PUT(putReq({ displayName: 'Alice', savedServices: ['netflix'] }))
    expect(res.status).toBe(401)
  })
})
