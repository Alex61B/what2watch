// __tests__/lib/movie-cache.test.ts
import { getCachedMovie, getCachedMovies } from '@/lib/movie-cache'
import { prisma } from '@/lib/prisma'
import { getMovieById } from '@/lib/tmdb'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    movieCache: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
  },
}))
jest.mock('@/lib/tmdb', () => ({ getMovieById: jest.fn() }))

const findUnique = prisma.movieCache.findUnique as jest.Mock
const findMany = prisma.movieCache.findMany as jest.Mock
const upsert = prisma.movieCache.upsert as jest.Mock
const tmdb = getMovieById as jest.Mock

describe('movie-cache', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns a cached row without calling TMDB', async () => {
    findUnique.mockResolvedValueOnce({
      tmdbMovieId: '603', title: 'The Matrix', posterUrl: 'p', year: 1999, overview: 'o', rating: 8.2,
    })
    const movie = await getCachedMovie('603')
    expect(tmdb).not.toHaveBeenCalled()
    expect(movie).toEqual({ tmdbMovieId: '603', title: 'The Matrix', posterUrl: 'p', year: 1999, overview: 'o', rating: 8.2 })
  })

  it('fetches from TMDB and upserts on cache miss', async () => {
    findUnique.mockResolvedValueOnce(null)
    tmdb.mockResolvedValueOnce({ tmdbId: '603', title: 'The Matrix', posterUrl: 'p', year: 1999, rating: 8.2, overview: 'o', runtime: 136, genreIds: [] })
    upsert.mockResolvedValueOnce({})
    const movie = await getCachedMovie('603')
    expect(upsert).toHaveBeenCalledWith({
      where: { tmdbMovieId: '603' },
      create: { tmdbMovieId: '603', title: 'The Matrix', posterUrl: 'p', year: 1999, overview: 'o', rating: 8.2 },
      update: { title: 'The Matrix', posterUrl: 'p', year: 1999, overview: 'o', rating: 8.2 },
    })
    expect(movie.title).toBe('The Matrix')
  })

  it('returns fallback metadata when TMDB fails and nothing is cached', async () => {
    findUnique.mockResolvedValueOnce(null)
    tmdb.mockRejectedValueOnce(new Error('TMDB fetch failed: 404'))
    const movie = await getCachedMovie('999')
    expect(movie).toEqual({ tmdbMovieId: '999', title: 'Title unavailable', posterUrl: '', year: 0, overview: '', rating: 0 })
  })

  it('getCachedMovies preserves input order and only fetches misses', async () => {
    findMany.mockResolvedValueOnce([
      { tmdbMovieId: '2', title: 'B', posterUrl: '', year: 2000, overview: '', rating: 5 },
    ])
    tmdb.mockResolvedValueOnce({ tmdbId: '1', title: 'A', posterUrl: '', year: 2001, rating: 6, overview: '', runtime: null, genreIds: [] })
    upsert.mockResolvedValue({})
    const movies = await getCachedMovies(['1', '2'])
    expect(movies.map(m => m.tmdbMovieId)).toEqual(['1', '2'])
    expect(tmdb).toHaveBeenCalledTimes(1)
  })
})
