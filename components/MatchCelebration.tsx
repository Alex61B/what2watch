'use client'

import Image from 'next/image'

interface WatchProvider {
  name: string
  logoUrl: string
}

interface MatchCelebrationProps {
  movie: {
    title: string
    posterUrl: string
    year: number
    rating: number
    overview: string
    watchUrl?: string
    streamingService?: string
    watchProviders?: { providers: WatchProvider[]; link: string | null }
  }
}

export default function MatchCelebration({ movie }: MatchCelebrationProps) {
  const providers = movie.watchProviders?.providers ?? []
  const watchLink = movie.watchProviders?.link ?? movie.watchUrl ?? null

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

      {/* Watch availability */}
      {providers.length > 0 ? (
        <div className="flex w-full flex-col items-center gap-3">
          <p className="text-sm font-medium text-gray-500">Watch now on</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {providers.map(p => (
              <span
                key={p.name}
                className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-1 pl-1 pr-3 text-sm font-medium text-gray-700"
              >
                {p.logoUrl ? (
                  <Image
                    src={p.logoUrl}
                    alt={`${p.name} logo`}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                ) : (
                  <span className="h-6 w-6 rounded-full bg-gray-200" />
                )}
                {p.name}
              </span>
            ))}
          </div>
          {watchLink && (
            <a
              href={watchLink}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-green-500 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-green-600 active:bg-green-700"
            >
              Watch Now
            </a>
          )}
        </div>
      ) : watchLink ? (
        <a
          href={watchLink}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl bg-green-500 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-green-600 active:bg-green-700"
        >
          Find where to watch
        </a>
      ) : null}
    </div>
  )
}
