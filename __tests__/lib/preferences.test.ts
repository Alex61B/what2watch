// __tests__/lib/preferences.test.ts
import { addPreference, removePreference, listPreferences } from '@/lib/preferences'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    userMoviePreference: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

const upsert = prisma.userMoviePreference.upsert as jest.Mock
const deleteMany = prisma.userMoviePreference.deleteMany as jest.Mock
const findMany = prisma.userMoviePreference.findMany as jest.Mock

describe('preferences', () => {
  beforeEach(() => jest.clearAllMocks())

  it('addPreference upserts on the (userId, tmdbMovieId, type) unique key', async () => {
    upsert.mockResolvedValueOnce({})
    await addPreference('user-1', '603', 'WATCHLIST', 'room-1')
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_tmdbMovieId_type: { userId: 'user-1', tmdbMovieId: '603', type: 'WATCHLIST' } },
      create: { userId: 'user-1', tmdbMovieId: '603', type: 'WATCHLIST', sourceRoomId: 'room-1' },
      update: {},
    })
  })

  it('addPreference allows a null sourceRoomId', async () => {
    upsert.mockResolvedValueOnce({})
    await addPreference('user-1', '603', 'SEEN_BEFORE')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ sourceRoomId: null }) })
    )
  })

  it('removePreference deletes the matching row', async () => {
    deleteMany.mockResolvedValueOnce({ count: 1 })
    await removePreference('user-1', '603', 'WATCHLIST')
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', tmdbMovieId: '603', type: 'WATCHLIST' },
    })
  })

  it('listPreferences returns rows ordered by createdAt desc', async () => {
    findMany.mockResolvedValueOnce([{ tmdbMovieId: '603' }])
    const rows = await listPreferences('user-1', 'WATCHLIST')
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'WATCHLIST' },
      orderBy: { createdAt: 'desc' },
    })
    expect(rows).toEqual([{ tmdbMovieId: '603' }])
  })
})
