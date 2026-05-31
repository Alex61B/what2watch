const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

export const TMDB_GENRES = [
  { id: 28,    name: 'Action' },
  { id: 12,    name: 'Adventure' },
  { id: 16,    name: 'Animation' },
  { id: 35,    name: 'Comedy' },
  { id: 80,    name: 'Crime' },
  { id: 99,    name: 'Documentary' },
  { id: 18,    name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14,    name: 'Fantasy' },
  { id: 27,    name: 'Horror' },
  { id: 9648,  name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878,   name: 'Sci-Fi' },
  { id: 53,    name: 'Thriller' },
] as const

export const STREAMING_SERVICES = [
  { id: 'netflix',  name: 'Netflix',       tmdbId: 8    },
  { id: 'prime',    name: 'Amazon Prime',  tmdbId: 9    },
  { id: 'disney',   name: 'Disney+',       tmdbId: 337  },
  { id: 'hbo',      name: 'HBO Max',       tmdbId: 1899 },
  { id: 'hulu',     name: 'Hulu',          tmdbId: 15   },
  { id: 'apple',    name: 'Apple TV+',     tmdbId: 350  },
] as const

export type ServiceId = typeof STREAMING_SERVICES[number]['id']

export interface TmdbMovie {
  tmdbId: string
  title: string
  overview: string
  posterUrl: string
  year: number
  rating: number
  runtime: number | null
  genreIds: number[]
}

export interface DiscoverFilters {
  genres?: number[]
  maxRuntime?: number
  minRating?: number
  maxRating?: number
}

// In-memory cache with 1-hour TTL
const cache = new Map<string, { data: unknown; expiresAt: number }>()

async function tmdbFetch<T>(url: string): Promise<T> {
  const key = process.env.TMDB_API_KEY
  if (!key || key === 'your_tmdb_api_key_here') {
    throw new Error('TMDB_API_KEY is not configured. Set it in .env.local.')
  }

  const cached = cache.get(url)
  if (cached && cached.expiresAt > Date.now()) return cached.data as T

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`TMDB fetch failed: ${res.status}`)
  const data = await res.json()
  cache.set(url, { data, expiresAt: Date.now() + 60 * 60 * 1000 })
  return data as T
}

export function buildDiscoverUrl(serviceIds: ServiceId[], filters: DiscoverFilters): string {
  const providerIds = serviceIds
    .map(id => STREAMING_SERVICES.find(s => s.id === id)?.tmdbId)
    .filter((id): id is NonNullable<typeof id> => id !== undefined)
    .join('|')

  const params = new URLSearchParams({
    with_watch_providers: providerIds,
    watch_region: 'US',
    sort_by: 'popularity.desc',
    'vote_count.gte': '100',
  })

  if (filters.genres?.length) params.set('with_genres', filters.genres.join('|'))
  if (filters.maxRuntime) params.set('with_runtime.lte', String(filters.maxRuntime))
  if (filters.minRating) params.set('vote_average.gte', String(filters.minRating))
  if (filters.maxRating) params.set('vote_average.lte', String(filters.maxRating))

  return `${TMDB_BASE}/discover/movie?${params}`
}

export function buildMovieDetailUrl(tmdbId: string): string {
  return `${TMDB_BASE}/movie/${tmdbId}`
}

export function parseMovieResult(raw: Record<string, unknown>): TmdbMovie {
  return {
    tmdbId: String(raw.id),
    title: raw.title as string,
    overview: raw.overview as string,
    posterUrl: raw.poster_path ? `${TMDB_IMAGE_BASE}${raw.poster_path}` : '',
    year: new Date(raw.release_date as string).getFullYear(),
    rating: raw.vote_average as number,
    runtime: (raw.runtime as number) ?? null,
    genreIds: (raw.genre_ids as number[]) ?? [],
  }
}

export async function discoverMovies(
  serviceIds: ServiceId[],
  filters: DiscoverFilters,
  maxResults = 60
): Promise<TmdbMovie[]> {
  const movies: TmdbMovie[] = []
  let page = 1

  while (movies.length < maxResults) {
    const url = buildDiscoverUrl(serviceIds, filters) + `&page=${page}`
    const data = await tmdbFetch<{ results: Record<string, unknown>[]; total_pages: number }>(url)
    movies.push(...data.results.map(parseMovieResult))
    if (page >= data.total_pages || page >= 3) break
    page++
  }

  return movies.slice(0, maxResults)
}

export async function getMovieById(tmdbId: string): Promise<TmdbMovie> {
  const data = await tmdbFetch<Record<string, unknown>>(buildMovieDetailUrl(tmdbId))
  return parseMovieResult(data)
}
