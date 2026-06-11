'use client'

import { useEffect, useState } from 'react'
import FilterControls from '@/components/FilterControls'
import { ServiceId } from '@/lib/tmdb'
import { track } from '@/lib/analytics'

interface RoomFilters {
  genres?: number[]
  maxRuntime?: number
  minRating?: number
  maxRating?: number
  depth?: number
}

interface HostFilterEditorProps {
  code: string
  open: boolean
  onClose: () => void
  /** Called after filters are applied and the remaining queue is rebuilt. */
  onApplied: () => void
}

const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-faint'

/**
 * Host-only mid-session filter editor. Opened from the room-code chip on the
 * voting screen. Loads the room's current services/filters, lets the host edit
 * them with the same controls as setup, then PATCHes the room and rebuilds the
 * remaining queue via /requeue so the changes apply to what's left to vote on.
 */
export default function HostFilterEditor({ code, open, onClose, onApplied }: HostFilterEditorProps) {
  const [loading, setLoading] = useState(true)
  const [services, setServices] = useState<ServiceId[]>([])
  const [minRating, setMinRating] = useState(0)
  const [maxRating, setMaxRating] = useState(10)
  const [maxRuntime, setMaxRuntime] = useState<number | ''>('')
  const [genres, setGenres] = useState<number[]>([])
  const [skipReruns, setSkipReruns] = useState(false)
  const [depth, setDepth] = useState(3)

  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setMessage(null)
      try {
        const res = await fetch(`/api/rooms/${code}`, { cache: 'no-store' })
        if (!res.ok) throw new Error('Failed to load filters.')
        const data = await res.json()
        if (cancelled) return
        const f: RoomFilters = data.filters ?? {}
        setServices(data.streamingServices ?? [])
        setMinRating(f.minRating ?? 0)
        setMaxRating(f.maxRating ?? 10)
        setMaxRuntime(f.maxRuntime ?? '')
        setGenres(f.genres ?? [])
        setDepth(f.depth ?? 3)
        setSkipReruns(Boolean(data.watchedFilter))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load filters.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, code])

  async function handleApply() {
    if (services.length === 0 || applying) return
    setApplying(true)
    setError(null)
    setMessage(null)
    try {
      const filters: RoomFilters = {
        minRating: minRating > 0 ? minRating : undefined,
        maxRating: maxRating < 10 ? maxRating : undefined,
        maxRuntime: maxRuntime === '' ? undefined : Number(maxRuntime),
        genres: genres.length ? genres : undefined,
        depth,
      }
      const patch = await fetch(`/api/rooms/${code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamingServices: services, filters, watchedFilter: skipReruns }),
      })
      if (!patch.ok) throw new Error('Failed to save filters.')
      track('feature_used', { feature: 'filter_edit' }, { roomId: code })

      const requeue = await fetch(`/api/rooms/${code}/requeue`, { method: 'POST' })
      const data = await requeue.json().catch(() => ({}))
      if (!requeue.ok) throw new Error(data.error ?? 'Failed to update the queue.')

      if (data.requeued === false) {
        setMessage(
          'Filters saved, but nothing new matched — the current lineup was kept. Try broadening them.'
        )
        return
      }
      onApplied()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setApplying(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/40 sm:items-center sm:p-4">
      <div className="flex w-full max-w-lg flex-col border border-ink bg-canvas sm:max-h-[90vh]">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className={EYEBROW}>Host controls</p>
            <h2 className="font-serif text-xl font-bold text-ink">Edit filters</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="border border-ink px-2.5 py-1 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-canvas"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <p className="text-sm text-muted">Loading filters…</p>
          ) : (
            <FilterControls
              services={services}
              onServicesChange={setServices}
              minRating={minRating}
              maxRating={maxRating}
              onRatingChange={(min, max) => {
                setMinRating(min)
                setMaxRating(max)
              }}
              maxRuntime={maxRuntime}
              onMaxRuntimeChange={setMaxRuntime}
              genres={genres}
              onGenresChange={setGenres}
              skipReruns={skipReruns}
              onSkipRerunsChange={setSkipReruns}
              depth={depth}
              onDepthChange={setDepth}
              busy={applying}
              showServicesError={services.length === 0}
            />
          )}
        </div>

        <footer className="space-y-2 border-t border-line px-5 py-4">
          {error && <p className="text-sm font-medium text-accent">{error}</p>}
          {message && <p className="text-sm text-muted">{message}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-ink bg-transparent px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-canvas"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || loading || services.length === 0}
              className="flex-1 bg-ink px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-faint/50"
            >
              {applying ? 'Applying…' : 'Apply to queue'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
