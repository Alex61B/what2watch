'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'

interface Movie {
  tmdbId: string
  title: string
  overview: string
  posterUrl: string
  year: number
  rating: number
  runtime: number | null
  genreIds: number[]
}

interface VotingCardProps {
  movie: Movie
  onVote: (vote: boolean) => void
  disabled?: boolean
  /** Whether this card is marked "seen" (controlled by the parent). */
  seen?: boolean
  onToggleSeen?: () => void
  /** Room's "Skip the Reruns" setting — changes what marking seen does. */
  skipReruns?: boolean
}

// Past this horizontal drag distance (px), releasing commits the vote.
const SWIPE_THRESHOLD = 100

function Stars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating / 2)))
  return (
    <span className="text-accent">
      {'★'.repeat(filled)}
      <span className="text-line">{'★'.repeat(5 - filled)}</span>
    </span>
  )
}

export default function VotingCard({
  movie,
  onVote,
  disabled = false,
  seen = false,
  onToggleSeen,
  skipReruns = false,
}: VotingCardProps) {
  const startXRef = useRef<number | null>(null)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [exitDir, setExitDir] = useState<'left' | 'right' | null>(null)

  function commit(vote: boolean) {
    if (disabled || exitDir) return
    setExitDir(vote ? 'right' : 'left')
    onVote(vote)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || exitDir) return
    startXRef.current = e.clientX
    setDragging(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || startXRef.current === null) return
    setDragX(e.clientX - startXRef.current)
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDragging(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const delta = dragX
    startXRef.current = null
    if (Math.abs(delta) > SWIPE_THRESHOLD) {
      commit(delta > 0)
    } else {
      setDragX(0)
    }
  }

  const likeOpacity = Math.max(0, Math.min(1, dragX / SWIPE_THRESHOLD))
  const nopeOpacity = Math.max(0, Math.min(1, -dragX / SWIPE_THRESHOLD))

  const transform = exitDir
    ? exitDir === 'right'
      ? 'translateX(120%) rotate(8deg)'
      : 'translateX(-120%) rotate(-8deg)'
    : `translateX(${dragX}px) rotate(${dragX * 0.04}deg)`

  return (
    <div className="flex h-full select-none flex-col">
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden border border-ink bg-surface text-ink"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          transform,
          opacity: exitDir ? 0 : 1,
          touchAction: 'pan-y',
          transition: dragging ? 'none' : 'transform 0.3s ease, opacity 0.3s ease',
          cursor: disabled ? 'default' : 'grab',
        }}
      >
        {/* Poster — fills the available height so the whole card fits one screen */}
        <div className="relative min-h-0 w-full flex-1 bg-surface-soft">
          {movie.posterUrl ? (
            <Image
              src={movie.posterUrl}
              alt={`${movie.title} poster`}
              fill
              sizes="(max-width: 640px) 100vw, 400px"
              className="object-cover"
              draggable={false}
              priority
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted">No image</div>
          )}

          {/* Drag stamps */}
          <div
            className="pointer-events-none absolute left-4 top-4 rotate-[-10deg] border-2 border-ink px-3 py-1 text-xl font-extrabold uppercase tracking-wider text-ink"
            style={{ opacity: likeOpacity }}
          >
            Pik
          </div>
          <div
            className="pointer-events-none absolute right-4 top-4 rotate-[10deg] border-2 border-accent px-3 py-1 text-xl font-extrabold uppercase tracking-wider text-accent"
            style={{ opacity: nopeOpacity }}
          >
            Nope
          </div>

          {/* Seen-it toggle */}
          {onToggleSeen && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onToggleSeen()
              }}
              aria-pressed={seen}
              title={
                skipReruns
                  ? 'Everyone has seen it — remove from the night'
                  : 'Mark that you have seen this'
              }
              className={`absolute bottom-3 right-3 inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] backdrop-blur-sm transition-colors ${
                seen
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-white/70 bg-black/40 text-white hover:bg-black/60'
              }`}
            >
              {seen ? '✓ Seen' : '👁 Seen it?'}
            </button>
          )}
        </div>

        {/* Info */}
        <div className="flex shrink-0 flex-col gap-1 p-4">
          <h2 className="font-serif text-xl font-bold leading-tight sm:text-2xl">{movie.title}</h2>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {movie.year}
            {movie.runtime ? ` · ${movie.runtime} min` : ''}
          </p>
          <p className="text-sm">
            <Stars rating={movie.rating} />
            <span className="ml-2 font-semibold text-ink">{movie.rating}</span>
            <span className="ml-1 text-faint">/10 IMDB</span>
          </p>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted">{movie.overview}</p>
        </div>
      </div>

      {/* Swipe hints */}
      <div className="mt-2 flex shrink-0 items-center justify-center gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
        <span>‹ Swipe to pass</span>
        <span className="text-line">|</span>
        <span>Swipe to pik ›</span>
      </div>

      {/* Buttons */}
      <div className="mt-2 flex shrink-0 gap-3">
        <button
          type="button"
          onClick={() => commit(false)}
          disabled={disabled}
          className="flex-1 rounded-none border border-accent bg-transparent py-3 text-sm font-semibold uppercase tracking-[0.12em] text-accent transition-colors hover:bg-accent hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✕ Nope
        </button>
        <button
          type="button"
          onClick={() => commit(true)}
          disabled={disabled}
          className="flex-1 rounded-none bg-ink py-3 text-sm font-semibold uppercase tracking-[0.12em] text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✓ Pik it
        </button>
      </div>
    </div>
  )
}
