'use client'

import { useEffect, useRef, useState } from 'react'

interface PendingMember {
  id: string
  displayName: string
}

interface JoinRequestModalProps {
  pendingMembers: PendingMember[]
  /** Approve or deny a pending join request. */
  onApprove: (memberId: string, action: 'accept' | 'reject') => void
  /** The member id currently being acted on (buttons disable while set). */
  approvingId: string | null
}

const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-faint'

/**
 * Host-only popup that surfaces mid-session join requests so the host can
 * approve or deny each newcomer. Auto-opens when a request arrives; the host can
 * defer with "Not now" (which collapses it to a small re-open pill) but a freshly
 * arrived request always re-opens the modal so nothing is missed.
 */
export default function JoinRequestModal({
  pendingMembers,
  onApprove,
  approvingId,
}: JoinRequestModalProps) {
  const [dismissed, setDismissed] = useState(false)
  const seenIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = pendingMembers.map((m) => m.id)
    const hasNew = currentIds.some((id) => !seenIdsRef.current.has(id))
    seenIdsRef.current = new Set(currentIds)
    // A brand-new request re-opens the popup even if the host had deferred.
    if (hasNew) setDismissed(false)
  }, [pendingMembers])

  if (pendingMembers.length === 0) return null

  const count = pendingMembers.length

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(false)}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-4 flex w-[min(92%,28rem)] items-center justify-center gap-2 bg-accent px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-accent-ink shadow-lg transition-opacity hover:opacity-90"
      >
        ● {count} waiting to join — review
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/40 sm:items-center sm:p-4">
      <div className="flex w-full max-w-md flex-col self-end border border-ink bg-canvas sm:self-auto">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className={EYEBROW}>Host approval</p>
            <h2 className="font-serif text-xl font-bold text-ink">
              {count === 1 ? 'Someone wants to join' : `${count} want to join`}
            </h2>
          </div>
        </header>

        <ul className="flex-1 divide-y divide-line">
          {pendingMembers.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-accent text-sm font-bold text-accent-ink">
                  {m.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="truncate text-sm font-medium text-ink">{m.displayName}</span>
              </span>
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => onApprove(m.id, 'accept')}
                  disabled={approvingId !== null}
                  className="bg-ink px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(m.id, 'reject')}
                  disabled={approvingId !== null}
                  className="border border-ink px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-canvas disabled:opacity-40"
                >
                  Deny
                </button>
              </span>
            </li>
          ))}
        </ul>

        <footer className="border-t border-line px-5 py-3 text-center">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink"
          >
            Not now
          </button>
        </footer>
      </div>
    </div>
  )
}
