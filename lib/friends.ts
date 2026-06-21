// lib/friends.ts
import { prisma } from '@/lib/prisma'

export type FriendErrorCode =
  | 'SELF' | 'USER_NOT_FOUND' | 'DUPLICATE' | 'ALREADY_FRIENDS' | 'NOT_FOUND' | 'NOT_PENDING' | 'COOLDOWN'

/** A DECLINED request can only be re-opened after this window — bounds decline/re-send harassment. */
export const DECLINED_COOLDOWN_MS = 24 * 60 * 60 * 1000

export class FriendError extends Error {
  code: FriendErrorCode
  constructor(code: FriendErrorCode) {
    super(code)
    this.name = 'FriendError'
    this.code = code
  }
}

export interface PublicUser {
  id: string
  displayName: string
  email: string
}

const eitherDirection = (a: string, b: string) => ({
  OR: [
    { requesterId: a, receiverId: b },
    { requesterId: b, receiverId: a },
  ],
})

export async function sendFriendRequest(requesterId: string, receiverId: string, now: number = Date.now()) {
  if (requesterId === receiverId) throw new FriendError('SELF')

  const receiver = await prisma.user.findUnique({ where: { id: receiverId } })
  if (!receiver) throw new FriendError('USER_NOT_FOUND')

  const existing = await prisma.friendship.findFirst({ where: eitherDirection(requesterId, receiverId) })
  if (existing) {
    if (existing.status === 'ACCEPTED') throw new FriendError('ALREADY_FRIENDS')
    if (existing.status === 'PENDING') throw new FriendError('DUPLICATE')
    // DECLINED — re-open in the new direction, but only after the cooldown so a declined
    // requester can't immediately re-spam the person who declined them.
    if (now - existing.updatedAt.getTime() < DECLINED_COOLDOWN_MS) throw new FriendError('COOLDOWN')
    return prisma.friendship.update({
      where: { id: existing.id },
      data: { requesterId, receiverId, status: 'PENDING' },
    })
  }
  return prisma.friendship.create({ data: { requesterId, receiverId, status: 'PENDING' } })
}

export async function respondToRequest(userId: string, requestId: string, accept: boolean) {
  const req = await prisma.friendship.findUnique({ where: { id: requestId } })
  if (!req || req.receiverId !== userId) throw new FriendError('NOT_FOUND')
  if (req.status !== 'PENDING') throw new FriendError('NOT_PENDING')
  return prisma.friendship.update({
    where: { id: requestId },
    data: { status: accept ? 'ACCEPTED' : 'DECLINED' },
  })
}

export async function removeFriend(userId: string, friendId: string): Promise<void> {
  await prisma.friendship.deleteMany({ where: eitherDirection(userId, friendId) })
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const row = await prisma.friendship.findFirst({ where: eitherDirection(a, b) })
  return row?.status === 'ACCEPTED'
}

export async function listFriends(userId: string): Promise<{
  friends: PublicUser[]
  incoming: { requestId: string; user: PublicUser }[]
  outgoing: { requestId: string; user: PublicUser }[]
}> {
  const rows = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { receiverId: userId }] },
    include: {
      requester: { select: { id: true, displayName: true, email: true } },
      receiver: { select: { id: true, displayName: true, email: true } },
    },
  })

  const friends: PublicUser[] = []
  const incoming: { requestId: string; user: PublicUser }[] = []
  const outgoing: { requestId: string; user: PublicUser }[] = []

  for (const r of rows) {
    const other = r.requesterId === userId ? r.receiver : r.requester
    if (r.status === 'ACCEPTED') {
      friends.push(other)
    } else if (r.status === 'PENDING') {
      if (r.receiverId === userId) incoming.push({ requestId: r.id, user: r.requester })
      else outgoing.push({ requestId: r.id, user: r.receiver })
    }
  }
  return { friends, incoming, outgoing }
}

export async function searchUsers(query: string, excludeUserId: string): Promise<PublicUser[]> {
  const q = query.trim()
  if (!q) return []
  return prisma.user.findMany({
    where: {
      id: { not: excludeUserId },
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, displayName: true, email: true },
    take: 10,
  })
}

export async function getSharedWatchlist(a: string, b: string): Promise<string[]> {
  const [aRows, bRows] = await Promise.all([
    prisma.userMoviePreference.findMany({ where: { userId: a, type: 'WATCHLIST' }, select: { tmdbMovieId: true } }),
    prisma.userMoviePreference.findMany({ where: { userId: b, type: 'WATCHLIST' }, select: { tmdbMovieId: true } }),
  ])
  const bSet = new Set(bRows.map(r => r.tmdbMovieId))
  return [...new Set(aRows.map(r => r.tmdbMovieId).filter(id => bSet.has(id)))]
}

export async function getSessionsTogether(a: string, b: string): Promise<
  { id: string; code: string; createdAt: Date }[]
> {
  const [aMembers, bMembers] = await Promise.all([
    prisma.member.findMany({ where: { userId: a }, select: { roomId: true } }),
    prisma.member.findMany({ where: { userId: b }, select: { roomId: true } }),
  ])
  const bRoomIds = new Set(bMembers.map(m => m.roomId))
  const sharedRoomIds = [...new Set(aMembers.map(m => m.roomId).filter(id => bRoomIds.has(id)))]
  if (sharedRoomIds.length === 0) return []
  return prisma.room.findMany({
    where: { id: { in: sharedRoomIds } },
    select: { id: true, code: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getSharedYesInSession(a: string, b: string, roomId: string): Promise<string[]> {
  const [aYes, bYes] = await Promise.all([
    prisma.vote.findMany({ where: { roomId, vote: true, member: { userId: a } }, select: { tmdbMovieId: true } }),
    prisma.vote.findMany({ where: { roomId, vote: true, member: { userId: b } }, select: { tmdbMovieId: true } }),
  ])
  const bSet = new Set(bYes.map(v => v.tmdbMovieId))
  return [...new Set(aYes.map(v => v.tmdbMovieId).filter(id => bSet.has(id)))]
}
