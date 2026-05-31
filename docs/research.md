# Research: Structured Observability Across Voting/Queue/TMDB Code Paths

## Requirements Summary

Add structured `console.log` / `console.warn` / `console.error` calls across the five voting/queue API routes (`poll`, `start`, `votes`, `watched`, `queue`) plus `lib/queue.ts` (CAS helper) and `lib/tmdb.ts` (external API client) so that production incidents can be diagnosed from Vercel logs alone — without local reproduction.

Concretely, every route must log:

1. **Request start** — `roomCode`, `memberId` (after session resolution), `userId`, `timestamp`.
2. **Database lookups** — entity name + `found: boolean`.
3. **Early returns** — `console.warn` with the response status and a machine-readable `reason` code, before every 400/401/403/404/409.
4. **Queue state reads/writes** — `roomId`, `currentPosition`, `queueVersion`, `queueLength`.
5. **Vote events** — `roomId`, `movieId`, `vote`, `memberId`.
6. **Queue advancement** — `oldPosition`, `newPosition`, `trigger` (NO/match/etc).
7. **TMDB request/response** — `url`, `filters`, response `status`, `resultCount`.
8. **Fatal errors** — top-level try/catch with `console.error({ stage, name, message, stack })`.

The existing `/api/rooms/[code]/start` route already follows this pattern (shipped 2026-05-31 in commit `b1f1135`). This cycle extends the pattern to the other routes and to the shared `lib/` helpers.

## Stack Choices

| Concern | Choice | Rationale |
|---|---|---|
| Logging mechanism | Plain `console.log/warn/error` with object payloads | The user spec asks for this verbatim; Vercel's log stream JSON-encodes object payloads automatically and exposes them in the log search UI. No new dependency. |
| Log structure | Tagged prefix (`[route]`, `[queue]`, `[advanceQueue]`, `[tmdb]`, `[vote]`) + structured object | Tags make Vercel's log-search filter trivial (`[advanceQueue]` finds every queue advance). Keeps the spec uniform. |
| Helper extraction | **No** central `lib/log.ts` helper for the MVP | User spec asks for direct `console.log` calls; extracting a wrapper now adds an abstraction the user didn't request. Easy to refactor later when log shape stabilizes. |
| Sensitive-value handling | Log IDs, not session tokens or full request bodies | `memberId`, `userId`, `roomId`, `tmdbMovieId` are safe. The TMDB API key lives in the Authorization header, not the URL, so logging the URL is safe. Never log session tokens or password hashes. |
| Stage breadcrumb | Mutable `let stage = '...'` updated before each major step, included in the catch payload | Matches the `start` route's existing pattern. The catch handler then logs `stage` so any uncaught throw is pinpointed to a specific step. |

## Environment Verification

- `.workflow_state` = RESEARCH (post-cycle reset, confirmed).
- Production deploy is live at `https://what2watch-gamma-sable.vercel.app` serving commit `3a388a1` (verified earlier in this session via the deployments API).
- The existing `start` route's stage-breadcrumb pattern (shipped earlier) is the model — readers will recognize the same shape across all instrumented routes.
- Vercel's log retention surface accepts structured object args to `console.log` and renders them as JSON in the Functions log view. No `pino`/`winston` setup needed.

## Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| **Log volume / cost.** Polling fires every 1.5s per active client; `[poll]` would emit several hundred logs per session. | The 304-cache-hit path in `/poll` short-circuits early and emits only one terse log line per 304. The hot 200 path runs only when `queueVersion` actually changes — bounded by veto/match frequency, not poll frequency. |
| **Sensitive data leakage.** Logging `request.body` would expose session details; logging full Vote objects would expose voting patterns. | Spec-allowed fields only: IDs, codes, booleans, counts. Bodies are not logged in full. TMDB key is in the header, not the URL — `url` is safe to log. |
| **Pre-existing logs muddling output.** `start` already has logs. | Pattern is identical, no duplication. Existing logs are kept. |
| **Logging breaks code paths via thrown errors.** A `JSON.stringify` cycle inside `console.log` would crash the handler. | Payloads are all flat objects of primitives. No circular structures. |
| **Test mocks emit logs.** Jest tests will run our new console calls and clutter stdout. | Jest captures stdout; the test runner already tolerates this (see existing `start` tests). Optional: silence via a global Jest setup, but not in this PR. |
| **TMDB URL logging exposes filter values.** Filters are user-selected genres/runtime/rating; not sensitive. | Allowed. |
| **Async ordering of `console.log`.** Vercel orders by entry timestamp; structured logs should still appear in execution order. | Acceptable; if interleaving becomes an issue later, a per-request UUID added to every payload restores ordering. |

## Assumptions & Open Questions

**Assumptions:**

1. Vercel's log search permits free-text/grep matching on the tag prefixes (`[advanceQueue]`, `[tmdb]`, etc.). True for the standard Functions log view.
2. `console.warn` and `console.error` are surfaced in the same log stream as `console.log` with severity markers. True for Vercel.
3. Adding logging is purely additive; no behavioral change to any handler. Existing tests should continue to pass unchanged.

**Open questions (will surface in PLAN if blocking):**

1. Should every poll request log a single line even on 304? (Default: yes — terse one-liner `[poll] 304 cache hit, roomId=X, version=V`. Otherwise 304s are silent which makes "is the client polling at all?" hard to answer.)
2. Add a per-request correlation ID (UUID) so a single request's many log lines can be grep'd together? (Default: defer to a follow-up; user spec doesn't include it. List as recommended additional instrumentation in the plan.)

## Out of Scope

- Replacing `console.*` with a structured logger (pino, winston, sentry).
- Sentry / Axiom integration.
- Metrics / counters / tracing spans (OpenTelemetry).
- Log redaction beyond what the spec already implies.
- Adding logging to routes outside the listed five (e.g., `/api/auth/*`, `/api/rooms/[code]/route.ts`, `/api/rooms/[code]/members`) — separate task.
- Test changes beyond what's strictly required to keep them passing.

## Readiness Verdict: READY FOR PLANNING

All seven sections complete. The spec is concrete (the user supplied example log shapes), the file set is bounded (5 routes + 2 lib files), and there's no design ambiguity. Proceed to PLAN.
