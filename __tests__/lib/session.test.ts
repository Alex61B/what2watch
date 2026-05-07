import { generateSessionToken, SESSION_COOKIE_NAME } from '@/lib/session'

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

describe('SESSION_COOKIE_NAME', () => {
  it('is a non-empty string', () => {
    expect(typeof SESSION_COOKIE_NAME).toBe('string')
    expect(SESSION_COOKIE_NAME.length).toBeGreaterThan(0)
  })
})
