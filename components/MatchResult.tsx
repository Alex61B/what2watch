import Image from 'next/image'
import Link from 'next/link'
import BrandMark from '@/components/BrandMark'
import BrandFooter from '@/components/BrandFooter'
import { STREAMING_SERVICES, TMDB_GENRES, buildStreamingUrl } from '@/lib/tmdb'

interface ResultMovie {
  title: string
  posterUrl: string
  year: number
  rating: number
  runtime?: number | null
  overview: string
  genreIds?: number[]
  watchUrl?: string
  streamingService?: string
  watchProviders?: { providers: { name: string; logoUrl: string }[]; link: string | null }
}

interface Member {
  id: string
  displayName: string
  isHost?: boolean
}

interface MatchResultProps {
  code: string
  movie: ResultMovie
  members: Member[]
}

const GENRE_NAMES = new Map<number, string>(TMDB_GENRES.map((g) => [g.id, g.name]))
const SERVICE_NAMES = new Map<string, string>(STREAMING_SERVICES.map((s) => [s.id, s.name]))

function Stars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating / 2)))
  return (
    <span className="text-accent" aria-label={`${rating} out of 10`}>
      {'★'.repeat(filled)}
      <span className="text-line">{'★'.repeat(5 - filled)}</span>
    </span>
  )
}

/**
 * The final-result layout (PDF pages 4–5): a dark hero band announcing the pick,
 * then the movie detail, the room roster, and the "watch on …" CTA.
 */
export default function MatchResult({ code, movie, members }: MatchResultProps) {
  const count = members.length
  const genreNames = (movie.genreIds ?? [])
    .map((id) => GENRE_NAMES.get(id))
    .filter((n): n is string => Boolean(n))
    .slice(0, 3)

  const providerName = movie.watchProviders?.providers?.[0]?.name
  const serviceName =
    providerName ??
    (movie.streamingService ? SERVICE_NAMES.get(movie.streamingService) : undefined) ??
    'your service'
  // Prefer a deep link into the actual streaming service; only fall back to the
  // TMDB watch link when we can't recognise the service.
  const serviceUrl = buildStreamingUrl({
    providerName,
    serviceId: movie.streamingService,
    title: movie.title,
  })
  const watchLink = serviceUrl ?? movie.watchProviders?.link ?? movie.watchUrl ?? null

  return (
    <main className="min-h-screen bg-canvas text-ink">
      {/* Dark hero band — fixed dark in both themes */}
      <div className="bg-[#16130f] text-white">
        <div className="mx-auto w-full max-w-2xl px-5 py-5 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <BrandMark size="sm" tone="inverse" />
            <span className="inline-flex items-center gap-1.5 border border-white/30 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              {code}
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-4 pb-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                All votes in
              </p>
              <h1 className="mt-1 font-serif text-5xl font-bold leading-[0.95] text-white">
                Tonight&apos;s
                <br />
                <span className="italic text-accent">pick.</span>
              </h1>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-1.5">
                {members.slice(0, 6).map((m) => (
                  <span
                    key={m.id}
                    title={m.displayName}
                    className="flex h-7 w-7 items-center justify-center bg-accent text-xs font-bold text-accent-ink"
                  >
                    {m.displayName.charAt(0).toUpperCase()}
                  </span>
                ))}
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
                ✓ {count}/{count} matched
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Movie detail */}
      <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
        <div className="relative aspect-[16/10] w-full overflow-hidden border border-line bg-surface-soft">
          {movie.posterUrl ? (
            <Image
              src={movie.posterUrl}
              alt={`${movie.title} poster`}
              fill
              sizes="(max-width: 672px) 100vw, 672px"
              className="object-cover"
              priority
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted">No image</div>
          )}
        </div>

        <h2 className="mt-6 font-serif text-4xl font-bold text-ink">{movie.title}</h2>
        <p className="mt-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">
          {movie.year}
          {movie.runtime ? ` · ${movie.runtime} min` : ''}
        </p>
        <p className="mt-2 text-sm">
          <Stars rating={movie.rating} />
          <span className="ml-2 font-semibold text-ink">{movie.rating}</span>
          <span className="ml-1 text-faint">/10 IMDB</span>
        </p>

        {genreNames.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {genreNames.map((name) => (
              <span
                key={name}
                className="border border-ink px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink"
              >
                {name}
              </span>
            ))}
          </div>
        )}

        <p className="mt-4 text-sm leading-relaxed text-muted">{movie.overview}</p>

        {/* The room */}
        <section className="mt-8 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">The room</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 border border-line bg-surface px-3 py-2.5"
              >
                <span className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 items-center justify-center bg-accent text-xs font-bold text-accent-ink">
                    {m.displayName.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-sm font-medium text-ink">{m.displayName}</span>
                </span>
                <span className="flex h-5 w-5 items-center justify-center bg-ink text-[11px] text-canvas">
                  ✓
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="my-8 h-px bg-line" />

        {/* Available on */}
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
            Available on
          </p>
          {watchLink ? (
            <a
              href={watchLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-between bg-accent px-5 py-4 text-sm font-bold uppercase tracking-[0.12em] text-accent-ink transition-opacity hover:opacity-90"
            >
              <span>● Watch on {serviceName}</span>
              <span aria-hidden>↗</span>
            </a>
          ) : (
            <p className="text-sm text-muted">Check {serviceName} for availability.</p>
          )}
          <div className="pt-1 text-center">
            <Link
              href="/"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink underline-offset-4 hover:underline"
            >
              ↻ Pik again
            </Link>
          </div>
        </section>

        <div className="mt-10">
          <BrandFooter />
        </div>
      </div>
    </main>
  )
}
