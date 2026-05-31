// app/api/friends/requests/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { sendFriendRequest, FriendError } from '@/lib/friends'

const STATUS: Record<string, number> = {
  SELF: 400, USER_NOT_FOUND: 404, DUPLICATE: 409, ALREADY_FRIENDS: 409,
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (!body?.receiverId || typeof body.receiverId !== 'string') {
    return NextResponse.json({ error: 'receiverId is required' }, { status: 400 })
  }

  try {
    await sendFriendRequest(session.user.id, body.receiverId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof FriendError) {
      return NextResponse.json({ error: err.code }, { status: STATUS[err.code] ?? 400 })
    }
    throw err
  }
}
