// components/SharedSessionClient.tsx
'use client'

import { useEffect, useState } from 'react'

interface Movie { tmdbMovieId: string; title: string; posterUrl: string; year: number }

export default function SharedSessionClient({ friendId, roomId }: { friendId: string; roomId: string }) {
  const [movies, setMovies] = useState<Movie[] | null>(null)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch(`/api/friends/${friendId}/sessions/${roomId}`)
      .then(r => {
        if (r.status === 403) { setForbidden(true); return null }
        return r.ok ? r.json() : { movies: [] }
      })
      .then(d => { if (d) setMovies(d.movies) })
      .catch(() => setMovies([]))
  }, [friendId, roomId])

  if (forbidden) return <p className="text-muted">You are not friends with this user.</p>
  if (movies === null) return <p className="text-muted">Loading…</p>
  if (movies.length === 0) return <p className="text-muted text-sm">You both said yes to nothing in this session.</p>

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {movies.map(m => (
        <li key={m.tmdbMovieId} className="bg-surface rounded-xl overflow-hidden">
          {m.posterUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={m.posterUrl} alt={m.title} className="w-full aspect-[2/3] object-cover" />
            : <div className="w-full aspect-[2/3] bg-surface-soft" />}
          <p className="p-3 text-sm">{m.title}</p>
        </li>
      ))}
    </ul>
  )
}
