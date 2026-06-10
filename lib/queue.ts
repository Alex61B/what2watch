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
  const cas = await prisma.room.updateMany({
    where: { id: roomId, currentPosition: expectedPosition, queueVersion: expectedVersion },
    data: {
      currentPosition: { increment: 1 },
      queueVersion: { increment: 1 },
    },
  })

  if (cas.count === 0) {
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

  // Count AFTER the CAS so a concurrent requeue that appended movies is reflected,
  // and drain via a guarded updateMany so we can never overwrite a status another
  // request set to MATCHED in the meantime.
  const queueLength = await prisma.roomQueue.count({ where: { roomId } })

  let status: RoomStatus = room.status
  if (room.currentPosition >= queueLength && status === 'VOTING') {
    const drained = await prisma.room.updateMany({
      where: { id: roomId, status: 'VOTING', currentPosition: { gte: queueLength } },
      data: { status: 'DRAINED' },
    })
    if (drained.count > 0) status = 'DRAINED'
  }

  return {
    advanced: true,
    newPosition: room.currentPosition,
    newVersion: room.queueVersion,
    status,
  }
}
