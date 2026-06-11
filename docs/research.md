# Research — Fix: Profile/Settings breaks for a stale session (deleted/missing user)

## Requirements Summary

"Profile / Settings Info sometimes results in a bug or error." Root-caused via reproduction:
**the Settings flow assumes the session's user still exists in the DB.** When a valid JWT session
outlives its `User` row (account deleted, or — common in dev — a DB reset/reseed while logged in),
the Settings page renders blank info ("bug") and Save returns a 500 ("error"). Make it robust.

## Reproduction (evidence)

Logged in as a throwaway user, then deleted the `User` row mid-session (JWT stays valid):
- `GET /profile/settings` → **200 but blank** (`user?.email ?? ''` hides the missing user).
- `GET /api/user/preferences` → 404 (callers handle it).
- `PUT /api/user/preferences` (Save) → **500** — `prisma.user.update` throws **P2025** and the route
  has **no try/catch** (confirmed `PrismaClientKnownRequestError code: 'P2025'` in the server log).
- Direct DB checks: `update` with empty `data` does **not** throw; `update` on a missing id throws P2025.
- Happy path (existing user): settings page / GET / PUT all 200; empty name → 400 (silently swallowed by the UI).

## Stack Choices

- **`PUT`**: switch `prisma.user.update` → `prisma.user.updateMany` (returns `{count}`, never throws
  P2025); `count === 0` ⇒ stale session ⇒ `401`. No exception-as-control-flow.
- **Settings page**: `redirect('/auth/signin')` (next/navigation) when the user row is null — matches
  `ProfileGuard.requireUserId`'s existing redirect-on-no-session pattern.
- **`SettingsClient`**: add an `error` state; on save, `401` ⇒ `window.location.href='/auth/signin'`,
  other non-OK ⇒ show the server's error message. Reuses the existing styling.
- **Test**: new `__tests__/api/user-preferences.test.ts` (Prisma + auth mocked, repo convention).

## Environment Verification

- Reproduced on a fresh dev server (`:3100`) with seed users; `P2025` confirmed in logs.
- No schema change → no migration. (NOTE: the repro mutated `alice`'s name/services and deleted a
  throwaway user — restore via `npm run db:seed` (upsert) in cleanup.)

## Risks & Edge Cases

- `updateMany` with empty `data` + existing user → `count 1` ⇒ ok (no-op) — unchanged behavior;
  SettingsClient always sends a valid body anyway.
- The page redirect uses `redirect()` which throws `NEXT_REDIRECT` (handled by Next) and narrows
  `user` to non-null afterward.
- Defense-in-depth: same root cause (missing user) handled at page, API, and client layers.

## Assumptions & Open Questions

- Treat a stale session (account gone) as `401` ⇒ re-authenticate. No blocking questions.

## Out of Scope

- The save-before-load race in `SettingsClient` (services could be saved as `[]` if Save is clicked
  before the GET populates them) — real but separate; not the reported symptom. Noted for later.
- Broad resilience to transient DB errors across all routes.

## Readiness Verdict: READY FOR PLANNING
