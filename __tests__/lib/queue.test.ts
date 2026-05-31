import { advanceQueueAtomic } from '@/lib/queue'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    room: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    roomQueue: {
      count: jest.fn(),
    },
  },
}))

const mockedUpdateMany = prisma.room.updateMany as jest.Mock
const mockedFindUnique = prisma.room.findUnique as jest.Mock
const mockedRoomUpdate = prisma.room.update as jest.Mock
const mockedQueueCount = prisma.roomQueue.count as jest.Mock

describe('advanceQueueAtomic', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns advanced=true with incremented position and version when CAS succeeds', async () => {
    mockedUpdateMany.mockResolvedValueOnce({ count: 1 })
    mockedFindUnique.mockResolvedValueOnce({ currentPosition: 6, queueVersion: 13, status: 'VOTING' })
    mockedQueueCount.mockResolvedValueOnce(60)

    const result = await advanceQueueAtomic('room-1', 5, 12)

    expect(result).toEqual({
      advanced: true,
      newPosition: 6,
      newVersion: 13,
      status: 'VOTING',
    })
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: 'room-1', currentPosition: 5, queueVersion: 12 },
      data: {
        currentPosition: { increment: 1 },
        queueVersion: { increment: 1 },
      },
    })
    expect(mockedRoomUpdate).not.toHaveBeenCalled()
  })

  it('returns advanced=false with reason CAS_LOST when no rows affected', async () => {
    mockedUpdateMany.mockResolvedValueOnce({ count: 0 })

    const result = await advanceQueueAtomic('room-1', 5, 12)

    expect(result).toEqual({ advanced: false, reason: 'CAS_LOST' })
    expect(mockedFindUnique).not.toHaveBeenCalled()
    expect(mockedRoomUpdate).not.toHaveBeenCalled()
  })

  it('transitions status to DRAINED when newPosition reaches end of queue', async () => {
    mockedUpdateMany.mockResolvedValueOnce({ count: 1 })
    mockedFindUnique.mockResolvedValueOnce({ currentPosition: 60, queueVersion: 13, status: 'VOTING' })
    mockedQueueCount.mockResolvedValueOnce(60)
    mockedRoomUpdate.mockResolvedValueOnce({})

    const result = await advanceQueueAtomic('room-1', 59, 12)

    expect(result).toEqual({
      advanced: true,
      newPosition: 60,
      newVersion: 13,
      status: 'DRAINED',
    })
    expect(mockedRoomUpdate).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { status: 'DRAINED' },
    })
  })

  it('does not transition to DRAINED when status is already MATCHED', async () => {
    mockedUpdateMany.mockResolvedValueOnce({ count: 1 })
    mockedFindUnique.mockResolvedValueOnce({ currentPosition: 60, queueVersion: 13, status: 'MATCHED' })
    mockedQueueCount.mockResolvedValueOnce(60)

    const result = await advanceQueueAtomic('room-1', 59, 12)

    expect(result).toEqual({
      advanced: true,
      newPosition: 60,
      newVersion: 13,
      status: 'MATCHED',
    })
    expect(mockedRoomUpdate).not.toHaveBeenCalled()
  })

  it('returns advanced=false with reason ROOM_VANISHED when room not found post-CAS', async () => {
    mockedUpdateMany.mockResolvedValueOnce({ count: 1 })
    mockedFindUnique.mockResolvedValueOnce(null)

    const result = await advanceQueueAtomic('room-1', 5, 12)

    expect(result).toEqual({ advanced: false, reason: 'ROOM_VANISHED' })
  })
})
