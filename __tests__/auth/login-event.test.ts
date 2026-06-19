/**
 * @jest-environment node
 *
 * Tests the best-effort login-event recorder used by NextAuth's `events.signIn` hook.
 * It lives in its own module (no next-auth import) so it can be unit-tested directly.
 * Critical property: a write failure must never reject — sign-in must not break.
 */
import { recordLoginEvent } from '@/lib/login-event'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({ prisma: { event: { create: jest.fn() } } }))
const create = prisma.event.create as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('writes one login event stamped with userId and provider', async () => {
  create.mockResolvedValue({})
  await recordLoginEvent({ user: { id: 'u1' }, account: { provider: 'google' } })
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0][0].data).toMatchObject({
    type: 'login',
    anonId: 'server',
    userId: 'u1',
    props: { provider: 'google' },
  })
})

test('no-ops when user.id is missing', async () => {
  await recordLoginEvent({ user: {}, account: { provider: 'google' } })
  expect(create).not.toHaveBeenCalled()
})

test('null account → provider recorded as null', async () => {
  create.mockResolvedValue({})
  await recordLoginEvent({ user: { id: 'u1' }, account: null })
  expect(create.mock.calls[0][0].data.props).toEqual({ provider: null })
})

test('swallows a write failure (never blocks sign-in)', async () => {
  create.mockRejectedValue(new Error('db down'))
  await expect(
    recordLoginEvent({ user: { id: 'u1' }, account: { provider: 'credentials' } }),
  ).resolves.toBeUndefined()
})
