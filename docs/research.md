# Research — Group C: Real "Watch now on X, Y, Z" providers

Third refinement cycle. Replace the placeholder watch link on the match screen with
real per-movie streaming availability from TMDB. Design spec:
`docs/superpowers/specs/2026-06-01-group-c-watch-providers-design.md`.

## 1. Requirements Summary

- On a match, show the real streaming platforms the movie is available on ("Watch now on Netflix, Hulu, …").
- **Subscription (flatrate) providers only**, **all** that TMDB reports for the **US** region.
- When TMDB has no provider data, fall back to a generic "Find where to watch" link.
- Today `RoomQueue.streamingService` is hardcoded to the room's first selected service and `watchUrl` is a generic `themoviedb.org/movie/{id}` link — not real availability.

## 2. Stack Choices

- TMDB `GET /movie/{id}/watch/providers` → `results.<REGION>.flatrate[]` (provider_name, logo_path) plus a single regional JustWatch `link`. TMDB does **not** expose per-provider deep links, so the UI lists provider names/logos and offers the one regional `link` as the CTA.
- Reuse the existing `tmdbFetch` helper (Bearer auth + 1-hour in-memory cache). No DB change, no new dependency.
- Extract a pure `parseWatchProviders(raw, region)` (mirrors `parseMovieResult`) so parsing is unit-testable without network.
- Region: **US**, matching `buildDiscoverUrl`'s `watch_region=US`.

## 3. Environment Verification

- `lib/tmdb.ts` already centralizes TMDB access, image base, and caching; provider fetch fits the same pattern.
- The match screen reads `matchedMovie` from `GET /api/rooms/[code]/poll`. The `matchedMovie` branch only runs when `room.matchedMovieId` is set (post-match); during voting it's null, so enriching it with providers adds **no** cost to the high-frequency voting polls. The vote page redirects away on `MATCHED`, and the match page fetches poll once.
- `MatchCelebration.tsx` currently renders a single `watchUrl`/`streamingService`; it's the only consumer to change for display.
- `TMDB_API_KEY` is already required/validated by `tmdbFetch` and the start route's env check.

## 4. Risks & Edge Cases

- **No providers for region** → `parseWatchProviders` returns `{ providers: [], link: null }`; UI falls back to the regional `link` or the existing generic `watchUrl`.
- **Provider name/logo variance** (e.g. "HBO Max" vs "Max", "Amazon Prime Video") — display TMDB's names verbatim; dedupe by name to avoid repeats across flatrate tiers.
- **Extra TMDB call on match** — bounded to the matched movie and cached 1h; non-fatal (wrapped in try/catch like the existing matched-movie fetch).
- **Logo sizing** — use a small TMDB logo size base (w92) distinct from the poster base (w500).
- **Poll latency** — one added provider fetch only on the post-match poll; acceptable and cached.

## 5. Assumptions & Open Questions

- Assume US region (consistent with discover). Multi-region is out of scope.
- Assume flatrate only (confirmed); rent/buy excluded.
- Assume showing all available providers (confirmed), not just the room's selected ones.
- No open questions blocking planning.

## 6. Out of Scope

- **D** join-with-approval (next cycle).
- Per-provider deep links (TMDB doesn't provide them), rent/buy tiers, multi-region, persisting providers to `MovieCache`/DB.
- Changing how `RoomQueue.streamingService`/`watchUrl` are seeded at start (left as-is; providers are computed at match display time).

## 7. Readiness Verdict: READY FOR PLANNING

One new cached TMDB call + a pure parser, surfaced through the existing poll `matchedMovie` and rendered in `MatchCelebration`, with a clear fallback. No schema or dependency change. **READY FOR PLANNING.**
