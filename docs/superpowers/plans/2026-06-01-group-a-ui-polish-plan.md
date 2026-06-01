# Group A — UI Polish Implementation Plan

Design: `docs/superpowers/specs/2026-06-01-group-a-ui-polish-design.md`
Research: `docs/research.md`

## 1. Schema changes
**None.** No Prisma model changes, no migration, no new dependency.

## 2. API changes
- **GET `/api/rooms/[code]/poll`** (`app/api/rooms/[code]/poll/route.ts`): add a `members` field to the 200 JSON response:
  `members: { id: string; displayName: string; isHost: boolean }[]`,
  from `prisma.member.findMany({ where: { roomId: room.id, leftAt: null }, select: { id: true, displayName: true, isHost: true }, orderBy: { joinedAt: 'asc' } })`.
  Added after the heartbeat/304 check (304 path unchanged). ETag semantics unchanged.

## 3. Component / page changes
- **`components/ProfileHeader.tsx`** (new): presentational. Props `{ title: string }`. Renders the title + a `<Link href="/">🏠 Home</Link>` in a top row. Server-safe.
- **Profile pages** — render `<ProfileHeader title=... />` at top: `app/profile/page.tsx`, `app/profile/settings/page.tsx`, `app/profile/friends/page.tsx`, `app/profile/watchlist/page.tsx`, `app/profile/seen/page.tsx`, `app/profile/friends/[friendId]/page.tsx`, `app/profile/friends/[friendId]/sessions/[roomId]/page.tsx`.
- **`app/room/[code]/setup/page.tsx`**: render a Members section (reuse `MemberList`) showing live count; add a 3s poll of `/poll` updating count + list from `memberCount`/`members`. Clear interval on unmount.
- **`app/room/[code]/vote/page.tsx`**: extend `PollResponse` with `members`; render a collapsible **"N watching"** chip (button toggles expanded name list) at top of the vote view; remove page-level `swipeDir`/`animateAndAdvance` (card owns visuals); keep submit-lock + `pollOnce` + `key={queueVersion}`.
- **`components/VotingCard.tsx`**: self-contained pointer-event gesture — live `translateX`+`rotate` drag, LIKE/NOPE overlays whose opacity ramps with drag, spring-back below threshold, fly-off + commit past threshold. YES/NO buttons call `onVote` synchronously. `disabled` blocks buttons and drag. Reset/release pointer on up/cancel.

## 4. Test changes
- **`__tests__/components/ProfileHeader.test.tsx`** (new): renders title; Home link points to `/`.
- **`__tests__/components/VotingCard.test.tsx`** (edit): keep all existing assertions green (buttons, title/year/rating, runtime, "No Image", disabled). Optionally assert LIKE/NOPE overlay elements exist.
- **`__tests__/api/poll-members.test.ts`** (new, node env): mock Prisma (mirror `rooms-session.test.ts`, add `member.findMany`); assert poll 200 response includes `members` with id/displayName/isHost and excludes `leftAt != null` rows.

## 5. Acceptance criteria
- **A1:** Each profile page shows a Home control linking to `/`.
- **A2:** Setup page shows current member count/list and updates within a few seconds when someone joins.
- **A3:** Vote page shows a "N watching" chip that expands to the member list and reflects live membership; poll response includes `members`.
- **A4:** During voting, dragging the card moves/rotates it with a LIKE/NOPE overlay; releasing past threshold registers the vote and flies the card off; releasing below threshold springs it back; YES/NO buttons still vote.
- **Verify:** `npm run typecheck` && `npm run lint` && `npm test` all pass (`scripts/verify.sh`).
