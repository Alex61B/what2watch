// components/MovieListClient.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'

interface ListMovie {
  tmdbMovieId: string
  title: string
  posterUrl: string
  year: number
  overview: string
  rating: number
  sourceRoomId: string | null
  addedAt: string
}

type SortKey = 'added' | 'rating' | 'year' | 'title'

const SORT_LABELS: Record<SortKey, string> = {
  added: 'Recently added',
  rating: 'Highest rated',
  year: 'Newest',
  title: 'A–Z',
}

const FIELD =
  'rounded-none border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none'
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-faint'

export default function MovieListClient({ type }: { type: 'watchlist' | 'seen' }) {
  const [movies, setMovies] = useState<ListMovie[] | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  // Search + filter controls (applied client-side over the loaded list).
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('added')
  const [minRating, setMinRating] = useState(0)
  const [decade, setDecade] = useState<number | 'all'>('all')
  // The Sort / Min-rating / Year controls live behind a collapsible "Filters"
  // toggle; the search box stays always visible.
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/user/movies?type=${type}`)
      .then(r => (r.ok ? r.json() : { movies: [] }))
      .then(data => { if (active) setMovies(data.movies ?? []) })
      .catch(() => { if (active) setMovies([]) })
    return () => { active = false }
  }, [type])

  const handleRemove = useCallback(async (tmdbMovieId: string) => {
    setRemoving(tmdbMovieId)
    try {
      const res = await fetch('/api/user/movies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbMovieId, type }),
      })
      if (res.ok) setMovies(prev => (prev ?? []).filter(m => m.tmdbMovieId !== tmdbMovieId))
    } finally {
      setRemoving(null)
    }
  }, [type])

  if (movies === null) {
    return <p className="text-muted">Loading…</p>
  }

  if (movies.length === 0) {
    return <p className="text-muted">Nothing here yet.</p>
  }

  // Decades present in the list (newest first), e.g. 2020, 2010, …
  const decades = [...new Set(movies.filter(m => m.year > 0).map(m => Math.floor(m.year / 10) * 10))]
    .sort((a, b) => b - a)

  const q = query.trim().toLowerCase()
  const visible = movies
    .filter(m => (q ? m.title.toLowerCase().includes(q) : true))
    .filter(m => m.rating >= minRating)
    .filter(m => (decade === 'all' ? true : m.year >= decade && m.year < decade + 10))
    .sort((a, b) => {
      switch (sort) {
        case 'rating': return b.rating - a.rating
        case 'year': return b.year - a.year
        case 'title': return a.title.localeCompare(b.title)
        case 'added':
        default: return b.addedAt.localeCompare(a.addedAt)
      }
    })

  const filtersActive = sort !== 'added' || minRating > 0 || decade !== 'all'

  return (
    <div className="space-y-5">
      {/* Search (always visible) + a collapsible Filters panel */}
      <div className="space-y-3">
        <div className="flex items-stretch gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by title"
              aria-label="Search by title"
              className="w-full rounded-none border border-line bg-surface px-4 py-3 pr-10 text-sm text-ink placeholder-faint focus:border-ink focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-sm text-faint hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen(o => !o)}
            aria-expanded={filtersOpen}
            aria-controls="list-filters"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-none border border-line bg-surface px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors hover:border-ink"
          >
            Filters
            {filtersActive && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />}
            <span aria-hidden>{filtersOpen ? '▴' : '▾'}</span>
          </button>
        </div>

        {filtersOpen && (
        <div id="list-filters" className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Sort</span>
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
              aria-label="Sort"
              className={FIELD}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Year</span>
            <select
              value={decade === 'all' ? 'all' : String(decade)}
              onChange={e => setDecade(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              aria-label="Release year"
              className={FIELD}
            >
              <option value="all">All years</option>
              {decades.map(d => (
                <option key={d} value={d}>{d}s</option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 flex-col gap-1">
            <span className={LABEL}>Min rating · {minRating.toFixed(1)}</span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={minRating}
              onChange={e => setMinRating(Number(e.target.value))}
              aria-label="Minimum rating"
              className="h-9 w-full"
            />
          </label>
        </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-muted">No movies match your filters.</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {visible.map(m => (
            <li key={m.tmdbMovieId} className="bg-surface rounded-xl overflow-hidden flex flex-col">
              {m.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.posterUrl} alt={m.title} className="w-full aspect-[2/3] object-cover" />
              ) : (
                <div className="w-full aspect-[2/3] bg-surface-soft flex items-center justify-center text-muted text-xs px-2 text-center">
                  No image
                </div>
              )}
              <div className="p-3 flex flex-col gap-2 flex-1">
                <p className="text-sm font-medium text-ink line-clamp-2">{m.title}</p>
                {m.year > 0 && <p className="text-xs text-faint">{m.year}</p>}
                <button
                  type="button"
                  onClick={() => handleRemove(m.tmdbMovieId)}
                  disabled={removing === m.tmdbMovieId}
                  aria-label={`Remove ${m.title}`}
                  className="mt-auto rounded-lg border border-line hover:bg-surface-soft disabled:opacity-40 px-3 py-1.5 text-xs text-ink transition-colors"
                >
                  {removing === m.tmdbMovieId ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
