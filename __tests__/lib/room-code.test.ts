import { generateRoomCode, isValidRoomCode } from '@/lib/room-code'

describe('generateRoomCode', () => {
  it('returns a string matching WORD-DIGITS format', () => {
    const code = generateRoomCode()
    expect(code).toMatch(/^[A-Z]{4}-\d{2}$/)
  })

  it('generates unique codes across 1000 calls with high probability', () => {
    const codes = new Set(Array.from({ length: 1000 }, generateRoomCode))
    expect(codes.size).toBeGreaterThan(900)
  })
})

describe('isValidRoomCode', () => {
  it('returns true for valid codes', () => {
    expect(isValidRoomCode('XKCD-42')).toBe(true)
    expect(isValidRoomCode('ABCD-99')).toBe(true)
  })

  it('returns false for invalid codes', () => {
    expect(isValidRoomCode('')).toBe(false)
    expect(isValidRoomCode('abc-12')).toBe(false)
    expect(isValidRoomCode('ABCDE-12')).toBe(false)
    expect(isValidRoomCode('ABCD-123')).toBe(false)
  })
})
