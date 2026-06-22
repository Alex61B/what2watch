/**
 * @jest-environment node
 *
 * DELETE /api/account — self-serve account deletion / right to erasure (WP6/M9). Acts only on the
 * authenticated session user. One ordered transaction: scrub Event.userId → null, delete the user's
 * Member rows (cascades votes/watched/queue), then delete the User (cascades Account/Friendship/
 * preferences). Prisma + auth + the durable limiter are mocked (repo convention).
 */
import { DELETE } from '@/app/api/account/route'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { checkRateLimit } from '@/lib/rate-limit-db'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    event: { updateMany: jest.fn() },
    member: { deleteMany: jest.fn() },
    user: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/rate-limit-db', () => ({
  ...jest.requireActual('@/lib/rate-limit-db'),
  checkRateLimit: jest.fn(),
}))

const authMock = auth as unknown as jest.Mock
const eventUpdate = prisma.event.updateMany as jest.Mock
const memberDelete = prisma.member.deleteMany as jest.Mock
const userDelete = prisma.user.deleteMany as jest.Mock
const txn = prisma.$transaction as jest.Mock
const limitMock = checkRateLimit as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  limitMock.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
  eventUpdate.mockResolvedValue({ count: 3 })
  memberDelete.mockResolvedValue({ count: 1 })
  userDelete.mockResolvedValue({ count: 1 })
  // Run the ops array (Promise[]) so the per-table mocks are exercised, like a real $transaction.
  txn.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
})

test('401 when unauthenticated — deletes nothing', async () => {
  authMock.mockResolvedValueOnce(null)
  const res = await DELETE()
  expect(res.status).toBe(401)
  expect(txn).not.toHaveBeenCalled()
  expect(userDelete).not.toHaveBeenCalled()
})

test('429 + Retry-After when the per-user limit is hit, without deleting anything', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'u1' } })
  limitMock.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 42 })
  const res = await DELETE()
  expect(res.status).toBe(429)
  expect(res.headers.get('Retry-After')).toBe('42')
  expect(txn).not.toHaveBeenCalled()
})

test('credential account: scrubs Event.userId, deletes members, then the user — 200', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'u1' } })
  const res = await DELETE()
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(limitMock).toHaveBeenCalledWith('account-delete', 'u1', expect.objectContaining({ limit: 5 }))
  expect(eventUpdate).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { userId: null } })
  expect(memberDelete).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  expect(userDelete).toHaveBeenCalledWith({ where: { id: 'u1' } })
})

test('Event.userId is scrubbed (not deleted) BEFORE members and the user are removed', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'u1' } })
  await DELETE()
  // Events are de-identified, never deleted, so analytics aggregates survive.
  expect(eventUpdate).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { userId: null } })
  // Ordering within the single transaction array: scrub → member delete → user delete.
  const scrub = eventUpdate.mock.invocationCallOrder[0]
  const members = memberDelete.mock.invocationCallOrder[0]
  const user = userDelete.mock.invocationCallOrder[0]
  expect(scrub).toBeLessThan(members)
  expect(members).toBeLessThan(user)
})

test('Google (OAuth) account: same path removes the user, cascading the stored Google tokens — 200', async () => {
  // The route does not branch on provider; deleting the User cascades the Account row(s) that hold
  // the Google refresh/access/id tokens (FK onDelete: Cascade). We assert the user delete is issued.
  authMock.mockResolvedValueOnce({ user: { id: 'g1' } })
  const res = await DELETE()
  expect(res.status).toBe(200)
  expect(userDelete).toHaveBeenCalledWith({ where: { id: 'g1' } })
})

test('sole host of an active room can be deleted — member rows removed, no throw (200)', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'host1' } })
  memberDelete.mockResolvedValueOnce({ count: 1 }) // their host membership is hard-deleted
  const res = await DELETE()
  expect(res.status).toBe(200)
  expect(memberDelete).toHaveBeenCalledWith({ where: { userId: 'host1' } })
})

test('the only member of a room can be deleted — no throw (200)', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'solo' } })
  memberDelete.mockResolvedValueOnce({ count: 1 })
  const res = await DELETE()
  expect(res.status).toBe(200)
})

test('idempotent: re-deleting an already-gone account still returns 200 (no P2025)', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'gone' } })
  eventUpdate.mockResolvedValueOnce({ count: 0 })
  memberDelete.mockResolvedValueOnce({ count: 0 })
  userDelete.mockResolvedValueOnce({ count: 0 })
  const res = await DELETE()
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test('500 (generic, nothing leaked) when the transaction fails', async () => {
  authMock.mockResolvedValueOnce({ user: { id: 'u1' } })
  txn.mockRejectedValueOnce(new Error('db down'))
  const res = await DELETE()
  expect(res.status).toBe(500)
  expect((await res.json()).error).toBe('Internal server error')
})
