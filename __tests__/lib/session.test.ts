import {
  generateSessionToken,
  sessionCookieName,
  SESSION_COOKIE_PREFIX,
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
