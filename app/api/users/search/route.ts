// app/api/users/search/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { searchUsers } from '@/lib/friends'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit-db'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // M2: throttle search per authenticated user (mirrors friendRequest keying), fail-open.
  const rl = await checkRateLimit('user-search', session.user.id, RATE_LIMITS.userSearch)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSeconds)

  const q = new URL(request.url).searchParams.get('q') ?? ''
  const users = await searchUsers(q, session.user.id)
  return NextResponse.json({ users })
}
