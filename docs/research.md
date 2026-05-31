# Research — User Profile & Friend Page

Companion to the implementation plan at `docs/superpowers/plans/2026-05-31-user-profile-and-friends.md`.

## 1. Requirements Summary

Two coupled features for signed-in users:

- **User Profile** — a hub (`/profile`) linking to Settings, Friends, Watch List, and Seen-Before pages. The Watch List auto-fills when a user votes "Yes" in a room; the Seen-Before list fills on "Already seen it". Both lists are viewable and items removable. Friends: search users, send/accept/decline requests, see accepted friends and pending requests separately.
- **Friend Page** — for an accepted friend, show the **shared watch list** (intersection of both users' watch lists), **previous sessions together** (rooms both participated in), and per-session **shared "Yes"** movies (movies both voted Yes on in that room).

Access control: only signed-in users reach profile/friend features; non-friends cannot view a friend page; anonymous room participants must not expose data.

## 2. Stack Choices

Leverage existing patterns only — no new dependencies.

- **Auth:** NextAuth 5 JWT sessions. Server side: `await auth()` → `session.user.id`. Client side: `useSession()` (provider already in `app/layout.tsx`).
- **DB:** Prisma 6 + `@prisma/adapter-pg`. Add three models (`Friendship`, `UserMoviePreference`, `MovieCache`) + two enums.
- **Logic-in-lib pattern:** Existing code puts testable logic in `lib/` (e.g. `lib/queue.ts`, `lib/match.ts`) with mocked-`@/lib/prisma` Jest tests; route handlers stay thin. New logic follows suit (`lib/preferences.ts`, `lib/friends.ts`, `lib/movie-cache.ts`, `lib/link.ts`).
- **TMDB metadata:** reuse `getMovieById` from `lib/tmdb.ts`, backed by a new persistent `MovieCache` for list rendering and fallback.
- **UI:** Tailwind dark theme matching `app/page.tsx`; reuse `StreamingServicePicker`.
- **Testing:** Jest + ts-jest for lib; `@testing-library/react` for one client component, matching `__tests__/` conventions.

## 3. Environment Verification

- `prisma/schema.prisma` confirmed: `User` has `id/email/displayName/savedServices/savedFilters/passwordHash`; `Member` has nullable `userId`, `roomId`, `joinedAt`, unique `sessionToken`; `Vote { roomId, memberId, tmdbMovieId, vote, votedAt }`; `WatchedMovie { memberId, tmdbMovieId }`; `Room { code, status, createdAt }`.
- Auth wiring confirmed in `auth.ts` (Google + Credentials, JWT, `session.user.id` threaded) and `types/next-auth.d.ts`.
- Two session systems confirmed: room cookie `w2w_session` (`lib/session.ts` / `getSessionToken`) vs NextAuth identity (`auth()`). `/api/auth/link-member` links them best-effort from the landing page only.
- Existing vote/watched routes (`app/api/rooms/[code]/votes|watched/route.ts`) confirmed as the hook points.
- Migration tooling: `prisma migrate dev` requires `DIRECT_URL` in `.env.local` (per project memory) and **explicit user approval** (restricted action).
- `scripts/verify.sh` runs typecheck → lint → jest and writes `.workflow_verified`.

## 4. Risks & Edge Cases

- **Identity bridge gap:** a signed-in user who joins via `/api/rooms/[code]/members` gets `Member.userId = null`. Mitigation: `lib/link.ts#resolveMemberUserId` links at vote time via `auth()`; anonymous members return null → no preference written.
- **Migration drift:** generated migration SQL under `prisma/migrations/` is unplannable by exact path and trips `.workflow_drift`; user runs `advance_state.sh drift-to-plan` in terminal (known issue per project memory).
- **TMDB unavailability:** movie may be deleted/unreachable → `MovieCache` fallback metadata (`Title unavailable`).
- **Duplicate prevention:** `@@unique` on `Friendship(requesterId,receiverId)` and `UserMoviePreference(userId,tmdbMovieId,type)`; upserts + `FriendError` codes (DUPLICATE/ALREADY_FRIENDS/SELF).
- **Non-fatal hooks:** watch-list/seen-before writes wrapped in try/catch so they never break voting.
- **Access control:** `areFriends` 403 in friend routes; `requireUserId` redirect in pages; unfriend deletes the row → access removed.
- **Yes/No mismatch:** shared-Yes intersects `vote: true` for both users only.
- **N+1:** `getSessionsTogether` runs one shared-Yes count per room — acceptable at MVP volume.

## 5. Assumptions & Open Questions

- **Assumption:** session/vote history needs **no new tables** — existing `Member.userId` + `Vote` + `Room` cover it. (Spec listed redundant tables; dropped per YAGNI.)
- **Assumption:** "shared watch list" = intersection of `UserMoviePreference` WATCHLIST rows (equivalent to "movies both said Yes to" since Yes votes populate the watchlist).
- **Assumption:** streaming-provider metadata in `MovieCache` is deferred ("if available").
- **Open question (non-blocking):** should declined friend requests be re-sendable? Plan assumes yes (re-opens the row). Revisit if undesired.
- **Open dependency:** migration requires user approval + `DIRECT_URL` configured.

## 6. Out of Scope

- New vote-history / session-member tables (already covered by existing schema).
- Streaming-provider caching in `MovieCache`.
- `MemberQueue` retirement (tracked separately in project memory).
- Real-time updates on profile/friend pages (fetch-on-load is sufficient).
- Notifications for incoming friend requests.

## 7. Readiness Verdict: READY FOR PLANNING

Architecture validated against the live codebase; risks identified with mitigations; the only external dependency is user approval of the Prisma migration. The implementation plan decomposes this into 18 TDD tasks. **READY FOR PLANNING.**
