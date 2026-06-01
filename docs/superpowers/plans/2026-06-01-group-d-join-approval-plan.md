# Group D — Join-with-Approval Implementation Plan

Design: `docs/superpowers/specs/2026-06-01-group-d-join-approval-design.md`
Research: `docs/research.md`

## 1. Schema
- `Member.approved Boolean @default(true)`. Migration `add_member_approved`; append generated `migration.sql` to `.workflow_plan_files` in the same `prisma migrate dev` Bash command.

## 2. lib/match.ts
- Add `AND m."approved" = true` to the `active_count` subquery.

## 3. API
- `members/route.ts`: set `approved: room.status !== 'VOTING'` on member create.
- `poll/route.ts`:
  - filter `memberCount` + `members` to `approved: true, leftAt: null`.
  - add `pendingApproval`, `notAdmitted` (from current member's approved/leftAt).
  - add `pendingMembers` (`approved: false, leftAt: null` → id/displayName).
- `approvals/route.ts` (new): `POST` `{ memberId, action }`, host-only, target must be pending in same room; accept → `approved: true`; reject → `leftAt: new Date()`.
- `votes/route.ts`: guard `if (member.leftAt || !member.approved)` → 403.

## 4. UI — `vote/page.tsx`
- Extend `PollResponse` (`pendingApproval`, `notAdmitted`, `pendingMembers`).
- Branch: notAdmitted screen → pendingApproval waiting screen → normal voting.
- Host banner listing pending requests with Accept/Reject (calls approvals route, then `pollOnce`), disabled while in flight.

## 5. Tests — `__tests__/api/join-approval.test.ts` (node env)
- VOTING join → unapproved; LOBBY join → approved.
- poll: pending member excluded from roster/count, `pendingApproval` true; host sees `pendingMembers`.
- approvals: accept approves; reject sets leftAt → poll `notAdmitted`; non-host rejected.
- votes: 403 for unapproved member.

## 6. Acceptance criteria
- A person can join during VOTING and waits; the host accepts and they vote on the current movie; reject shows "not admitted".
- Pending members never count toward a match or the roster.
- `npm run typecheck && npm run lint && npm test` pass (after migration regenerates the client).

## 7. Migration command (IMPLEMENT, last step)
```
npx prisma migrate dev --name add_member_approved \
  && git ls-files --others --exclude-standard prisma/migrations | grep '_add_member_approved/migration.sql' >> .workflow_plan_files
```
