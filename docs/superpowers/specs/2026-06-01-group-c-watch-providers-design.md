# Group C — Watch Providers Design

**Date:** 2026-06-01
**Cycle:** Third of four (A, B shipped; D = join-with-approval later).
**Status:** Approved for planning.

## Goal

On a match, show the real streaming platforms a movie is available on ("Watch now on Netflix, Hulu, …") using TMDB's per-movie provider data, with a generic fallback link when none are known.

## Decisions (confirmed)
- Subscription (**flatrate**) providers only.
- Show **all** providers TMDB reports for the **US** region.
- **Fallback:** generic "Find where to watch" link when no providers.

## lib/tmdb.ts
- Add a logo base: `const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w92'`.
- Types:
  ```ts
  export interface WatchProvider { name: string; logoUrl: string }
  export interface WatchProviders { providers: WatchProvider[]; link: string | null }
  ```
- `buildWatchProvidersUrl(tmdbId)` → `${TMDB_BASE}/movie/${tmdbId}/watch/providers`.
- `parseWatchProviders(raw, region = 'US'): WatchProviders` (pure, unit-tested):
  - `regionData = raw.results?.[region]`; if absent → `{ providers: [], link: null }`.
  - `providers` = `regionData.flatrate ?? []` mapped to `{ name: provider_name, logoUrl: logo_path ? TMDB_LOGO_BASE+logo_path : '' }`, deduped by name.
  - `link` = `regionData.link ?? null`.
- `getWatchProviders(tmdbId, region = 'US')` = `parseWatchProviders(await tmdbFetch(buildWatchProvidersUrl(tmdbId)), region)`.

## API: poll route
- In `app/api/rooms/[code]/poll/route.ts`, where `matchedMovie` is built (only when `room.matchedMovieId` is set), attach `watchProviders` via `getWatchProviders(room.matchedMovieId)`, wrapped in try/catch (non-fatal → `{ providers: [], link: null }`). Keep existing `watchUrl` as the ultimate fallback.

## UI: MatchCelebration.tsx
- Extend the `movie` prop with `watchProviders?: WatchProviders`.
- Render logic:
  - If `watchProviders.providers.length > 0`: heading "Watch now on" + a row of provider chips (logo + name). CTA button "Watch now →" linking to `watchProviders.link ?? movie.watchUrl` (new tab).
  - Else if `watchProviders.link || movie.watchUrl`: a single "Find where to watch" button to that link.
  - Else: no watch CTA.
- Keep existing poster/title/overview layout.

## match/page.tsx
- Extend `MatchedMovie` interface with `watchProviders?: WatchProviders` and pass it through (already forwards the whole object to `MatchCelebration`).

## Tests
- `__tests__/lib/tmdb.test.ts`: add `parseWatchProviders` cases — maps flatrate names+logos for US; dedupes; returns empty+null when region missing; returns `link` when present; logo base applied.

## Files
`lib/tmdb.ts`, `app/api/rooms/[code]/poll/route.ts`, `components/MatchCelebration.tsx`, `app/room/[code]/match/page.tsx`, `__tests__/lib/tmdb.test.ts`.

## Out of Scope
Per-provider deep links (unavailable from TMDB), rent/buy, multi-region, DB persistence of providers, changing start-time queue seeding. Group D.
