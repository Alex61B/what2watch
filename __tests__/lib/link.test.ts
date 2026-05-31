// __tests__/lib/link.test.ts
import { resolveMemberUserId } from '@/lib/link'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

jest.mock('@/lib/prisma', () => ({ prisma: { member: { update: jest.fn() } } }))
jest.mock('@/auth', () => ({ auth: jest.fn() }))

const update = prisma.member.update as jest.Mock
const mockAuth = auth as unknown as jest.Mock

describe('resolveMemberUserId', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the existing userId without touching auth', async () => {
    const id = await resolveMemberUserId({ id: 'm1', userId: 'user-1' })
    expect(id).toBe('user-1')
    expect(mockAuth).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('links the member and returns the id when a session exists', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-9' } })
    update.mockResolvedValueOnce({})
    const id = await resolveMemberUserId({ id: 'm1', userId: null })
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { userId: 'user-9' } })
    expect(id).toBe('user-9')
  })

  it('returns null when the member is anonymous and no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const id = await resolveMemberUserId({ id: 'm1', userId: null })
    expect(id).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })
})
