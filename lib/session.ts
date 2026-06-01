import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import type { NextResponse } from 'next/server'

// Room sessions are scoped per room: each room a browser participates in gets
// its own cookie named `w2w_session_<CODE>`. This lets one browser hold several
// room memberships at once and guarantees a poll for room X only ever resolves
// the member that joined room X.
export const SESSION_COOKIE_PREFIX = 'w2w_session_'

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

/** Cookie name carrying the session token for a single room code. */
export function sessionCookieName(code: string): string {
  return `${SESSION_COOKIE_PREFIX}${code.toUpperCase()}`
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/** Read the session token for a specific room (null if the browser hasn't joined it). */
export async function getSessionToken(code: string): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(sessionCookieName(code))?.value ?? null
}

/** Every room session token the browser currently holds (used for account linking). */
export async function getAllSessionTokens(): Promise<string[]> {
  const cookieStore = await cookies()
  return cookieStore
    .getAll()
    .filter((c) => c.name.startsWith(SESSION_COOKIE_PREFIX))
    .map((c) => c.value)
    .filter((v): v is string => Boolean(v))
}

/** Set the per-room session cookie on a response. */
export function setSessionCookie(
  response: NextResponse,
  code: string,
  token: string,
  maxAgeSeconds = COOKIE_MAX_AGE_SECONDS
): void {
  response.cookies.set(sessionCookieName(code), token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: maxAgeSeconds,
    path: '/',
  })
}

/** Clear a stale per-room session cookie. */
export function clearSessionCookie(response: NextResponse, code: string): void {
  response.cookies.set(sessionCookieName(code), '', { path: '/', maxAge: 0 })
}
