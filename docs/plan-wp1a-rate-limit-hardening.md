# Plan — WP1a: Abuse & Rate-Limit Hardening (limiter core)

> Derived from `docs/research.md` (WP1). Scope = **WP1a** only (per OQ5 SPLIT): H1, H2, H3, member
> cap, vote guard+throttle, friend-request throttle + DECLINED cooldown. **WP1b** (room-code/roster
> restriction, user-search enumeration) is a separate follow-up cycle. Migration-free, no new deps.

## Design summary

All abuse controls route through the existing durable limiter `lib/rate-limit-db.ts` (Postgres
`RateLimit`, atomic `INSERT … ON CONFLICT … RETURNING count`). We add new scopes, a per-scope
`failClosed` flag, and one new domain constant. No schema change, no new dependency, no `auth.ts` edit.

### Schema changes
**None.** `RateLimit` table already exists; `Friendship.updatedAt` and `Member.leftAt` already exist.

## Changes by file

### 1. `lib/rate-limit-db.ts` — new scopes + fail-closed option
- Extend `RateLimitOptions` with `failClosed?: boolean`.
- Add scopes to `RATE_LIMITS` (all `as const`):
  - `signup`: add `failClosed: true` (keep `limit 5 / 15min`).
  - `login`: `{ limit: 10, windowMs: 15*60_000, failClosed: true }`.
  - `vote`: `{ limit: 120, windowMs: 60_000 }` (≈2/sec sustained — generous for swipe-voting).
  - `friendRequest`: `{ limit: 20, windowMs: 60*60_000 }` (20/hour/user).
- In `checkRateLimit` `catch`: if `opts.failClosed` → return `{ ok: false, retryAfterSeconds: ceil(windowMs/1000) }`; else keep current fail-OPEN. (`getClientIp` unchanged — XFF is Vercel-trusted per research §3.)

### 2. `app/api/auth/[...nextauth]/route.ts` — H1 login throttle *(restricted area, user-approved OQ3)*
- Keep `GET = handlers.GET`. Wrap `POST`: if `request.url` contains `/callback/credentials`, call
  `checkRateLimit('login', getClientIp(request), RATE_LIMITS.login)` **before** delegating; on `!ok`
  return `429` + `Retry-After` (throttles before bcrypt). All other NextAuth POSTs delegate untouched.
  **No request-body read** (NextAuth owns the stream); IP-only key. **No `auth.ts` change.**

### 3. `app/api/auth/signup/route.ts` — H2 fail-closed
- No code change needed beyond passing `RATE_LIMITS.signup` (now carries `failClosed: true`). Confirm
  the existing `checkRateLimit('signup', …)` call picks up the new flag. (Edit only if a tweak is needed.)

### 4. `app/api/events/route.ts` — H3 rotation-proof key + bounded ids
- Durable L2 cap keyed on **IP** (`ip:${ip||'unknown'}`) instead of client `anonId` (rotation no longer
  raises the cap). In-memory L1 fast-path unchanged.
- Bound `roomId`/`memberId`: accept only `typeof === 'string' && length <= 64`, else store `null`.

### 5. `lib/room.ts` — member-cap constant
- Export `MAX_ROOM_MEMBERS = 20`.

### 6. `app/api/rooms/[code]/members/route.ts` — M-join member cap
- Inside the existing `$transaction`, `tx.member.count({ where: { roomId, leftAt: null } })`; if
  `>= MAX_ROOM_MEMBERS` throw a sentinel; `.catch` it → return `409 { error: 'Room is full' }`.
  Atomic so concurrent joins can't both slip past the cap. (Existing `roomJoin` IP limit stays.)

### 7. `app/api/rooms/[code]/votes/route.ts` — M-vote type guard + throttle
- Replace the truthy check with `typeof tmdbMovieId === 'string'` (still require `typeof vote === 'boolean'`) → `400` on bad type.
- After member lookup, `checkRateLimit('vote', member.id, RATE_LIMITS.vote)` → `429` on limit (per-member key).

### 8. `lib/friends.ts` — M-friend DECLINED cooldown
- Add `'COOLDOWN'` to `FriendErrorCode`; add `DECLINED_COOLDOWN_MS = 24*60*60*1000`.
- `sendFriendRequest(requesterId, receiverId, now = Date.now())`: when existing is `DECLINED`, re-open
  to `PENDING` only if `now - updatedAt >= cooldown`; else `throw new FriendError('COOLDOWN')`.
  (`now` param added for deterministic tests.)

### 9. `app/api/friends/requests/route.ts` — M-friend request throttle
- Add `checkRateLimit('friend-request', session.user.id, RATE_LIMITS.friendRequest)` after auth → `429` on limit.
- Map `COOLDOWN` → `429` in the `STATUS` table.

### Component changes
**None** in WP1a. (FriendsClient/user-search UI change is WP1b.)

## Acceptance criteria (one testable per fix)

1. **H1** — `>10` POSTs to `…/callback/credentials` from one IP in 15 min → `429` + `Retry-After`; a POST to a non-credentials NextAuth path is **not** throttled. *(new `__tests__/api/auth-login-throttle.test.ts`)*
2. **H2** — with the limiter DB query stubbed to throw: `signup`/`login` scopes return `ok:false` (fail-closed); `events` scope returns `ok:true` (fail-open). *(`__tests__/lib/rate-limit-db.test.ts`, `__tests__/api/signup.test.ts`)*
3. **H3** — durable cap is keyed on IP: two requests with **different** `anonId` from the **same** IP share one window; a `roomId`/`memberId` of length `>64` is persisted as `null`. *(`__tests__/api/events.test.ts`)*
4. **M-join** — the 21st concurrent active join returns `409 "Room is full"`; a member who `leftAt` frees a slot. *(new `__tests__/api/member-cap.test.ts`)*
5. **M-vote** — `tmdbMovieId: 123` (number) → `400`; the 121st vote/min by one member → `429`. *(`__tests__/api/votes.test.ts`)*
6. **M-friend** — the 21st request/hour by one user → `429`; re-sending to someone who DECLINED `<24h` ago → `COOLDOWN`/`429`; `>=24h` ago → re-opens to `PENDING`. *(`__tests__/lib/friends.test.ts`)*

## Verification
`bash scripts/verify.sh` (typecheck → lint → jest). Baseline 284/284 must stay green plus the new cases.

## Out of scope (WP1b / later)
Room-code entropy & roster-GET restriction; user-search exact-email + email-drop; `@vercel/functions`;
limiter→Redis; recommender-integrity redesign.
