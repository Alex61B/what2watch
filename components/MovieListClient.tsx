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

export default function MovieListClient({ type }: { type: 'watchlist' | 'seen' }) {
  const [movies, setMovies] = useState<ListMovie[] | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

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
    return <p className="text-gray-400">Loading…</p>
  }

  if (movies.length === 0) {
    return <p className="text-gray-400">Nothing here yet.</p>
  }

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {movies.map(m => (
        <li key={m.tmdbMovieId} className="bg-gray-900 rounded-xl overflow-hidden flex flex-col">
          {m.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.posterUrl} alt={m.title} className="w-full aspect-[2/3] object-cover" />
          ) : (
            <div className="w-full aspect-[2/3] bg-gray-800 flex items-center justify-center text-gray-600 text-xs px-2 text-center">
              No image
            </div>
          )}
          <div className="p-3 flex flex-col gap-2 flex-1">
            <p className="text-sm font-medium text-gray-100 line-clamp-2">{m.title}</p>
            {m.year > 0 && <p className="text-xs text-gray-500">{m.year}</p>}
            <button
              type="button"
              onClick={() => handleRemove(m.tmdbMovieId)}
              disabled={removing === m.tmdbMovieId}
              aria-label={`Remove ${m.title}`}
              className="mt-auto rounded-lg border border-gray-700 hover:bg-gray-800 disabled:opacity-40 px-3 py-1.5 text-xs text-gray-300 transition-colors"
            >
              {removing === m.tmdbMovieId ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
