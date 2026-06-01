# Group C — Watch Providers Implementation Plan

Design: `docs/superpowers/specs/2026-06-01-group-c-watch-providers-design.md`
Research: `docs/research.md`

## 1. Schema changes
None. No migration, no new dependency.

## 2. lib/tmdb.ts
- Add `TMDB_LOGO_BASE` (w92).
- Add `WatchProvider` / `WatchProviders` interfaces.
- Add `buildWatchProvidersUrl(tmdbId)`.
- Add pure `parseWatchProviders(raw, region = 'US')`: flatrate → `{name, logoUrl}` (deduped), `link`; empty+null when region missing.
- Add `getWatchProviders(tmdbId, region = 'US')` = `tmdbFetch` + `parseWatchProviders`.

## 3. API — poll route
- `app/api/rooms/[code]/poll/route.ts`: when `matchedMovie` is built, attach `watchProviders` via `getWatchProviders(room.matchedMovieId)` in a try/catch (non-fatal → empty). Existing `watchUrl` retained as fallback.

## 4. UI
- `components/MatchCelebration.tsx`: accept `watchProviders`; render "Watch now on" + provider chips (logo + name) and a CTA to `watchProviders.link ?? watchUrl`; fallback "Find where to watch" link; nothing if no link at all.
- `app/room/[code]/match/page.tsx`: extend `MatchedMovie` with `watchProviders?` and forward it.

## 5. Tests
- `__tests__/lib/tmdb.test.ts`: `parseWatchProviders` — US flatrate mapping + logo base, dedupe by name, region-missing → `{ providers: [], link: null }`, `link` passthrough.

## 6. Acceptance criteria
- A matched movie with TMDB US flatrate providers shows them by name/logo with a working CTA link.
- A matched movie with no provider data shows a single "Find where to watch" link.
- Provider fetch only happens post-match (not during voting polls) and is cached.
- `npm run typecheck && npm run lint && npm test` pass.
