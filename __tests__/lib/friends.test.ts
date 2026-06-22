// __tests__/lib/friends.test.ts
import {
  sendFriendRequest, respondToRequest, removeFriend, areFriends,
  listFriends, searchUsers, getSharedWatchlist, getSessionsTogether, getSharedYesInSession,
  DECLINED_COOLDOWN_MS,
} from '@/lib/friends'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    friendship: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    member: { findMany: jest.fn() },
    room: { findMany: jest.fn() },
    vote: { findMany: jest.fn() },
    userMoviePreference: { findMany: jest.fn() },
  },
}))

const u = prisma.user as unknown as { findUnique: jest.Mock; findMany: jest.Mock }
const f = prisma.friendship as unknown as Record<string, jest.Mock>
const member = prisma.member.findMany as jest.Mock
const room = prisma.room.findMany as jest.Mock
const vote = prisma.vote.findMany as jest.Mock
const pref = prisma.userMoviePreference.findMany as jest.Mock

describe('friends', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sendFriendRequest throws SELF when requester === receiver', async () => {
    await expect(sendFriendRequest('a', 'a')).rejects.toMatchObject({ code: 'SELF' })
  })

  it('sendFriendRequest throws USER_NOT_FOUND when receiver does not exist', async () => {
    u.findUnique.mockResolvedValueOnce(null)
    await expect(sendFriendRequest('a', 'b')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
  })

  it('sendFriendRequest throws DUPLICATE when a pending request exists', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    f.findFirst.mockResolvedValueOnce({ id: 'r1', requesterId: 'a', receiverId: 'b', status: 'PENDING' })
    await expect(sendFriendRequest('a', 'b')).rejects.toMatchObject({ code: 'DUPLICATE' })
  })

  it('sendFriendRequest throws ALREADY_FRIENDS when accepted', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    f.findFirst.mockResolvedValueOnce({ id: 'r1', requesterId: 'b', receiverId: 'a', status: 'ACCEPTED' })
    await expect(sendFriendRequest('a', 'b')).rejects.toMatchObject({ code: 'ALREADY_FRIENDS' })
  })

  it('sendFriendRequest re-opens a DECLINED row in the new direction once the cooldown has elapsed', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    const declinedAt = new Date('2026-01-01T00:00:00Z')
    f.findFirst.mockResolvedValueOnce({ id: 'r1', requesterId: 'b', receiverId: 'a', status: 'DECLINED', updatedAt: declinedAt })
    f.update.mockResolvedValueOnce({})
    await sendFriendRequest('a', 'b', declinedAt.getTime() + DECLINED_COOLDOWN_MS + 1)
    expect(f.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { requesterId: 'a', receiverId: 'b', status: 'PENDING' } })
  })

  it('sendFriendRequest throws COOLDOWN when re-opening a DECLINED row too soon (M-friend)', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    const declinedAt = new Date('2026-01-01T00:00:00Z')
    f.findFirst.mockResolvedValueOnce({ id: 'r1', requesterId: 'b', receiverId: 'a', status: 'DECLINED', updatedAt: declinedAt })
    await expect(sendFriendRequest('a', 'b', declinedAt.getTime() + 1_000)).rejects.toMatchObject({ code: 'COOLDOWN' })
    expect(f.update).not.toHaveBeenCalled()
  })

  it('sendFriendRequest creates a new pending request when none exists', async () => {
    u.findUnique.mockResolvedValueOnce({ id: 'b' })
    f.findFirst.mockResolvedValueOnce(null)
    f.create.mockResolvedValueOnce({})
    await sendFriendRequest('a', 'b')
    expect(f.create).toHaveBeenCalledWith({ data: { requesterId: 'a', receiverId: 'b', status: 'PENDING' } })
  })

  it('respondToRequest rejects when the responder is not the receiver', async () => {
    f.findUnique.mockResolvedValueOnce({ id: 'r1', receiverId: 'someone-else', status: 'PENDING' })
    await expect(respondToRequest('a', 'r1', true)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('respondToRequest accepts a pending request addressed to the user', async () => {
    f.findUnique.mockResolvedValueOnce({ id: 'r1', receiverId: 'a', status: 'PENDING' })
    f.update.mockResolvedValueOnce({})
    await respondToRequest('a', 'r1', true)
    expect(f.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'ACCEPTED' } })
  })

  it('removeFriend deletes the friendship in either direction', async () => {
    f.deleteMany.mockResolvedValueOnce({ count: 1 })
    await removeFriend('a', 'b')
    expect(f.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ requesterId: 'a', receiverId: 'b' }, { requesterId: 'b', receiverId: 'a' }] },
    })
  })

  it('areFriends returns true only for an ACCEPTED row', async () => {
    f.findFirst.mockResolvedValueOnce({ status: 'ACCEPTED' })
    expect(await areFriends('a', 'b')).toBe(true)
    f.findFirst.mockResolvedValueOnce(null)
    expect(await areFriends('a', 'b')).toBe(false)
  })

  it('listFriends splits accepted / incoming / outgoing relative to the user', async () => {
    f.findMany.mockResolvedValueOnce([
      { id: 'r1', requesterId: 'a', receiverId: 'b', status: 'ACCEPTED', requester: { id: 'a' }, receiver: { id: 'b', displayName: 'Bob', email: 'b@x' } },
      { id: 'r2', requesterId: 'c', receiverId: 'a', status: 'PENDING', requester: { id: 'c', displayName: 'Cara', email: 'c@x' }, receiver: { id: 'a' } },
      { id: 'r3', requesterId: 'a', receiverId: 'd', status: 'PENDING', requester: { id: 'a' }, receiver: { id: 'd', displayName: 'Dee', email: 'd@x' } },
    ])
    const { friends, incoming, outgoing } = await listFriends('a')
    expect(friends).toEqual([{ id: 'b', displayName: 'Bob', email: 'b@x' }])
    expect(incoming).toEqual([{ requestId: 'r2', user: { id: 'c', displayName: 'Cara', email: 'c@x' } }])
    expect(outgoing).toEqual([{ requestId: 'r3', user: { id: 'd', displayName: 'Dee', email: 'd@x' } }])
  })

  it('searchUsers returns [] for blank or single-char queries without hitting the DB (M2 min length)', async () => {
    expect(await searchUsers('   ', 'a')).toEqual([])
    expect(await searchUsers('b', 'a')).toEqual([])
    expect(u.findMany).not.toHaveBeenCalled()
  })

  it('searchUsers matches email exactly + name as substring, excludes the caller, and never returns email (M2)', async () => {
    u.findMany.mockResolvedValueOnce([{ id: 'b', displayName: 'Bob' }])
    const rows = await searchUsers('bob', 'a')
    expect(u.findMany).toHaveBeenCalledWith({
      where: { id: { not: 'a' }, OR: [{ email: { equals: 'bob', mode: 'insensitive' } }, { displayName: { contains: 'bob', mode: 'insensitive' } }] },
      select: { id: true, displayName: true },
      take: 10,
    })
    expect(rows).toEqual([{ id: 'b', displayName: 'Bob' }])
  })

  it('getSharedWatchlist intersects both users WATCHLIST entries', async () => {
    pref.mockResolvedValueOnce([{ tmdbMovieId: '1' }, { tmdbMovieId: '2' }])
    pref.mockResolvedValueOnce([{ tmdbMovieId: '2' }, { tmdbMovieId: '3' }])
    expect(await getSharedWatchlist('a', 'b')).toEqual(['2'])
  })

  it('getSessionsTogether returns rooms where both users have a member', async () => {
    member.mockResolvedValueOnce([{ roomId: 'r1' }, { roomId: 'r2' }])
    member.mockResolvedValueOnce([{ roomId: 'r2' }, { roomId: 'r3' }])
    room.mockResolvedValueOnce([{ id: 'r2', code: 'BOLD-42', createdAt: new Date(0) }])
    const sessions = await getSessionsTogether('a', 'b')
    expect(room).toHaveBeenCalledWith({ where: { id: { in: ['r2'] } }, select: { id: true, code: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
    expect(sessions).toEqual([{ id: 'r2', code: 'BOLD-42', createdAt: new Date(0) }])
  })

  it('getSharedYesInSession intersects both users yes-votes in a room', async () => {
    vote.mockResolvedValueOnce([{ tmdbMovieId: '1' }, { tmdbMovieId: '2' }])
    vote.mockResolvedValueOnce([{ tmdbMovieId: '2' }])
    expect(await getSharedYesInSession('a', 'b', 'r2')).toEqual(['2'])
    expect(vote).toHaveBeenCalledWith({ where: { roomId: 'r2', vote: true, member: { userId: 'a' } }, select: { tmdbMovieId: true } })
  })
})
