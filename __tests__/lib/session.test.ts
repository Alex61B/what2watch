/** @jest-environment node */
import { NextResponse } from 'next/server'
import {
  generateSessionToken,
  sessionCookieName,
  SESSION_COOKIE_PREFIX,
  setSessionCookie,
} from '@/lib/session'

describe('generateSessionToken', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateSessionToken()).toBe('string')
    expect(generateSessionToken().length).toBeGreaterThan(0)
  })

  it('returns unique tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSessionToken))
    expect(tokens.size).toBe(100)
  })
})

describe('sessionCookieName', () => {
  it('scopes the cookie name to the room code', () => {
    expect(sessionCookieName('OVAL-32')).toBe(`${SESSION_COOKIE_PREFIX}OVAL-32`)
  })

  it('uppercases the code so casing never splits a room session', () => {
    expect(sessionCookieName('oval-32')).toBe(sessionCookieName('OVAL-32'))
  })

  it('produces distinct names for distinct rooms', () => {
    expect(sessionCookieName('AAA-11')).not.toBe(sessionCookieName('BBB-22'))
  })
})

describe('SESSION_COOKIE_PREFIX', () => {
  it('is a non-empty string', () => {
    expect(typeof SESSION_COOKIE_PREFIX).toBe('string')
    expect(SESSION_COOKIE_PREFIX.length).toBeGreaterThan(0)
  })
})

describe('setSessionCookie security attributes', () => {
  const origEnv = process.env.NODE_ENV
  const setNodeEnv = (v: string | undefined) => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = v
  }
  afterEach(() => {
    setNodeEnv(origEnv)
  })

  it('always sets HttpOnly, SameSite=Lax, and Path=/', () => {
    const res = NextResponse.json({})
    setSessionCookie(res, 'ABC-12', 'tok')
    const header = res.headers.get('set-cookie') ?? ''
    expect(header).toContain(`${sessionCookieName('ABC-12')}=tok`)
    expect(header).toMatch(/HttpOnly/i)
    expect(header).toMatch(/SameSite=Lax/i)
    expect(header).toMatch(/Path=\//i)
  })

  it('adds the Secure attribute in production', () => {
    setNodeEnv('production')
    const res = NextResponse.json({})
    setSessionCookie(res, 'ABC-12', 'tok')
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Secure/i)
  })

  it('omits Secure outside production so local http dev still works', () => {
    setNodeEnv('development')
    const res = NextResponse.json({})
    setSessionCookie(res, 'ABC-12', 'tok')
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/Secure/i)
  })
})
