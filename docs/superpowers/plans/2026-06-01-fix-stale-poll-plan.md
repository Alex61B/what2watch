# Bugfix Plan — stale poll responses

Research: `docs/research.md`

## Root cause
`/api/rooms/[code]/poll` responses carry an `ETag` (= `queueVersion`) but no `Cache-Control`. The browser caches them; since `queueVersion` doesn't change on LOBBY→VOTING or on member-join, the cached body is served stale (often via a `304`). → setup roster stale (Bug 1), lobby/vote stuck on "Waiting for the host to start…" (Bug 2).

## Changes
1. **`app/api/rooms/[code]/poll/route.ts`** — add `Cache-Control: no-store` to the poll responses:
   - the `200` response headers (alongside the existing `ETag`),
   - the `304` response headers.
   (Leave the ETag in place — the vote page's manual `If-None-Match` 304 optimization still works server-side.)
2. **`app/room/[code]/lobby/page.tsx`** — add `{ cache: 'no-store' }` to the poll `fetch` (defense in depth).
3. **`app/room/[code]/setup/page.tsx`** — add `{ cache: 'no-store' }` to the poll `fetch`.
4. **`app/room/[code]/vote/page.tsx`** — add `cache: 'no-store'` to the poll `fetch` options (it already passes `{ headers }`).
5. **`__tests__/api/poll-cache.test.ts`** (new, node env) — assert the poll `200` response and the `304` response both set `Cache-Control: no-store`.

## Acceptance criteria
- Poll `200` and `304` responses include `Cache-Control: no-store`.
- (Manual) With the fix, a second browser on the lobby advances to voting when the host starts; the host's setup roster gains a new member within one poll interval.
- `npm run typecheck && npm run lint && npm test` pass.

## Out of scope
Removing ETag/304; removing leftover debug logs.
