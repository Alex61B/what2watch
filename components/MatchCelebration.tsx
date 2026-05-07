'use client'

import Image from 'next/image'

interface MatchCelebrationProps {
  movie: {
    title: string
    posterUrl: string
    year: number
    rating: number
    overview: string
    watchUrl?: string
    streamingService?: string
  }
}

export default function MatchCelebration({ movie }: MatchCelebrationProps) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl bg-white p-8 shadow-lg">
      <h1 className="text-3xl font-extrabold text-green-500">It&apos;s a Match!</h1>

      {/* Poster */}
      <div className="relative h-72 w-48 overflow-hidden rounded-xl bg-gray-200 shadow">
        {movie.posterUrl ? (
          <Image
            src={movie.posterUrl}
            alt={`${movie.title} poster`}
            fill
            sizes="192px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-400">
            No Image
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-2xl font-bold">{movie.title}</h2>

        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>{movie.year}</span>
          <span className="text-yellow-500">★ {movie.rating}</span>
        </div>

        <p className="max-w-sm text-sm text-gray-600">{movie.overview}</p>
      </div>

      {/* Watch CTA */}
      {movie.watchUrl ? (
        <a
          href={movie.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl bg-green-500 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-green-600 active:bg-green-700"
        >
          Watch Now
        </a>
      ) : movie.streamingService ? (
        <p className="text-sm text-gray-500">Watch on {movie.streamingService}</p>
      ) : null}
    </div>
  )
}
