'use client'

import { useState } from 'react'

interface DrainedScreenProps {
  isHost: boolean
  code: string
}

export default function DrainedScreen({ isHost, code }: DrainedScreenProps) {
  const [dealing, setDealing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Deal more movies with the room's current filters. The requeue route resumes
  // the drained room (status → VOTING, queueVersion++); the voting page keeps
  // polling while this screen is mounted, so it swaps back to the card on its
  // next tick. Keep the button busy until that unmount happens.
  async function dealMore() {
    if (dealing) return
    setDealing(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/rooms/${code}/requeue`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error ?? 'Could not deal more movies.')
        setDealing(false)
        return
      }
      if (data.requeued === false) {
        setMessage('No fresh movies match your filters. Edit them from the room chip, then try again.')
        setDealing(false)
      }
      // On success, leave the button "Dealing…" — the poll loop will navigate.
    } catch {
      setMessage('Could not deal more movies.')
      setDealing(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-ink">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
            Out of movies
          </p>
          <h1 className="mt-2 font-serif text-4xl font-bold leading-none">
            That&apos;s the <span className="italic text-accent">lot.</span>
          </h1>
        </div>
        <p className="text-sm text-muted">The room has voted on every movie in this queue.</p>
        {isHost ? (
          <button
            type="button"
            onClick={dealMore}
            disabled={dealing}
            className="w-full rounded-none bg-ink px-6 py-3 text-sm font-semibold uppercase tracking-wide text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-faint/50"
          >
            {dealing ? 'Dealing…' : 'Deal more movies'}
          </button>
        ) : (
          <p className="text-sm text-faint">Waiting for the host.</p>
        )}
        {message && <p className="text-sm font-medium text-accent">{message}</p>}
        <a
          href={`/room/${code}/lobby`}
          className="inline-block rounded-none border border-ink px-6 py-3 text-sm font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-canvas"
        >
          Back to lobby
        </a>
      </div>
    </main>
  )
}
