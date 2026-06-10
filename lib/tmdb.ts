const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w92'

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
  /** "How deep are we going?" dial (1–5); maps to a TMDB vote_count band. */
  depth?: number
}

/**
 * The depth dial mapped to review-count (`vote_count`) bands. Derived from the
 * measured distribution of the streamable US catalog (see docs/research.md):
 * equal-population fifths, so each level is a meaningful, well-populated
 * popularity tier. Low depth = mainstream (heavily reviewed); high depth =
 * obscure (lightly reviewed). Level 1 has no upper cap.
 */
export const DEPTH_BANDS: Record<number, { gte: number; lte?: number }> = {
  1: { gte: 500 },            // Crowd-Pleaser
  2: { gte: 150, lte: 499 },  // Easy Watch
  3: { gte: 75, lte: 149 },   // The Sweet Spot (default)
  4: { gte: 35, lte: 74 },    // Deep Cut
  5: { gte: 15, lte: 34 },    // Certified Cinephile
}

/** Default vote_count floor when no depth is selected (the app's prior behaviour). */
const DEFAULT_MIN_VOTES = 100

/** Below this many banded results, back-fill without the band so no combo 422s. */
const MIN_BACKFILL_RESULTS = 12

export interface WatchProvider {
  name: string
  logoUrl: string
}

export interface WatchProviders {
  providers: WatchProvider[]
  link: string | null
}

// In-memory cache with 1-hour TTL
const cache = new Map<string, { data: unknown; expiresAt: number }>()

async function tmdbFetch<T>(url: string): Promise<T> {
  const key = process.env.TMDB_API_KEY
  if (!key || key === 'your_tmdb_api_key_here') {
    console.error('[tmdb] missing api key', { url })
    throw new Error('TMDB_API_KEY is not configured. Set it in .env.local.')
  }

  const cached = cache.get(url)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    console.error('[tmdb] response', { url, status: res.status, cacheHit: false, ok: false })
    throw new Error(`TMDB fetch failed: ${res.status}`)
  }
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
  })

  if (filters.genres?.length) params.set('with_genres', filters.genres.join('|'))
  if (filters.maxRuntime) params.set('with_runtime.lte', String(filters.maxRuntime))
  if (filters.minRating) params.set('vote_average.gte', String(filters.minRating))
  if (filters.maxRating) params.set('vote_average.lte', String(filters.maxRating))

  // The depth dial maps to a review-count (vote_count) band. With no depth set,
  // fall back to the app's prior floor so existing behaviour is unchanged.
  const band = filters.depth ? DEPTH_BANDS[filters.depth] : undefined
  params.set('vote_count.gte', String(band?.gte ?? DEFAULT_MIN_VOTES))
  if (band?.lte) params.set('vote_count.lte', String(band.lte))

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

async function discoverPages(
  serviceIds: ServiceId[],
  filters: DiscoverFilters,
  maxResults: number
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

export async function discoverMovies(
  serviceIds: ServiceId[],
  filters: DiscoverFilters,
  maxResults = 60
): Promise<TmdbMovie[]> {
  const primary = await discoverPages(serviceIds, filters, maxResults)

  // A depth band intersected with strict genre/rating/provider filters can come
  // back nearly empty. Rather than 422 the room, back-fill with the band removed
  // (the prior default floor) and merge — banded picks first, deduped by id.
  if (filters.depth == null || primary.length >= MIN_BACKFILL_RESULTS) {
    return primary
  }

  const backfill = await discoverPages(serviceIds, { ...filters, depth: undefined }, maxResults)
  const seen = new Set(primary.map((m) => m.tmdbId))
  const merged = [...primary]
  for (const movie of backfill) {
    if (seen.has(movie.tmdbId)) continue
    seen.add(movie.tmdbId)
    merged.push(movie)
  }
  return merged.slice(0, maxResults)
}

export async function getMovieById(tmdbId: string): Promise<TmdbMovie> {
  const data = await tmdbFetch<Record<string, unknown>>(buildMovieDetailUrl(tmdbId))
  return parseMovieResult(data)
}

export function buildWatchProvidersUrl(tmdbId: string): string {
  return `${TMDB_BASE}/movie/${tmdbId}/watch/providers`
}

interface RawProvider {
  provider_name?: string
  logo_path?: string | null
}

// Pure parser for TMDB's /watch/providers response. Returns the subscription
// (flatrate) providers for a region plus the single regional JustWatch link.
export function parseWatchProviders(
  raw: Record<string, unknown>,
  region = 'US'
): WatchProviders {
  const results = (raw?.results ?? {}) as Record<string, unknown>
  const regionData = results[region] as
    | { flatrate?: RawProvider[]; link?: string }
    | undefined

  if (!regionData) return { providers: [], link: null }

  const seen = new Set<string>()
  const providers: WatchProvider[] = []
  for (const p of regionData.flatrate ?? []) {
    const name = p.provider_name?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    providers.push({
      name,
      logoUrl: p.logo_path ? `${TMDB_LOGO_BASE}${p.logo_path}` : '',
    })
  }

  return { providers, link: regionData.link ?? null }
}

export async function getWatchProviders(
  tmdbId: string,
  region = 'US'
): Promise<WatchProviders> {
  const data = await tmdbFetch<Record<string, unknown>>(buildWatchProvidersUrl(tmdbId))
  return parseWatchProviders(data, region)
}
