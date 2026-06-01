# Group D — Join Mid-Session with Host Approval Design

**Date:** 2026-06-01
**Cycle:** Fourth/final (A, B, C shipped).
**Status:** Approved for planning.

## Goal
Let people join a room that's already voting. Each late joiner waits for the host to accept them; on accept they vote on the current movie, on reject they see a "not admitted" screen.

## Decisions (confirmed)
- Approval applies only to **VOTING-state** joins; LOBBY joins stay free.
- Reject → **"not admitted"** screen (sets `leftAt`).
- Pending joiners **hidden** from the "N watching" roster until approved.
- Pending requests **wait indefinitely** (no timeout).

## Schema (migration `add_member_approved`)
Add to `Member`:
```prisma
approved Boolean @default(true)
```
Existing rows → true. Drift avoided by appending the generated `migration.sql` to `.workflow_plan_files` in the same Bash command that runs `prisma migrate dev`.

## lib/match.ts
`active_count` subquery: add `AND m."approved" = true` so pending members don't block unanimous-yes.

## API
- **`members` route (join):** `approved: room.status !== 'VOTING'` (LOBBY→true, VOTING→false/pending). Everything else unchanged (cookie, optional legacy memberQueue).
- **`poll` route:**
  - `memberCount` and `members` roster filtered to `approved = true, leftAt = null`.
  - `pendingApproval = !member.approved && !member.leftAt` (current member).
  - `notAdmitted = !member.approved && !!member.leftAt` (current member).
  - `pendingMembers = members where approved=false, leftAt=null` → `{ id, displayName }[]` (host uses it).
- **`approvals` route (new): `POST /api/rooms/[code]/approvals`** — body `{ memberId, action: 'accept' | 'reject' }`. Host-only (session member `isHost`). Target must be a pending member of the same room. accept → `approved=true`; reject → `leftAt=now`. Returns `{ ok: true }`.
- **`votes` route:** guard — if `member.leftAt || !member.approved` → 403 "Not approved".

## UI — vote page
- `PollResponse` gains `pendingApproval`, `notAdmitted`, `pendingMembers`.
- Render order: `notAdmitted` → "The host didn't admit you to this room" screen; else `pendingApproval` → "Waiting for the host to approve you…" screen (keeps polling); else normal voting.
- Host (and `pendingMembers.length > 0`): a banner above the card listing each pending request with **Accept** / **Reject** buttons calling the approvals route, then `pollOnce()`. Disable buttons while a request is in flight.

## Tests (node env)
`__tests__/api/join-approval.test.ts`:
- Joining during VOTING creates an unapproved member; LOBBY join is approved.
- poll for a pending member returns `pendingApproval: true` and excludes them from `members`/`memberCount`; host poll returns them in `pendingMembers`.
- approvals accept → member approved (appears in roster, gone from pending); reject → `leftAt` set, poll returns `notAdmitted` for them.
- approvals route rejects non-host callers.
- votes route returns 403 for an unapproved member.

## Files
`prisma/schema.prisma` (+ generated migration), `lib/match.ts`, `app/api/rooms/[code]/members/route.ts`, `app/api/rooms/[code]/poll/route.ts`, `app/api/rooms/[code]/approvals/route.ts` (new), `app/api/rooms/[code]/votes/route.ts`, `app/room/[code]/vote/page.tsx`, `__tests__/api/join-approval.test.ts`.

## Out of Scope
Timeouts, co-hosts, re-request after reject, MemberQueue changes, LOBBY-join approval.
