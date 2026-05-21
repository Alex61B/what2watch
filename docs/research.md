# Research: Fix ClientFetchError on /api/auth/session in Production

## Requirements Summary

Fix `ClientFetchError: Failed to fetch` thrown by `SessionProvider` when fetching `/api/auth/session` on the Render deployment. The error occurs on every page load; the app is otherwise deployed correctly.

## Stack Choices

- Next.js 15.5.16 (App Router)
- next-auth 5.0.0-beta.31 (Auth.js v5)
- @auth/prisma-adapter 2.11.2
- Deployed on Render

## Environment Verification

All environment variables on Render are correctly set:
- `AUTH_SECRET` — confirmed present and matches `.env.local`
- `AUTH_URL=https://what2watch-tmwt.onrender.com` — correct production URL
- `DATABASE_URL` — internal Render Postgres URL
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — confirmed present
- `PORT=10000` — Next.js reads this automatically

Code is correct: route handler at `app/api/auth/[...nextauth]/route.ts` exports `{ GET, POST }`, `trustHost: true` is set, JWT session strategy is used, no middleware, `SessionProvider` is wired via a `'use client'` wrapper.

## Risks & Edge Cases

- The fix (lazy config pattern) is a supported NextAuth v5 pattern; no API surface changes.
- The `signIn`, `signOut`, `auth`, and `handlers` exports remain identical.
- No other callers of `auth.ts` need changes.

## Assumptions & Open Questions

- Assumes NextAuth v5 beta.31's lazy-config code path correctly awaits `headers()`. Verified by reading the internal source: the lazy path uses `await headers()` while the static path uses `Promise.resolve(headers())`.
- No open questions.

## Out of Scope

- Upgrading next-auth to a newer version (deferred; the lazy-config workaround fixes the bug without a dependency change).
- Google OAuth callback URL configuration in Google Cloud Console.
- Database migrations.

## Readiness Verdict: READY FOR PLANNING

Root cause identified. Fix is a two-character change to `auth.ts` (wrap static config object in an arrow function).
