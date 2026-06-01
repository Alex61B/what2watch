# Group A — UI Polish Design

**Date:** 2026-06-01
**Cycle:** First of four (A = quick UI wins; B = room naming; C = watch-providers; D = join-with-approval — B/C/D are separate later cycles).
**Status:** Approved for planning.

## Context

`What2Watch` is a Next.js 15 / Prisma / Postgres app for collaborative movie picking. This cycle bundles four low-risk UI refinements that need **no schema change and no new dependency** (project rules forbid adding packages without explicit approval). The swipe gesture is hand-rolled with pointer events.

## Goals (the four items)

1. **A1 — Home button on profile screens** (#5): an easy way out of the profile area back to `/`.
2. **A2 — Member count/list on the setup page** (#2): the host can see who has joined before starting; updates live.
3. **A3 — Participant roster during voting** (#3): everyone can see who is in the room while voting; updates live.
4. **A4 — Tinder-style swipe** (#1): the voting card follows the finger/mouse, rotates, shows LIKE/NOPE overlays, snaps back below threshold and flies off past it.

## Design

### A1 · ProfileHeader component
- New `components/ProfileHeader.tsx`: renders the page title and a **🏠 Home** link to `/`.
- Dropped into the profile hub and each subpage: `app/profile/page.tsx`, `app/profile/settings/page.tsx`, `app/profile/friends/page.tsx`, `app/profile/watchlist/page.tsx`, `app/profile/seen/page.tsx`, `app/profile/friends/[friendId]/page.tsx`, `app/profile/friends/[friendId]/sessions/[roomId]/page.tsx`.
- Pure presentational component — props: `title: string`. No data dependency. Server-component safe (just a `<Link>`).

### A2 · Setup page member count (live)
- `app/room/[code]/setup/page.tsx` already fetches `members` on load but never renders them.
- Add a **Members · N** section reusing the existing `components/MemberList.tsx` (host is the current member).
- Add a lightweight 3s poll of `/api/rooms/${code}/poll`, updating the rendered count/list from `memberCount` + the new `members` array (see A3). `memberCount` already exists in the poll payload; the list comes from the A3 server change.
- Polling stops on unmount (cleared interval), consistent with lobby/vote pages.

### A3 · Voting roster (live) + poll server change
- **Server** (`app/api/rooms/[code]/poll/route.ts`): add a `members: { id, displayName, isHost }[]` array to the JSON response, queried with `prisma.member.findMany({ where: { roomId, leftAt: null }, select: { id, displayName, isHost }, orderBy: { joinedAt: 'asc' } })`. One extra query; does not affect the ETag/304 path semantics (304 still short-circuits before this).
- **Client** (`app/room/[code]/vote/page.tsx`): extend `PollResponse` with `members`. Render a collapsible **"N watching"** chip at the top of the vote view (a `<button>` toggling an expanded name list). Compact by default so it never crowds the card. Driven by the existing poll loop.

### A4 · VotingCard gesture rewrite
- `components/VotingCard.tsx` becomes a self-contained gesture component (touch + mouse via Pointer Events).
- **State:** `dragX` (current horizontal offset), `dragging`, `exiting: 'left' | 'right' | null`.
- **Handlers:** `onPointerDown` captures the pointer (`setPointerCapture`) and records start X; `onPointerMove` updates `dragX = clientX - startX`; `onPointerUp` decides: `|dragX| > threshold` (≈ ⅓ of card width, fallback constant for jsdom) → set `exiting` and call `onVote(dragX > 0)`; else reset `dragX = 0` (CSS transition springs it back).
- **Transform:** `translateX(dragX) rotate(dragX * 0.05deg)` while dragging; when `exiting`, translate ±120% with the existing easing.
- **Overlays:** absolutely-positioned **LIKE** (green) and **NOPE** (red) stamps; opacity = `clamp(dragX / threshold, 0, 1)` for LIKE, the negative for NOPE.
- **Buttons:** YES/NO remain and call `onVote(true|false)` **synchronously** (sets `exiting` for the visual but does not defer the callback) — preserves existing synchronous-onVote tests. `disabled` still blocks buttons and drag.
- **Page simplification** (`vote/page.tsx`): remove the page-level `swipeDir` wrapper transform and `animateAndAdvance`; the card owns its visuals. Keep the submit-lock (`submitting`/`submittingRef`), the vote POST, `pollOnce`, and `key={queueVersion}` remount (resets the next card to center). `handleMarkWatched` keeps its current behavior (submit + poll; no fly-off required).

## Data Flow
No schema change. Poll response gains a `members` array used by both setup (A2) and vote (A3). Everything else is presentational/gesture state.

## Testing
- **Keep green:** `__tests__/components/VotingCard.test.tsx` — buttons, title/year/rating, runtime text, "No Image", `disabled`. The synchronous `onVote` contract is preserved.
- **Add:** a poll-route test asserting the response includes `members` (id/displayName/isHost, excludes `leftAt != null`); a `ProfileHeader` render test (title + Home link to `/`); a vote-page/roster test for the "N watching" chip if feasible in jsdom (gesture geometry is not reliably testable in jsdom, so drag is verified manually).
- **Verify:** `npm run typecheck` → `npm run lint` → `npm test` (project `verify.sh`).

## Out of Scope (later cycles)
- **B** room naming (`Room.name`, set at creation, shown at end of session).
- **C** real TMDB `watch/providers` ("watch now on X, Y, Z").
- **D** join-mid-session with host approval (pending member state + approval UI).
- Any schema/migration/dependency change in this cycle.
