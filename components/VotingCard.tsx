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
}

// Past this horizontal drag distance (px), releasing commits the vote.
const SWIPE_THRESHOLD = 100

export default function VotingCard({ movie, onVote, disabled = false }: VotingCardProps) {
  const startXRef = useRef<number | null>(null)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [exitDir, setExitDir] = useState<'left' | 'right' | null>(null)

  // Commit a vote: fly the card off in the matching direction and notify the
  // parent synchronously (buttons and threshold-swipes share this path).
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
      setDragX(0) // springs back via the transition below
    }
  }

  const likeOpacity = Math.max(0, Math.min(1, dragX / SWIPE_THRESHOLD))
  const nopeOpacity = Math.max(0, Math.min(1, -dragX / SWIPE_THRESHOLD))

  const transform = exitDir
    ? exitDir === 'right'
      ? 'translateX(120%) rotate(12deg)'
      : 'translateX(-120%) rotate(-12deg)'
    : `translateX(${dragX}px) rotate(${dragX * 0.05}deg)`

  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-lg select-none"
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
      {/* Poster */}
      <div className="relative h-72 w-full bg-gray-200">
        {movie.posterUrl ? (
          <Image
            src={movie.posterUrl}
            alt={`${movie.title} poster`}
            fill
            sizes="(max-width: 640px) 100vw, 400px"
            className="object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-400">
            No Image
          </div>
        )}

        {/* LIKE / NOPE drag stamps */}
        <div
          className="pointer-events-none absolute left-4 top-4 rotate-[-12deg] rounded-md border-4 border-green-500 px-3 py-1 text-2xl font-extrabold uppercase tracking-wider text-green-500"
          style={{ opacity: likeOpacity }}
        >
          Like
        </div>
        <div
          className="pointer-events-none absolute right-4 top-4 rotate-[12deg] rounded-md border-4 border-red-500 px-3 py-1 text-2xl font-extrabold uppercase tracking-wider text-red-500"
          style={{ opacity: nopeOpacity }}
        >
          Nope
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
          <h2 className="text-lg font-bold leading-tight text-white drop-shadow">
            {movie.title}
          </h2>
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>{movie.year}{movie.runtime ? ` · ${movie.runtime} min` : ''}</span>
          <span className="text-yellow-500">★ {movie.rating}</span>
        </div>

        <p className="line-clamp-3 text-sm text-gray-600">{movie.overview}</p>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 p-4 pt-0">
        <button
          type="button"
          onClick={() => commit(false)}
          disabled={disabled}
          className="flex-1 rounded-xl bg-red-500 py-3 text-base font-semibold text-white transition-colors hover:bg-red-600 active:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          NO
        </button>
        <button
          type="button"
          onClick={() => commit(true)}
          disabled={disabled}
          className="flex-1 rounded-xl bg-green-500 py-3 text-base font-semibold text-white transition-colors hover:bg-green-600 active:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          YES
        </button>
      </div>
    </div>
  )
}
