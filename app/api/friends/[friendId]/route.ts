// app/api/friends/[friendId]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { removeFriend } from '@/lib/friends'
import { areFriends, getSharedWatchlist, getSessionsTogether, getSharedYesInSession } from '@/lib/friends'
import { getCachedMovies } from '@/lib/movie-cache'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { friendId } = await params
  await removeFriend(session.user.id, friendId)
  return NextResponse.json({ ok: true })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { friendId } = await params
  const me = session.user.id

  if (!(await areFriends(me, friendId))) {
    return NextResponse.json({ error: 'Not friends' }, { status: 403 })
  }

  const friend = await prisma.user.findUnique({
    where: { id: friendId },
    select: { id: true, displayName: true, email: true },
  })
  if (!friend) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const sharedIds = await getSharedWatchlist(me, friendId)
  const sharedWatchlist = await getCachedMovies(sharedIds)

  const rooms = await getSessionsTogether(me, friendId)
  const sessions = await Promise.all(
    rooms.map(async r => ({
      roomId: r.id,
      code: r.code,
      createdAt: r.createdAt,
      sharedYesCount: (await getSharedYesInSession(me, friendId, r.id)).length,
    }))
  )

  return NextResponse.json({ friend, sharedWatchlist, sessions })
}
