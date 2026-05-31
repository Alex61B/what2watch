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
    return { advanced: false, reason: 'ROOM_VANISHED' }
  }

  const queueLength = await prisma.roomQueue.count({ where: { roomId } })

  let status: RoomStatus = room.status
  if (room.currentPosition >= queueLength && status === 'VOTING') {
    await prisma.room.update({
      where: { id: roomId },
      data: { status: 'DRAINED' },
    })
    status = 'DRAINED'
  }

  return {
    advanced: true,
    newPosition: room.currentPosition,
    newVersion: room.queueVersion,
    status,
  }
}
