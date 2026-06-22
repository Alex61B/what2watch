// app/api/friends/requests/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { sendFriendRequest, FriendError } from '@/lib/friends'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit-db'

const STATUS: Record<string, number> = {
  SELF: 400, USER_NOT_FOUND: 404, DUPLICATE: 409, ALREADY_FRIENDS: 409, COOLDOWN: 429,
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // M-friend: throttle outbound requests per authenticated user (not IP — the user is known).
  const rl = await checkRateLimit('friend-request', session.user.id, RATE_LIMITS.friendRequest)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSeconds)

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
