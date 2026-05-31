// app/api/friends/[friendId]/sessions/[roomId]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { areFriends, getSharedYesInSession } from '@/lib/friends'
import { getCachedMovies } from '@/lib/movie-cache'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ friendId: string; roomId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { friendId, roomId } = await params
  const me = session.user.id

  if (!(await areFriends(me, friendId))) {
    return NextResponse.json({ error: 'Not friends' }, { status: 403 })
  }

  const ids = await getSharedYesInSession(me, friendId, roomId)
  const movies = await getCachedMovies(ids)
  return NextResponse.json({ movies })
}
