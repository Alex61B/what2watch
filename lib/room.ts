// lib/room.ts
// Centralized room-expiry guard. `Room.expiresAt` is set ~24h out at creation; this is
// the single chokepoint every room-scoped route calls right after it loads the room, so
// the rule lives in one place instead of being duplicated (or forgotten) per route.
import { NextResponse } from 'next/server'

/** True once a room is past its expiry. */
export function roomExpired(room: { expiresAt: Date }): boolean {
  return room.expiresAt.getTime() < Date.now()
}

/** 410 Gone for a mutation (or next-card fetch) against an expired room. */
export function expiredRoomResponse(): NextResponse {
  return NextResponse.json({ error: 'This room has expired' }, { status: 410 })
}
