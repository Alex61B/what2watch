// lib/movie-cache.ts
import { prisma } from '@/lib/prisma'
import { getMovieById } from '@/lib/tmdb'

export interface CachedMovie {
  tmdbMovieId: string
  title: string
  posterUrl: string
  year: number
  overview: string
  rating: number
}

function fallback(tmdbMovieId: string): CachedMovie {
  return { tmdbMovieId, title: 'Title unavailable', posterUrl: '', year: 0, overview: '', rating: 0 }
}

async function fetchAndCache(tmdbMovieId: string): Promise<CachedMovie> {
  try {
    const m = await getMovieById(tmdbMovieId)
    const row: CachedMovie = {
      tmdbMovieId,
      title: m.title,
      posterUrl: m.posterUrl,
      year: Number.isFinite(m.year) ? m.year : 0,
      overview: m.overview,
      rating: m.rating,
    }
    await prisma.movieCache.upsert({
      where: { tmdbMovieId },
      create: { ...row },
      update: { title: row.title, posterUrl: row.posterUrl, year: row.year, overview: row.overview, rating: row.rating },
    })
    return row
  } catch {
    return fallback(tmdbMovieId)
  }
}

export async function getCachedMovie(tmdbMovieId: string): Promise<CachedMovie> {
  const cached = await prisma.movieCache.findUnique({ where: { tmdbMovieId } })
  if (cached) {
    return {
      tmdbMovieId: cached.tmdbMovieId,
      title: cached.title,
      posterUrl: cached.posterUrl,
      year: cached.year,
      overview: cached.overview,
      rating: cached.rating,
    }
  }
  return fetchAndCache(tmdbMovieId)
}

export async function getCachedMovies(tmdbMovieIds: string[]): Promise<CachedMovie[]> {
  if (tmdbMovieIds.length === 0) return []
  const cached = await prisma.movieCache.findMany({ where: { tmdbMovieId: { in: tmdbMovieIds } } })
  const byId = new Map<string, CachedMovie>(
    cached.map(c => [c.tmdbMovieId, {
      tmdbMovieId: c.tmdbMovieId, title: c.title, posterUrl: c.posterUrl, year: c.year, overview: c.overview, rating: c.rating,
    }])
  )
  const result: CachedMovie[] = []
  for (const id of tmdbMovieIds) {
    result.push(byId.get(id) ?? (await fetchAndCache(id)))
  }
  return result
}
