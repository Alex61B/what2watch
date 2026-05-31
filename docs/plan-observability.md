# Plan: Observability Across Voting/Queue/TMDB Routes

**Goal:** Every production incident in the voting/queue/TMDB code paths should be diagnosable from Vercel logs alone.

**Architecture:** Direct `console.log/warn/error` with tagged prefixes (`[route] ...`, `[queue]`, `[advanceQueue]`, `[tmdb]`, `[vote]`) and structured object payloads. No new dependency. Per-handler `stage` breadcrumb updated before each major step; top-level try/catch logs the breadcrumb on failure.

**Tech Stack:** `console.*`; no logger library.

---

## Log shape conventions (all routes)

| Event | Call | Payload |
|---|---|---|
| Request start | `console.log("[route] request", {...})` | `roomCode`, `memberId` (after session resolution; omit on pre-session log), `userId` (member.userId, may be null), `timestamp: new Date().toISOString()` |
| DB lookup | `console.log("[route] <entity> lookup", {...})` | identifying field + `found: boolean` |
| Early return (4xx) | `console.warn("[route] returning <status>", {...})` | `reason: 'machine_code'`, identifying context |
| Queue state | `console.log("[queue]", {...})` | `roomId`, `currentPosition`, `queueVersion`, `queueLength` |
| Vote applied | `console.log("[vote]", {...})` | `roomId`, `movieId`, `vote`, `memberId` |
| Queue advance result | `console.log("[advanceQueue]", {...})` | `roomId`, `oldPosition`, `newPosition`, `trigger: 'no'\|'match'`, `result: 'advanced'\|'cas_lost'\|'room_vanished'` |
| TMDB request | `console.log("[tmdb] request", {...})` | `url`, `filters?` |
| TMDB response | `console.log("[tmdb] response", {...})` | `status`, `resultCount?`, `cacheHit: boolean` |
| Fatal | `console.error("[route] fatal error", {...})` | `stage`, `name`, `message`, `stack` |

`reason` codes used:
- `unauthorized_no_session`, `unauthorized_no_member`, `room_not_found`, `room_wrong_state` (with `actual` and `required`), `bad_request_missing_field`, `stale_vote`, `host_only`, `not_enough_members`, `no_streaming_services`, `no_movies_found`, `tmdb_failed`.

---

## File-by-file changes

### `lib/tmdb.ts`
- In `tmdbFetch`: log `[tmdb] request` before fetch (URL + cache lookup result); log `[tmdb] response` after — include `status`, `cacheHit`. On non-OK, the existing throw is preserved; the caller's catch handles it.
- In `discoverMovies`: per-page request loop already calls `tmdbFetch`, no additional log needed at this layer beyond the existing per-fetch logs.

### `lib/queue.ts` — `advanceQueueAtomic`
- Log `[queue]` before CAS attempt with `expectedPosition`, `expectedVersion`.
- Log `[advanceQueue]` after each terminal branch: success / `cas_lost` / `room_vanished` / drained-transition. Include `oldPosition`, `newPosition`, `result`, and `status`.

### `app/api/rooms/[code]/start/route.ts`
- Already has `stage`-based catch and env-presence log. Update each handled early return to emit `console.warn("[start] returning <status>", { reason, ... })` to match the spec.
- Replace `console.log('[rooms/start] env ...')` with `console.log('[start] env', ...)` for consistency.

### `app/api/rooms/[code]/poll/route.ts`
- Wrap in `let stage = 'init'; try { ... } catch { console.error('[poll] fatal error', ...) }`.
- Request log after session resolution (with memberId/userId).
- Lookup logs for member + room.
- Early returns: 401 (no session), 401 (no member), 404 (room mismatch).
- 304 path: one-line `console.log('[poll] 304', { roomId, queueVersion })`.
- 200 path: emit `[queue]` log after computing `currentPosition`, `queueVersion`, `queueLength`.

### `app/api/rooms/[code]/votes/route.ts`
- Wrap in try/catch.
- Request log, member/room lookup logs, all four early-return warns (401s, 404, 409 wrong-state, 400 missing field, 409 stale-vote).
- Before the vote upsert: `console.log('[vote]', { roomId, movieId, vote, memberId })`.
- After advance: `[advanceQueue]` is emitted by the helper, but the route also logs the trigger (`'no'` vs `'match'`) via `console.log('[votes] advance', { trigger, result })`.
- On match: `console.log('[votes] match', { roomId, movieId, matchedMovieId })`.

### `app/api/rooms/[code]/watched/route.ts`
- Wrap in try/catch.
- Request log, lookup logs, early-return warns (401s, 404, 400 missing field).
- Watched upsert: `console.log('[watched] upsert', { roomId, memberId, tmdbMovieId })`.

### `app/api/rooms/[code]/queue/route.ts`
- Wrap in try/catch.
- Request log, lookup logs, early-return warns (401s, 404, exhausted).
- Before next-movie selection: `console.log('[queue] excluded', { votedCount, rejectedCount, watchedCount })`.
- On exhaustion (return null): `console.warn('[queue] returning 200 null', { reason: 'no_eligible_movie', roomId, memberId })`.

---

## Acceptance criteria

1. **Every 4xx response has a `console.warn` preceding it** with a `reason` code in the payload. Verified by grep on the modified files: every `NextResponse.json({...}, { status: 4XX })` is preceded within ~5 lines by a `console.warn` whose payload contains a `reason:` key.

2. **Every route has a top-level try/catch** whose catch emits `console.error("[route] fatal error", { stage, name, message, stack })`. Verified by grep: every modified `route.ts` contains both `try {` and `console.error.*fatal error`.

3. **All TMDB calls log request and response** with `url`, `status`, and `cacheHit`. Verified by reading `lib/tmdb.ts` after edit.

4. **All queue advances log** the `oldPosition → newPosition` transition with `trigger` and `result`. Verified by reading `lib/queue.ts` and the votes route after edit.

5. **`bash scripts/verify.sh` exits 0** — typecheck, lint, and Jest still green. Existing tests must continue to pass without modification; logging is additive.

---

## File manifest (`.workflow_plan_files`)

```
app/api/rooms/[code]/start/route.ts
app/api/rooms/[code]/poll/route.ts
app/api/rooms/[code]/votes/route.ts
app/api/rooms/[code]/watched/route.ts
app/api/rooms/[code]/queue/route.ts
lib/queue.ts
lib/tmdb.ts
```

7 files. No new files; no schema or test changes required.

---

## Additional instrumentation worth flagging (NOT implemented in this cycle)

Things I'd add given more scope, with one sentence on why each:

1. **Per-request correlation ID.** A `crypto.randomUUID()` generated at the top of each handler, included in every log line. Lets you grep one request's entire log trace out of an interleaved Vercel stream.
2. **Request duration.** `const t0 = Date.now()` at the top; `Date.now() - t0` in a final `[route] done` log. Surfaces tail latency without external tooling.
3. **TMDB cache hit-rate counter.** Per-route counter logged on each request: `hits/misses` totals since cold start. Tells you whether the in-memory cache is actually saving calls under real polling load.
4. **CAS attempt counter.** In `lib/queue.ts`, count cas_lost outcomes. A spike means real contention; a flatline plus `[queue]` logs showing stuck positions means the CAS is wedged.
5. **Match decision dump.** When `checkForMatch` returns null, log `yesCount / activeCount` per movie so "why didn't we match?" is answerable from logs alone.
6. **Sentry / Axiom forwarder.** Vercel logs are lossy and time-bounded; piping `console.error` into a dedicated sink survives the 1-hour retention. ~10 min to wire up the SDK.
7. **Structured logger (pino).** Once log shapes stabilize, central library reduces drift between routes and adds severity/serializer ergonomics.

Items 1 and 2 give the most leverage per minute of work. Items 6 and 7 are infrastructure choices the project should decide together, not bundled into a debugging PR.
