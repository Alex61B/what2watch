import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

export const SESSION_COOKIE_NAME = 'w2w_session'

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
}

export function setSessionCookie(
  response: Response,
  token: string,
  maxAgeSeconds = 60 * 60 * 24 * 7
): void {
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/`
  )
}
