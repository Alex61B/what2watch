import { prisma } from '@/lib/prisma'
import type { RoomStatus } from '@prisma/client'

export type AdvanceResult =
  | { advanced: true; newPosition: number; newVersion: number; status: RoomStatus }
  | { advanced: false; reason: 'CAS_LOST' | 'ROOM_VANISHED' }

export async function advanceQueueAtomic(
  roomId: string,
  expectedPosition: number,
  expectedVersion: number,
): Promise<AdvanceResult> {
  const queueLength = await prisma.roomQueue.count({ where: { roomId } })
  console.log('[queue]', {
    roomId,
    currentPosition: expectedPosition,
    queueVersion: expectedVersion,
    queueLength,
    op: 'advance_attempt',
  })

  const cas = await prisma.room.updateMany({
    where: { id: roomId, currentPosition: expectedPosition, queueVersion: expectedVersion },
    data: {
      currentPosition: { increment: 1 },
      queueVersion: { increment: 1 },
    },
  })

  if (cas.count === 0) {
    console.warn('[advanceQueue]', {
      roomId,
      oldPosition: expectedPosition,
      newPosition: expectedPosition,
      result: 'cas_lost',
    })
    return { advanced: false, reason: 'CAS_LOST' }
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { currentPosition: true, queueVersion: true, status: true },
  })

  if (!room) {
    console.error('[advanceQueue]', {
      roomId,
      oldPosition: expectedPosition,
      newPosition: null,
      result: 'room_vanished',
    })
    return { advanced: false, reason: 'ROOM_VANISHED' }
  }

  let status: RoomStatus = room.status
  if (room.currentPosition >= queueLength && status === 'VOTING') {
    await prisma.room.update({
      where: { id: roomId },
      data: { status: 'DRAINED' },
    })
    status = 'DRAINED'
    console.log('[queue]', {
      roomId,
      currentPosition: room.currentPosition,
      queueVersion: room.queueVersion,
      queueLength,
      op: 'drained_transition',
    })
  }

  console.log('[advanceQueue]', {
    roomId,
    oldPosition: expectedPosition,
    newPosition: room.currentPosition,
    result: 'advanced',
    status,
  })

  return {
    advanced: true,
    newPosition: room.currentPosition,
    newVersion: room.queueVersion,
    status,
  }
}
