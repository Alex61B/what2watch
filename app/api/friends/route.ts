// app/api/friends/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { listFriends } from '@/lib/friends'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { friends, incoming, outgoing } = await listFriends(session.user.id)
  return NextResponse.json({ friends, incoming, outgoing })
}
