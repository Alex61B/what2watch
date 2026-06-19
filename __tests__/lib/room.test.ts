/**
 * @jest-environment node
 *
 * Unit tests for the centralized room-expiry guard. `Room.expiresAt` is set at
 * creation but was historically never enforced; this is the single chokepoint routes
 * call after loading a room.
 */
import { roomExpired, expiredRoomResponse } from '@/lib/room'

describe('roomExpired', () => {
  it('is true when expiresAt is in the past', () => {
    expect(roomExpired({ expiresAt: new Date(Date.now() - 1_000) })).toBe(true)
  })

  it('is false when expiresAt is in the future', () => {
    expect(roomExpired({ expiresAt: new Date(Date.now() + 60_000) })).toBe(false)
  })
})

describe('expiredRoomResponse', () => {
  it('returns a 410 Gone with a generic expired message', async () => {
    const res = expiredRoomResponse()
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'This room has expired' })
  })
})
