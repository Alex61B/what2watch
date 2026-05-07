import { checkForMatch } from '@/lib/match'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    room: { update: jest.fn() },
  },
}))

jest.mock('@prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}))

describe('checkForMatch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns null when yes-vote count is less than active member count', async () => {
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { tmdb_movie_id: 'movie-1', yes_count: BigInt(1), active_count: BigInt(2) },
    ])
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBeNull()
    expect(prisma.room.update).not.toHaveBeenCalled()
  })

  it('returns movieId and updates room when all active members voted yes', async () => {
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { tmdb_movie_id: 'movie-1', yes_count: BigInt(2), active_count: BigInt(2) },
    ])
    ;(prisma.room.update as jest.Mock).mockResolvedValueOnce({})
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBe('movie-1')
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { status: 'MATCHED', matchedMovieId: 'movie-1' },
    })
  })

  it('returns null when query returns empty results', async () => {
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([])
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBeNull()
  })

  it('returns null when active_count is 0', async () => {
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { tmdb_movie_id: 'movie-1', yes_count: BigInt(0), active_count: BigInt(0) },
    ])
    const result = await checkForMatch('room-1', 'movie-1')
    expect(result).toBeNull()
  })
})
