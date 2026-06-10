'use client'

import { useState } from 'react'
import StreamingServicePicker from '@/components/StreamingServicePicker'
import { ServiceId, TMDB_GENRES } from '@/lib/tmdb'

// Each level maps to a TMDB review-count (vote_count) band in lib/tmdb.ts —
// lower level = heavily reviewed / mainstream, higher level = lightly reviewed /
// obscure. The blurbs describe that gradient.
export const DEPTH_LEVELS = [
  { level: 1, name: 'Crowd-Pleaser', blurb: 'Heavily-reviewed hits everyone knows.' },
  { level: 2, name: 'Easy Watch', blurb: 'Popular, widely-seen picks.' },
  { level: 3, name: 'The Sweet Spot', blurb: 'Well-reviewed, a little under the radar.' },
  { level: 4, name: 'Deep Cut', blurb: 'Lightly reviewed. Requires a brief explanation at dinner.' },
  { level: 5, name: 'Certified Cinephile', blurb: "Deep-catalog obscurities nobody else has seen." },
] as const

export interface FilterControlsProps {
  services: ServiceId[]
  onServicesChange: (services: ServiceId[]) => void
  minRating: number
  maxRating: number
  onRatingChange: (min: number, max: number) => void
  maxRuntime: number | ''
  onMaxRuntimeChange: (value: number | '') => void
  genres: number[]
  onGenresChange: (genres: number[]) => void
  skipReruns: boolean
  onSkipRerunsChange: (value: boolean) => void
  /** 1–5 "how deep are we going" dial — maps to a review-count band in discovery. */
  depth: number
  onDepthChange: (depth: number) => void
  /** Disable interactive controls (e.g. while a mutation is in flight). */
  busy?: boolean
  /** Show the red "select at least one service" error under the picker. */
  showServicesError?: boolean
}

const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-faint'

/**
 * The full set of room filter controls — streaming services, IMDB rating range,
 * max runtime, genres, "skip the reruns", and the review-count depth dial. Fully
 * controlled so it can drive both the setup page (live PATCH on change) and the
 * host's mid-session editor (staged, applied on confirm).
 */
export default function FilterControls({
  services,
  onServicesChange,
  minRating,
  maxRating,
  onRatingChange,
  maxRuntime,
  onMaxRuntimeChange,
  genres,
  onGenresChange,
  skipReruns,
  onSkipRerunsChange,
  depth,
  onDepthChange,
  busy = false,
  showServicesError = false,
}: FilterControlsProps) {
  const [activeThumb, setActiveThumb] = useState<'min' | 'max'>('max')

  function handleMin(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Math.min(parseFloat(e.target.value), maxRating)
    onRatingChange(val, maxRating)
  }
  function handleMax(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Math.max(parseFloat(e.target.value), minRating)
    onRatingChange(minRating, val)
  }

  function toggleGenre(id: number) {
    onGenresChange(genres.includes(id) ? genres.filter((g) => g !== id) : [...genres, id])
  }

  const ratingLabel = minRating === 0 && maxRating >= 10 ? 'Any' : `${minRating} – ${maxRating}`
  const activeDepth = DEPTH_LEVELS.find((d) => d.level === depth) ?? DEPTH_LEVELS[2]

  return (
    <div className="space-y-8">
      {/* Streaming services — required */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className={EYEBROW}>
            Required · Streaming services
          </p>
          <span className="text-[11px] text-faint">{services.length} selected</span>
        </div>
        <StreamingServicePicker selected={services} onChange={onServicesChange} />
        {showServicesError && (
          <p className="text-xs font-medium text-accent">
            ↑ Select at least one streaming service to continue.
          </p>
        )}
      </section>

      <div className="h-px bg-line" />

      <p className={EYEBROW}>Optional · Filters</p>

      {/* Rating range — dual-handle slider */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className={EYEBROW}>Minimum IMDB rating</label>
          <span className="border border-ink px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink">
            {ratingLabel}
          </span>
        </div>
        <div className="relative mx-1" style={{ height: 20 }}>
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] bg-surface-soft" />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-[3px] bg-accent"
            style={{
              left: `${(minRating / 10) * 100}%`,
              right: `${((10 - maxRating) / 10) * 100}%`,
            }}
          />
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={minRating}
            onPointerDown={() => setActiveThumb('min')}
            onChange={handleMin}
            disabled={busy}
            className="dual-thumb absolute w-full h-full"
            style={{ zIndex: activeThumb === 'min' ? 5 : 4 }}
            aria-label="Minimum rating"
          />
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={maxRating}
            onPointerDown={() => setActiveThumb('max')}
            onChange={handleMax}
            disabled={busy}
            className="dual-thumb absolute w-full h-full"
            style={{ zIndex: activeThumb === 'max' ? 5 : 4 }}
            aria-label="Maximum rating"
          />
        </div>
        <div className="flex justify-between text-[11px] text-faint">
          <span>0</span>
          <span>10</span>
        </div>
      </section>

      {/* Max runtime — free-form */}
      <section className="space-y-2">
        <label htmlFor="maxRuntime" className={EYEBROW}>
          Max runtime (minutes)
        </label>
        <input
          id="maxRuntime"
          type="number"
          min={1}
          step={1}
          placeholder="Any length — leave blank"
          value={maxRuntime}
          disabled={busy}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return onMaxRuntimeChange('')
            const val = parseInt(raw, 10)
            if (!Number.isNaN(val)) onMaxRuntimeChange(val)
          }}
          className="w-full rounded-none border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder-faint focus:border-ink focus:outline-none disabled:opacity-50"
        />
      </section>

      {/* Genres */}
      <section className="space-y-2">
        <p className={EYEBROW}>What&apos;s the vibe?</p>
        <div className="flex flex-wrap gap-2">
          {TMDB_GENRES.map((genre) => {
            const active = genres.includes(genre.id)
            return (
              <button
                key={genre.id}
                type="button"
                disabled={busy}
                onClick={() => toggleGenre(genre.id)}
                className={`rounded-none border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors disabled:opacity-50 ${
                  active
                    ? 'border-ink bg-ink text-canvas'
                    : 'border-line bg-surface text-muted hover:border-ink hover:text-ink'
                }`}
              >
                {genre.name}
              </button>
            )
          })}
        </div>
      </section>

      {/* Skip the reruns */}
      <section className="flex items-center justify-between gap-4 border border-line bg-surface p-4">
        <div className="space-y-0.5">
          <p className="font-semibold text-ink">Skip the Reruns</p>
          <p className="text-sm text-muted">
            Exclude movies anyone in the group has already marked as seen.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={skipReruns}
          aria-label="Skip the reruns"
          disabled={busy}
          onClick={() => onSkipRerunsChange(!skipReruns)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-none border border-ink transition-colors disabled:opacity-60 ${
            skipReruns ? 'bg-accent' : 'bg-surface-soft'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform bg-ink transition-transform ${
              skipReruns ? 'translate-x-[22px] bg-white' : 'translate-x-[2px]'
            }`}
          />
        </button>
      </section>

      {/* Depth — cosmetic dial */}
      <section className="space-y-2">
        <p className={EYEBROW}>How deep are we going?</p>
        <div className="grid grid-cols-5 gap-2">
          {DEPTH_LEVELS.map((d) => {
            const active = d.level === depth
            return (
              <button
                key={d.level}
                type="button"
                disabled={busy}
                onClick={() => onDepthChange(d.level)}
                className={`rounded-none border py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  active
                    ? 'border-ink bg-ink text-canvas'
                    : 'border-line bg-surface text-muted hover:border-ink hover:text-ink'
                }`}
              >
                {d.level}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between border border-line bg-surface px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">{activeDepth.name}</p>
            <p className="text-xs text-muted">{activeDepth.blurb}</p>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
            Lvl {activeDepth.level}
          </span>
        </div>
      </section>
    </div>
  )
}
