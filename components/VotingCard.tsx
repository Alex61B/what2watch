'use client'

import Image from 'next/image'
import { useRef } from 'react'

interface VotingCardProps {
  movie: {
    tmdbId: string
    title: string
    overview: string
    posterUrl: string
    year: number
    rating: number
    runtime: number | null
    genreIds: number[]
  }
  onVote: (vote: boolean) => void
}

export default function VotingCard({ movie, onVote }: VotingCardProps) {
  const touchStartX = useRef<number | null>(null)

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) > 50) {
      onVote(delta > 0)
    }
  }

  const runtimeText =
    movie.runtime !== null ? ` · ${movie.runtime} min` : ''

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-lg"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
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
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-400">
            No Image
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h2 className="text-xl font-bold leading-tight">{movie.title}</h2>

        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>{movie.year}{runtimeText}</span>
          <span className="text-yellow-500">★ {movie.rating}</span>
        </div>

        <p className="line-clamp-3 text-sm text-gray-600">{movie.overview}</p>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 p-4 pt-0">
        <button
          type="button"
          onClick={() => onVote(false)}
          className="flex-1 rounded-xl bg-red-500 py-3 text-base font-semibold text-white transition-colors hover:bg-red-600 active:bg-red-700"
        >
          NO
        </button>
        <button
          type="button"
          onClick={() => onVote(true)}
          className="flex-1 rounded-xl bg-green-500 py-3 text-base font-semibold text-white transition-colors hover:bg-green-600 active:bg-green-700"
        >
          YES
        </button>
      </div>
    </div>
  )
}
