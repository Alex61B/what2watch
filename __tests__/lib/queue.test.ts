import { advanceQueueAtomic } from '@/lib/queue'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    room: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    roomQueue: {
      count: jest.fn(),
    },
  },
}))

const updateMany = prisma.room.updateMany as jest.Mock
const findUnique = prisma.room.findUnique as jest.Mock
const queueCount = prisma.roomQueue.count as jest.Mock

describe('advanceQueueAtomic', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns advanced=true with incremented position/version when CAS succeeds mid-queue', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }) // CAS
    findUnique.mockResolvedValueOnce({ currentPosition: 6, queueVersion: 13, status: 'VOTING' })
    queueCount.mockResolvedValueOnce(60)

    const result = await advanceQueueAtomic('room-1', 5, 12)

    expect(result).toEqual({ advanced: true, newPosition: 6, newVersion: 13, status: 'VOTING' })
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'room-1', currentPosition: 5, queueVersion: 12 },
      data: { currentPosition: { increment: 1 }, queueVersion: { increment: 1 } },
    })
    // No drain write while still mid-queue.
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('returns advanced=false with reason CAS_LOST when no rows affected', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await advanceQueueAtomic('room-1', 5, 12)

    expect(result).toEqual({ advanced: false, reason: 'CAS_LOST' })
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('transitions to DRAINED via a guarded updateMany when the queue is exhausted', async () => {
    updateMany
      .mockResolvedValueOnce({ count: 1 }) // CAS
      .mockResolvedValueOnce({ count: 1 }) // guarded drain
    findUnique.mockResolvedValueOnce({ currentPosition: 60, queueVersion: 13, status: 'VOTING' })
    queueCount.mockResolvedValueOnce(60)

    const result = await advanceQueueAtomic('room-1', 59, 12)

    expect(result).toEqual({ advanced: true, newPosition: 60, newVersion: 13, status: 'DRAINED' })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'room-1', status: 'VOTING', currentPosition: { gte: 60 } },
      data: { status: 'DRAINED' },
    })
  })

  it('stays advanced/VOTING when the guarded drain affects no rows (lost the drain race)', async () => {
    updateMany
      .mockResolvedValueOnce({ count: 1 }) // CAS
      .mockResolvedValueOnce({ count: 0 }) // guarded drain — room no longer VOTING / not exhausted
    findUnique.mockResolvedValueOnce({ currentPosition: 60, queueVersion: 13, status: 'VOTING' })
    queueCount.mockResolvedValueOnce(60)

    const result = await advanceQueueAtomic('room-1', 59, 12)

    expect(result).toEqual({ advanced: true, newPosition: 60, newVersion: 13, status: 'VOTING' })
  })

  it('does not attempt a drain when status is already MATCHED', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }) // CAS only
    findUnique.mockResolvedValueOnce({ currentPosition: 60, queueVersion: 13, status: 'MATCHED' })
    queueCount.mockResolvedValueOnce(60)

    const result = await advanceQueueAtomic('room-1', 59, 12)

    expect(result).toEqual({ advanced: true, newPosition: 60, newVersion: 13, status: 'MATCHED' })
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('returns advanced=false with reason ROOM_VANISHED when room not found post-CAS', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 })
    findUnique.mockResolvedValueOnce(null)

    const result = await advanceQueueAtomic('room-1', 5, 12)

    expect(result).toEqual({ advanced: false, reason: 'ROOM_VANISHED' })
    expect(queueCount).not.toHaveBeenCalled()
  })
})
