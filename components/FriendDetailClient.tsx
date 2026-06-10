// components/FriendDetailClient.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Movie { tmdbMovieId: string; title: string; posterUrl: string; year: number }
interface SessionRow { roomId: string; code: string; createdAt: string; sharedYesCount: number }
interface Detail {
  friend: { id: string; displayName: string; email: string }
  sharedWatchlist: Movie[]
  sessions: SessionRow[]
}

export default function FriendDetailClient({ friendId }: { friendId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch(`/api/friends/${friendId}`)
      .then(r => {
        if (r.status === 403) { setForbidden(true); return null }
        return r.ok ? r.json() : null
      })
      .then(d => { if (d) setDetail(d) })
      .catch(() => {})
  }, [friendId])

  async function unfriend() {
    await fetch(`/api/friends/${friendId}`, { method: 'DELETE' })
    window.location.href = '/profile/friends'
  }

  if (forbidden) return <p className="text-muted">You are not friends with this user.</p>
  if (!detail) return <p className="text-muted">Loading…</p>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{detail.friend.displayName}</h1>
        <button type="button" onClick={unfriend} className="rounded-lg border border-line hover:bg-surface-soft px-3 py-1.5 text-xs text-ink">Unfriend</button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Shared Watch List</h2>
        {detail.sharedWatchlist.length === 0 ? (
          <p className="text-muted text-sm">No movies you both want to watch yet.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {detail.sharedWatchlist.map(m => (
              <li key={m.tmdbMovieId} className="bg-surface rounded-xl overflow-hidden">
                {m.posterUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={m.posterUrl} alt={m.title} className="w-full aspect-[2/3] object-cover" />
                  : <div className="w-full aspect-[2/3] bg-surface-soft" />}
                <p className="p-3 text-sm">{m.title}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Previous Sessions Together</h2>
        {detail.sessions.length === 0 ? (
          <p className="text-muted text-sm">No shared sessions yet.</p>
        ) : (
          detail.sessions.map(s => (
            <Link
              key={s.roomId}
              href={`/profile/friends/${friendId}/sessions/${s.roomId}`}
              className="block bg-surface hover:bg-surface-soft rounded-lg px-4 py-3 transition-colors"
            >
              <span className="font-medium">{s.code}</span>
              <span className="text-faint text-sm"> — {s.sharedYesCount} shared yes</span>
            </Link>
          ))
        )}
      </section>
    </div>
  )
}
