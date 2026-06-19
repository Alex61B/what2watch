/**
 * @jest-environment node
 *
 * Access-control tests for the /admin pages. requireAdmin + the query layer are mocked.
 * The key security property: every page awaits requireAdmin() BEFORE any data query, so a
 * non-admin (for whom requireAdmin throws notFound) never reaches the database.
 */
import AdminOverviewPage from '@/app/admin/page'
import AdminUsersPage from '@/app/admin/users/page'
import AdminUserDetailPage from '@/app/admin/users/[id]/page'
import AdminEventsPage from '@/app/admin/events/page'
import { requireAdmin } from '@/lib/admin'
import * as queries from '@/lib/admin-queries'

jest.mock('@/lib/admin', () => ({ requireAdmin: jest.fn() }))
jest.mock('@/lib/admin-queries', () => ({
  getOverviewMetrics: jest.fn(),
  getActiveUsersByDay: jest.fn(),
  listUsers: jest.fn(),
  getUserDetail: jest.fn(),
  listUserEvents: jest.fn(),
  listEvents: jest.fn(),
}))

const mockRequireAdmin = requireAdmin as jest.Mock
const DENIED = new Error('NEXT_NOT_FOUND')

beforeEach(() => jest.clearAllMocks())

describe('unauthorized access is blocked before any query', () => {
  beforeEach(() => mockRequireAdmin.mockRejectedValue(DENIED))

  test('overview', async () => {
    await expect(AdminOverviewPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(queries.getOverviewMetrics).not.toHaveBeenCalled()
  })

  test('users list', async () => {
    await expect(AdminUsersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(queries.listUsers).not.toHaveBeenCalled()
  })

  test('user detail', async () => {
    await expect(
      AdminUserDetailPage({ params: Promise.resolve({ id: 'u1' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(queries.getUserDetail).not.toHaveBeenCalled()
  })

  test('events feed', async () => {
    await expect(AdminEventsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(queries.listEvents).not.toHaveBeenCalled()
  })
})

describe('admin access loads data', () => {
  test('overview renders after requireAdmin resolves', async () => {
    mockRequireAdmin.mockResolvedValue({ userId: 'u1', email: 'admin@x.com' })
    ;(queries.getOverviewMetrics as jest.Mock).mockResolvedValue({
      totalUsers: 1, newUsers7d: 0, newUsers30d: 0, totalEvents: 0,
      dau: 0, wau: 0, loggedInEvents7d: 0, anonEvents7d: 0,
      funnel7d: { room_created: 0, room_started: 0, room_matched: 0 },
    })
    ;(queries.getActiveUsersByDay as jest.Mock).mockResolvedValue([])

    const el = await AdminOverviewPage()
    expect(el).toBeTruthy()
    expect(mockRequireAdmin).toHaveBeenCalled()
    expect(queries.getOverviewMetrics).toHaveBeenCalled()
  })
})
