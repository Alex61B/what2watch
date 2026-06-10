import { checkForMatch } from '@/lib/match'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    room: { updateMany: jest.fn() },
  },
}))

jest.mock('@prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}))

const queryRaw = prisma.$queryRaw as jest.Mock
const updateMany = prisma.room.updateMany as jest.Mock

describe('checkForMatch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns null when yes-vote count is less than active member count', async () => {
    queryRaw.mockResolvedValueOnce([
      { tmdb_movie_id: 'movie-1', yes_count: BigInt(1), active_count: BigInt(2) },
    ])
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBeNull()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('matches and writes MATCHED guarded on status=VOTING when all active members voted yes', async () => {
    queryRaw.mockResolvedValueOnce([
      { tmdb_movie_id: 'movie-1', yes_count: BigInt(2), active_count: BigInt(2) },
    ])
    updateMany.mockResolvedValueOnce({ count: 1 })
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBe('movie-1')
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'room-1', status: 'VOTING' },
      data: { status: 'MATCHED', matchedMovieId: 'movie-1' },
    })
  })

  it('returns null when the room already left VOTING (guarded write affects no rows)', async () => {
    queryRaw.mockResolvedValueOnce([
      { tmdb_movie_id: 'movie-1', yes_count: BigInt(2), active_count: BigInt(2) },
    ])
    updateMany.mockResolvedValueOnce({ count: 0 })
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBeNull()
  })

  it('returns null when query returns empty results', async () => {
    queryRaw.mockResolvedValueOnce([])
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBeNull()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('returns null when active_count is 0', async () => {
    queryRaw.mockResolvedValueOnce([
      { tmdb_movie_id: 'movie-1', yes_count: BigInt(0), active_count: BigInt(0) },
    ])
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBeNull()
    expect(updateMany).not.toHaveBeenCalled()
  })
})
