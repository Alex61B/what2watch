// app/api/friends/[friendId]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { removeFriend } from '@/lib/friends'

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
