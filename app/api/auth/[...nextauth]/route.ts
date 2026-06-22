import { NextRequest, NextResponse } from 'next/server'
import { handlers } from '@/auth'
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit-db'

export const GET = handlers.GET

// H1: throttle credential login attempts by client IP BEFORE NextAuth runs bcrypt.
// Only the credentials sign-in callback (.../callback/credentials) is gated; every other
// NextAuth POST (csrf, signout, session, Google OAuth callback) delegates untouched. We never
// read the request body — NextAuth owns the stream — so the throttle key is IP only.
// `login` is failClosed (see RATE_LIMITS): a limiter DB error denies rather than opening a
// brute-force window, which is safe because login already needs the DB to look up the user.
export async function POST(request: NextRequest) {
  if (request.nextUrl.pathname.endsWith('/callback/credentials')) {
    const rl = await checkRateLimit('login', getClientIp(request), RATE_LIMITS.login)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many login attempts' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
      )
    }
  }
  return handlers.POST(request)
}
