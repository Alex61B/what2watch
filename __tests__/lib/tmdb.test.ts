import { buildDiscoverUrl, buildStreamingUrl, parseMovieResult, parseWatchProviders, STREAMING_SERVICES } from '@/lib/tmdb'

describe('STREAMING_SERVICES', () => {
  it('contains exactly 6 services each with id, name, and tmdbId', () => {
    expect(STREAMING_SERVICES).toHaveLength(6)
    STREAMING_SERVICES.forEach(s => {
      expect(s).toHaveProperty('id')
      expect(s).toHaveProperty('name')
      expect(s).toHaveProperty('tmdbId')
      expect(typeof s.tmdbId).toBe('number')
    })
  })

  it('includes netflix with tmdbId 8', () => {
    const netflix = STREAMING_SERVICES.find(s => s.id === 'netflix')
    expect(netflix?.tmdbId).toBe(8)
  })
})

describe('buildDiscoverUrl', () => {
  it('includes watch provider IDs for given service IDs', () => {
    const url = buildDiscoverUrl(['netflix', 'hulu'], {})
    expect(url).toContain('with_watch_providers=8%7C15')
    expect(url).toContain('watch_region=US')
  })

  it('includes genre filter as a union (pipe-separated) when provided', () => {
    const url = buildDiscoverUrl(['netflix'], { genres: [28, 12] })
    expect(url).toContain('with_genres=28%7C12')
  })

  it('includes runtime filter when maxRuntime provided', () => {
    const url = buildDiscoverUrl(['netflix'], { maxRuntime: 120 })
    expect(url).toContain('with_runtime.lte=120')
  })

  it('includes rating filter when minRating provided', () => {
    const url = buildDiscoverUrl(['netflix'], { minRating: 7 })
    expect(url).toContain('vote_average.gte=7')
  })

  it('omits filter params when not provided', () => {
    const url = buildDiscoverUrl(['netflix'], {})
    expect(url).not.toContain('with_genres')
    expect(url).not.toContain('with_runtime')
    expect(url).not.toContain('vote_average.gte')
  })
})

describe('buildDiscoverUrl — depth → review-count band', () => {
  it('uses the default vote_count floor (100) and no cap when no depth is set', () => {
    const url = buildDiscoverUrl(['netflix'], {})
    expect(url).toContain('vote_count.gte=100')
    expect(url).not.toContain('vote_count.lte')
  })

  it('level 1 (Crowd-Pleaser) sets a high floor with no upper cap', () => {
    const url = buildDiscoverUrl(['netflix'], { depth: 1 })
    expect(url).toContain('vote_count.gte=500')
    expect(url).not.toContain('vote_count.lte')
  })

  it('level 3 (Sweet Spot) sets a bounded mid band', () => {
    const url = buildDiscoverUrl(['netflix'], { depth: 3 })
    expect(url).toContain('vote_count.gte=75')
    expect(url).toContain('vote_count.lte=149')
  })

  it('level 5 (Cinephile) sets the low, obscure band', () => {
    const url = buildDiscoverUrl(['netflix'], { depth: 5 })
    expect(url).toContain('vote_count.gte=15')
    expect(url).toContain('vote_count.lte=34')
  })

  it('bands tighten monotonically as depth increases', () => {
    const floors = [1, 2, 3, 4, 5].map((depth) => {
      const url = buildDiscoverUrl(['netflix'], { depth })
      return Number(new URL(url).searchParams.get('vote_count.gte'))
    })
    const sorted = [...floors].sort((a, b) => b - a)
    expect(floors).toEqual(sorted) // strictly descending floors
  })
})

describe('buildStreamingUrl', () => {
  it('builds a Netflix search link from the live provider name', () => {
    expect(buildStreamingUrl({ providerName: 'Netflix', title: 'Parasite' })).toBe(
      'https://www.netflix.com/search?q=Parasite'
    )
  })

  it('matches name variants ("Amazon Prime Video" → primevideo)', () => {
    expect(buildStreamingUrl({ providerName: 'Amazon Prime Video', title: 'Heat' })).toBe(
      'https://www.primevideo.com/search?phrase=Heat'
    )
  })

  it('maps "Disney Plus", "Apple TV Plus", and "Max" variants', () => {
    expect(buildStreamingUrl({ providerName: 'Disney Plus', title: 'Up' })).toBe(
      'https://www.disneyplus.com/search?q=Up'
    )
    expect(buildStreamingUrl({ providerName: 'Apple TV Plus', title: 'CODA' })).toBe(
      'https://tv.apple.com/search?term=CODA'
    )
    expect(buildStreamingUrl({ providerName: 'Max', title: 'Dune' })).toBe(
      'https://play.max.com/search?q=Dune'
    )
  })

  it('falls back to the internal service id when no provider name is given', () => {
    expect(buildStreamingUrl({ serviceId: 'hulu', title: 'Nomadland' })).toBe(
      'https://www.hulu.com/search?q=Nomadland'
    )
  })

  it('prefers the provider name over the stored service id', () => {
    expect(buildStreamingUrl({ providerName: 'Netflix', serviceId: 'hulu', title: 'Roma' })).toBe(
      'https://www.netflix.com/search?q=Roma'
    )
  })

  it('url-encodes the title', () => {
    expect(buildStreamingUrl({ serviceId: 'netflix', title: 'Mad Max: Fury Road' })).toBe(
      'https://www.netflix.com/search?q=Mad%20Max%3A%20Fury%20Road'
    )
  })

  it('returns null when nothing maps to a known service', () => {
    expect(buildStreamingUrl({ providerName: 'Peacock', title: 'Nope' })).toBeNull()
    expect(buildStreamingUrl({ serviceId: 'peacock', title: 'Nope' })).toBeNull()
    expect(buildStreamingUrl({ title: 'Nope' })).toBeNull()
  })
})

describe('parseMovieResult', () => {
  const raw = {
    id: 157336,
    title: 'Interstellar',
    overview: 'A team of explorers travel through a wormhole.',
    poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    release_date: '2014-11-05',
    vote_average: 8.6,
    runtime: 169,
    genre_ids: [18, 878],
  }

  it('maps tmdbId as string', () => {
    expect(parseMovieResult(raw).tmdbId).toBe('157336')
  })

  it('maps title, overview, year, rating, runtime', () => {
    const m = parseMovieResult(raw)
    expect(m.title).toBe('Interstellar')
    expect(m.overview).toBe('A team of explorers travel through a wormhole.')
    expect(m.year).toBe(2014)
    expect(m.rating).toBe(8.6)
    expect(m.runtime).toBe(169)
  })

  it('builds full posterUrl from poster_path', () => {
    expect(parseMovieResult(raw).posterUrl).toContain('gEU2QniE6E77NI6lCU6MxlNBvIx.jpg')
    expect(parseMovieResult(raw).posterUrl).toMatch(/^https?:\/\//)
  })

  it('returns empty string posterUrl when poster_path is null', () => {
    expect(parseMovieResult({ ...raw, poster_path: null }).posterUrl).toBe('')
  })

  it('returns null runtime when runtime is missing', () => {
    const { runtime: _, ...noRuntime } = raw
    expect(parseMovieResult(noRuntime).runtime).toBeNull()
  })
})

describe('parseWatchProviders', () => {
  const raw = {
    results: {
      US: {
        link: 'https://www.themoviedb.org/movie/1/watch?locale=US',
        flatrate: [
          { provider_name: 'Netflix', logo_path: '/netflix.jpg' },
          { provider_name: 'Hulu', logo_path: '/hulu.jpg' },
          { provider_name: 'Netflix', logo_path: '/netflix.jpg' }, // duplicate
        ],
      },
      GB: { link: 'https://example.com/gb', flatrate: [{ provider_name: 'Now', logo_path: '/now.jpg' }] },
    },
  }

  it('maps US flatrate providers with full logo URLs', () => {
    const { providers } = parseWatchProviders(raw, 'US')
    expect(providers).toEqual([
      { name: 'Netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/netflix.jpg' },
      { name: 'Hulu', logoUrl: 'https://image.tmdb.org/t/p/w92/hulu.jpg' },
    ])
  })

  it('dedupes providers by name', () => {
    const { providers } = parseWatchProviders(raw, 'US')
    expect(providers.filter(p => p.name === 'Netflix')).toHaveLength(1)
  })

  it('returns the regional JustWatch link', () => {
    expect(parseWatchProviders(raw, 'US').link).toBe(
      'https://www.themoviedb.org/movie/1/watch?locale=US'
    )
  })

  it('defaults to US region', () => {
    expect(parseWatchProviders(raw).providers.map(p => p.name)).toEqual(['Netflix', 'Hulu'])
  })

  it('returns empty providers and null link when the region is missing', () => {
    expect(parseWatchProviders(raw, 'FR')).toEqual({ providers: [], link: null })
  })

  it('handles a region with no flatrate tier', () => {
    const noFlatrate = { results: { US: { link: 'https://example.com' } } }
    expect(parseWatchProviders(noFlatrate, 'US')).toEqual({ providers: [], link: 'https://example.com' })
  })

  it('handles a missing results object', () => {
    expect(parseWatchProviders({}, 'US')).toEqual({ providers: [], link: null })
  })
})
