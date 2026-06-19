/**
 * @jest-environment node
 *
 * Unit tests for the admin authorization layer. auth + prisma + next/navigation are
 * mocked (repo convention). `notFound()` is mocked to throw so we can assert the guard
 * rejects unauthorized callers exactly like Next would.
 */
import { getAdminEmails, isAdminEmail, requireAdmin } from '@/lib/admin'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'

jest.mock('@/auth', () => ({ auth: jest.fn(async () => null) }))
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn() } } }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

const mockAuth = auth as unknown as jest.Mock
const findUnique = prisma.user.findUnique as jest.Mock
const mockNotFound = notFound as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  process.env.ADMIN_EMAILS = 'admin@x.com'
})

describe('getAdminEmails', () => {
  test('parses, trims, lowercases, and drops empties', () => {
    process.env.ADMIN_EMAILS = ' Admin@X.com , co@Y.com ,, '
    expect(getAdminEmails()).toEqual(new Set(['admin@x.com', 'co@y.com']))
  })

  test('unset env yields an empty set', () => {
    delete process.env.ADMIN_EMAILS
    expect(getAdminEmails().size).toBe(0)
  })
})

describe('isAdminEmail', () => {
  test('matches case- and whitespace-insensitively', () => {
    process.env.ADMIN_EMAILS = 'admin@x.com'
    expect(isAdminEmail('  ADMIN@x.com ')).toBe(true)
  })
  test('null/undefined/non-member is false', () => {
    expect(isAdminEmail(null)).toBe(false)
    expect(isAdminEmail(undefined)).toBe(false)
    expect(isAdminEmail('nope@x.com')).toBe(false)
  })
})

describe('requireAdmin', () => {
  test('unauthenticated → notFound()', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
    expect(findUnique).not.toHaveBeenCalled()
  })

  test('signed-in non-admin → notFound()', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    findUnique.mockResolvedValue({ email: 'nope@x.com' })
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  test('allowlisted admin → returns identity (case/whitespace-insensitive)', async () => {
    process.env.ADMIN_EMAILS = '  Admin@X.com '
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    findUnique.mockResolvedValue({ email: 'admin@x.com' })
    await expect(requireAdmin()).resolves.toEqual({ userId: 'u1', email: 'admin@x.com' })
    expect(mockNotFound).not.toHaveBeenCalled()
    // never selects anything but email
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { email: true } })
  })

  test('empty ADMIN_EMAILS denies even a real user', async () => {
    delete process.env.ADMIN_EMAILS
    mockAuth.mockResolvedValue({ user: { id: 'u1' } })
    findUnique.mockResolvedValue({ email: 'admin@x.com' })
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
