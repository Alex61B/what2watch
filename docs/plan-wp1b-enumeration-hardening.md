# Plan — WP1b: Enumeration / UX Hardening

Implements the design in `docs/research.md` (WP1b). Closes audit **M1** (room-roster GET
over-exposure) and **M2** (user-search enumeration + email exposure). **Migration-free,
dependency-free, no `auth.ts` change.** Stacked on the WP1a tip (`feat/wp1b-enumeration-hardening`).

## Tunable constants (confirm at approval)
- `roomGet`: **60 / min / IP**, fail-open.
- `userSearch`: **30 / min / user**, fail-open.
- `searchUsers` minimum query length: **2**.

---

## M1 — Restrict & rate-limit the room-roster GET

### 1. `lib/rate-limit-db.ts`
- Add two scopes to `RATE_LIMITS`:
  - `roomGet: { limit: 60, windowMs: 60_000 }` — IP-keyed, fail-open (no `failClosed`).
  - `userSearch: { limit: 30, windowMs: 60_000 }` — per-user, fail-open.
- Comment each (keying + intent), consistent with existing scope comments.

### 2. `app/api/rooms/[code]/route.ts` (GET only; PATCH untouched)
- Rename the unused `_request` param to `request` so it can be passed to `getClientIp`.
- **First line of GET:** IP rate-limit (before `findUnique`, so probing non-existent codes is also
  throttled):
  ```ts
  const rl = await checkRateLimit('room-get', getClientIp(request), RATE_LIMITS.roomGet)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSeconds)
  ```
- Keep the existing `prisma.room.findUnique({ where: { code }, include: { members: {…} } })` query
  shape **unchanged** (preserves the `room-name.test.ts` mock, which lacks `member.findMany`).
- After resolving `currentMember` (existing `getSessionToken` + `member.findFirst` logic), **branch**:
  - **Non-member** (`!currentMember`): return the minimal payload only —
    `{ code, name, status, expired: roomExpired(room), currentMemberId: null, isCurrentUserHost: false }`.
    Do **not** run the TMDB `matchedMovie` fetch on this path.
  - **Member**: return the existing full payload unchanged (`members`, `matchedMovie`,
    `streamingServices`, `filters`, `watchedFilter`, `currentMemberId`, `isCurrentUserHost`).
- Import `checkRateLimit, getClientIp, RATE_LIMITS, tooManyRequests` from `@/lib/rate-limit-db`.

### 3. `app/room/[code]/lobby/page.tsx` (consumer hardening — the only consumer that needs it)
- Make `members` and `streamingServices` **optional** in the `RoomState` interface
  (`members?: RoomMember[]`, `streamingServices?: string[]`).
- Guard the unconditional accesses for the pre-join (non-member) load:
  - line ~81: `setMemberCount(data.members?.length ?? 0)`
  - line ~216: `const count = memberCount ?? room.members?.length ?? 0`
  - line ~218: `const hasServices = (room.streamingServices?.length ?? 0) > 0`
  - line ~285 (joined branch, members present after re-fetch): `members={room.members ?? []}`
- No behavior change for members: post-join re-fetch (line ~152) returns the full payload, so the
  member list and start-gating still work. `done`/`setup`/`HostFilterEditor` need **no** change
  (already null-safe / host-gated — see research §4).

---

## M2 — Harden user search

### 4. `lib/friends.ts` (`searchUsers` + types)
- Add a narrow result type: `export interface UserSearchResult { id: string; displayName: string }`
  (keep `PublicUser` with `email` for `listFriends`).
- Rewrite `searchUsers(query, excludeUserId): Promise<UserSearchResult[]>`:
  ```ts
  const q = query.trim()
  if (q.length < 2) return []
  return prisma.user.findMany({
    where: {
      id: { not: excludeUserId },
      OR: [
        { email: { equals: q, mode: 'insensitive' } },        // exact email (was: contains)
        { displayName: { contains: q, mode: 'insensitive' } }, // substring on name
      ],
    },
    select: { id: true, displayName: true },                    // email dropped
    take: 10,
  })
  ```

### 5. `app/api/users/search/route.ts`
- After the existing `auth()` 401 guard, add a per-user rate-limit:
  ```ts
  const rl = await checkRateLimit('user-search', session.user.id, RATE_LIMITS.userSearch)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSeconds)
  ```
- Import `checkRateLimit, RATE_LIMITS, tooManyRequests` from `@/lib/rate-limit-db`.

### 6. `components/FriendsClient.tsx`
- Add a local `interface SearchResult { id: string; displayName: string }`; type `results` as
  `SearchResult[]` (keep `PublicUser` for friends/incoming/outgoing).
- Remove the email span in the search result row (line ~84): render `{u.displayName}` only.
- Keep the input placeholder honest: "Search by name or exact email".

---

## Test plan

### 7. `__tests__/lib/friends.test.ts` (update the existing `searchUsers` test)
- Assert `searchUsers('   ', 'a')` → `[]` and **`searchUsers('b', 'a')` → `[]`** (min-2) with
  `prisma.user.findMany` **not** called.
- Assert the new `where` (`email: { equals: 'bob', mode: 'insensitive' }`, `displayName: { contains }`)
  and `select: { id: true, displayName: true }` (no `email`), and that the returned rows carry no
  `email`.

### 8. `__tests__/api/room-get-visibility.test.ts` (new — node env; mirror `room-name.test.ts` mocks)
- **Non-member** GET (empty cookie jar) → 200 with `{ code, name, status }` present and `members`,
  `matchedMovie` **absent/undefined**; `currentMemberId === null`, `isCurrentUserHost === false`.
- **Member** GET (cookie set after join) → 200 with `members` present (full payload).
- **Rate-limited** GET → mock `checkRateLimit` → `{ ok: false, retryAfterSeconds }` → status 429 +
  `Retry-After` header.

### 9. `__tests__/api/user-search.test.ts` (new — node env)
- Unauthenticated (`auth()` → null) → 401.
- Authenticated, limiter denies → 429 + `Retry-After`.
- Authenticated, limiter ok → 200, response `users` contain `id`/`displayName` and **no `email`**.

### 10. `__tests__/lib/rate-limit-db.test.ts` (extend)
- Assert `RATE_LIMITS.roomGet` and `RATE_LIMITS.userSearch` exist with the expected `limit`/`windowMs`
  and are **not** fail-closed (mirrors the existing signup/login fail-closed assertion).

---

## Verification
`bash scripts/verify.sh` → typecheck + lint + jest must be green. Expected new tests: ~9–11 added
(M2 searchUsers update, room-get visibility ×3, user-search route ×3, limiter scopes ×1).
Baseline before this cycle: 296 tests / 47 suites.

## Out of scope (per research §6)
Room-code format unchanged; `listFriends`/`GET /api/friends` email retained (unrendered residual);
no schema/dependency change; WP2–WP8 untouched.
