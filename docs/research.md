# Research — Fix: second user stuck on room poll (stale cross-room session cookie)

Supersedes the previous cycle's research (user-profile-and-friends, shipped 2026-05-31 — see git history / `docs/superpowers/plans/`).

## 1. Requirements Summary

Production bug: the second user cannot load a room after joining. Vercel logs for `/api/rooms/OVAL-32/poll`:

```
[poll] room lookup { roomCode: 'OVAL-32', found: true }
[poll] returning 404 { reason: 'room_not_found',
  memberId: '09cc19cf…', memberRoomId: 'c2788d0a…', foundRoomId: '13e466fa…' }
```

The room exists, but the cookie's member belongs to a **different** room. Required outcomes:
1. Confirm join always (over)writes the session cookie.
2. Confirm poll validates the cookie member belongs to the requested room.
3. On `memberRoomId !== foundRoomId`, return a clear 403 / clear the stale cookie instead of a misleading 404 `room_not_found`.
4. Joining a new room from the same browser must not leave a stale member cookie from an old room.
5. Add join-route logging: requested roomCode, foundRoomId, created/found memberId, member.roomId, cookie set.
6. Regression test: join Room A → join Room B → poll Room B succeeds.

Chosen fix (user-selected): **per-room cookie scope** — cookie name `w2w_session_<CODE>`; readers resolve the token for the requested room code.

## 2. Stack Choices

No new dependencies. Next.js 15 App Router route handlers; `next/headers` `cookies()` for reads; `NextResponse.cookies.set` for writes; Jest (jsdom default, `@jest-environment node` override for route-handler tests). Cookie value stays a random 32-byte hex token mapped 1:1 to `Member.sessionToken` (unique). No Prisma schema change required.

## 3. Environment Verification

- **Writers of `w2w_session`:** `app/api/rooms/route.ts:48` (create), `app/api/rooms/[code]/members/route.ts:64` (join). Both already overwrite the cookie — requirement (1) holds today.
- **Readers of `getSessionToken()` (all no-arg today):** `poll`, `route.ts` GET+PATCH, `votes`, `watched`, `queue`, `start` (all under `[code]`, all destructure `const { code } = await params` *before* the cookie read — safe to pass `code`), plus **`app/api/auth/link-member/route.ts:12`** (auth restricted area).
- **`link-member` callers** (`app/page.tsx:16`, `app/auth/signin/page.tsx:29`, `app/auth/signup/page.tsx:19`) all POST with **no body** → no room code available there.
- **Helper:** `lib/session.ts` exports `SESSION_COOKIE_NAME`, `generateSessionToken`, `getSessionToken`, `setSessionCookie` (the last two unused outside lib except getSessionToken). `SESSION_COOKIE_NAME` is asserted in `__tests__/lib/session.test.ts`.
- **Client flow:** only `setup`/`lobby` join; `lobby`/`vote` poll on an interval and silently swallow non-OK responses. A browser already a member of room A that lands on room B's lobby/vote (deep link, bookmark, back button, second tab) polls B with A's cookie → mismatch → 404.
- **Verify:** `scripts/verify.sh` runs typecheck → lint → jest, writes `.workflow_verified`.

## 4. Risks & Edge Cases

- **Root cause:** a single global `w2w_session` cookie (path `/`) identifies the browser as a member of exactly one room. Poll resolves the member by token alone, then 404s on room-id mismatch. Per-room cookie names eliminate the mismatch (each room has its own cookie) and enable simultaneous multi-room membership.
- **`link-member` (restricted/auth):** user approved editing it. Callers send no code, so link **all** `w2w_session_*` tokens to the signed-in user (`updateMany … userId: null`). Strictly better; no change to the 3 auth-page callers.
- **Backward compatibility:** after deploy, browsers holding the old global `w2w_session` cookie read as not-joined (new cookie name). Acceptable — rooms expire in 24h; users simply re-join from the lobby. Old cookie lingers harmlessly until expiry. No data migration. Rollback = revert commit.
- **Cookie name charset:** codes like `OVAL-32` → `w2w_session_OVAL-32`; hyphen/uppercase are valid cookie-name token chars. Code normalized to uppercase to match URL casing.
- **Secret logging:** requirement (5) asks to log the Set-Cookie value; log the cookie **name** + a short token prefix only, never the full session secret.
- **Test env:** route-handler tests need Node env + mocked `@/lib/prisma`, `next/headers`, `@/lib/tmdb`; cookie writes land on the returned `NextResponse` (read back via `res.cookies.get`), not on the `next/headers` jar.

## 5. Assumptions & Open Questions

- **Assumption:** poll's `room.id !== member.roomId` branch becomes effectively unreachable with per-room cookies but is kept as defense-in-depth (403 `wrong_room` + clear that room's cookie).
- **Assumption:** path stays `/` (matches the user's selected design exactly); path-scoping per room is a deferred optional hardening.
- **Assumption:** no Prisma/schema change — `Member.sessionToken` already unique per member.
- **Open question (non-blocking):** should `vote`/`lobby` redirect to `/setup` on a 401 (no cookie for this room) for better UX? Out of scope for the fix; noted.

## 6. Out of Scope

- Client UX changes to lobby/vote poll-error handling (beyond what the fix needs).
- Removing the now-effectively-dead poll mismatch branch (kept as a safety net).
- `MemberQueue` retirement (tracked separately in project memory).
- Any schema/migration/dependency changes.

## 7. Readiness Verdict: READY FOR PLANNING

Root cause confirmed against the live code and the production log; fix approach selected by the user (per-room cookie scope); restricted-area edit (`link-member`) explicitly approved, with a corrected mechanism (link-all) since callers pass no code. Manifest written to `.workflow_plan_files`. **READY FOR PLANNING.**
