// components/FriendsClient.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface PublicUser { id: string; displayName: string; email: string }
interface PendingItem { requestId: string; user: PublicUser }

export default function FriendsClient() {
  const [friends, setFriends] = useState<PublicUser[]>([])
  const [incoming, setIncoming] = useState<PendingItem[]>([])
  const [outgoing, setOutgoing] = useState<PendingItem[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PublicUser[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/friends')
    if (res.ok) {
      const data = await res.json()
      setFriends(data.friends)
      setIncoming(data.incoming)
      setOutgoing(data.outgoing)
    }
    setLoaded(true)
  }, [])

  // The initial fetch is scheduled via setTimeout so the effect body does not
  // call setState synchronously (driven by a timer callback / external system),
  // satisfying react-hooks/set-state-in-effect.
  useEffect(() => {
    const id = setTimeout(() => { void refresh() }, 0)
    return () => clearTimeout(id)
  }, [refresh])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`)
    if (res.ok) setResults((await res.json()).users)
  }

  async function sendRequest(receiverId: string) {
    await fetch('/api/friends/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverId }),
    })
    setResults(prev => prev.filter(u => u.id !== receiverId))
    await refresh()
  }

  async function respond(requestId: string, action: 'accept' | 'decline') {
    await fetch(`/api/friends/requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    await refresh()
  }

  const friendIds = new Set(friends.map(f => f.id))
  const outgoingIds = new Set(outgoing.map(o => o.user.id))

  return (
    <div className="space-y-8">
      {/* Search */}
      <section className="space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button type="submit" className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 font-semibold">Search</button>
        </form>
        {results.map(u => {
          const already = friendIds.has(u.id)
          const pending = outgoingIds.has(u.id)
          return (
            <div key={u.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3">
              <span className="text-sm">{u.displayName} <span className="text-gray-500">{u.email}</span></span>
              <button
                type="button"
                disabled={already || pending}
                onClick={() => sendRequest(u.id)}
                className="rounded-lg border border-gray-700 hover:bg-gray-800 disabled:opacity-40 px-3 py-1.5 text-xs"
              >
                {already ? 'Friends' : pending ? 'Requested' : 'Add friend'}
              </button>
            </div>
          )
        })}
      </section>

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Friend requests</h2>
          {incoming.map(item => (
            <div key={item.requestId} className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3">
              <span className="text-sm">{item.user.displayName}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => respond(item.requestId, 'accept')} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs">Accept</button>
                <button type="button" onClick={() => respond(item.requestId, 'decline')} className="rounded-lg border border-gray-700 hover:bg-gray-800 px-3 py-1.5 text-xs">Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Outgoing requests */}
      {outgoing.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Pending (sent)</h2>
          {outgoing.map(item => (
            <div key={item.requestId} className="bg-gray-900 rounded-lg px-4 py-3 text-sm text-gray-400">
              {item.user.displayName} — awaiting response
            </div>
          ))}
        </section>
      )}

      {/* Friends list */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Friends</h2>
        {loaded && friends.length === 0 && (
          <p className="text-gray-400 text-sm">No friends yet. Search above to send a request.</p>
        )}
        {friends.map(f => (
          <Link key={f.id} href={`/profile/friends/${f.id}`} className="block bg-gray-900 hover:bg-gray-800 rounded-lg px-4 py-3 transition-colors">
            {f.displayName}
          </Link>
        ))}
      </section>
    </div>
  )
}
