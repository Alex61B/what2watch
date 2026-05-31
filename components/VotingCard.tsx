'use client'

import Image from 'next/image'
import { useRef } from 'react'

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

export default function VotingCard({ movie, onVote, disabled = false }: VotingCardProps) {
  const touchStartX = useRef<number | null>(null)

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (disabled) return
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (disabled) return
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) > 50) {
      onVote(delta > 0)
    }
  }

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
          onClick={() => onVote(false)}
          disabled={disabled}
          className="flex-1 rounded-xl bg-red-500 py-3 text-base font-semibold text-white transition-colors hover:bg-red-600 active:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          NO
        </button>
        <button
          type="button"
          onClick={() => onVote(true)}
          disabled={disabled}
          className="flex-1 rounded-xl bg-green-500 py-3 text-base font-semibold text-white transition-colors hover:bg-green-600 active:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          YES
        </button>
      </div>
    </div>
  )
}
