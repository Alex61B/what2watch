# Research — Group D: Join mid-session with host approval

Fourth and final refinement cycle. People can join a room after voting has started;
each late joiner waits for the host to accept them, then drops into the current movie.
Design spec: `docs/superpowers/specs/2026-06-01-group-d-join-approval-design.md`.

## 1. Requirements Summary

- A person can join a room that's already in VOTING. They land on a "waiting for the host" screen.
- The host sees pending join requests during voting and taps Accept or Reject for each.
- On Accept, the joiner immediately votes on the current shared-queue movie (no catch-up). On Reject, they see a "not admitted" screen.
- Lobby (pre-start) joins stay free, exactly as today. Approval applies only to VOTING-state joins.
- Pending joiners are hidden from the "N watching" roster until approved. Pending requests wait indefinitely (no timeout).

## 2. Stack Choices

- Add `Member.approved Boolean @default(true)`. Existing members and lobby joiners are approved; VOTING joiners start `false` (pending). Migration `add_member_approved` (additive, safe).
- Reuse the shared veto queue: an approved member just votes on `room.currentPosition` — no per-member catch-up needed ([project-shared-veto-queue-migration]).
- New host-only endpoint `POST /api/rooms/[code]/approvals` ({ memberId, action }). Reuse the existing host-gating pattern (session member `isHost`).
- Surface pending state through the existing poll the vote page already runs.

## 3. Environment Verification

- **`lib/match.ts`** computes `active_count` as `COUNT(Member WHERE roomId AND leftAt IS NULL)`. **This must add `AND approved = true`**, or a pending member inflates the denominator and unanimous-yes can never be reached → matches stall. This is the central correctness change.
- **`members` route** already allows joining in LOBBY or VOTING and sets the per-room session cookie; it just needs to set `approved = (room.status !== 'VOTING')`.
- **`poll` route** returns the current member (looked up by sessionToken — includes `approved`/`leftAt`), `memberCount`, and `members`. It will: filter roster/count to `approved && leftAt IS NULL`; add `pendingApproval`/`notAdmitted` for the current member; add `pendingMembers` (approved=false, leftAt null) for the host.
- **`votes` route** looks up the member by sessionToken; add a guard rejecting unapproved/left members (defensive — the UI already hides voting from them).
- **`vote` page** already polls every 1.5s and branches on state; add pending/not-admitted screens and a host approve/reject banner.
- Reject = set `leftAt`; a member with `leftAt != null && approved == false` is "not admitted" (no voluntary-leave flow exists to confuse this).

## 4. Risks & Edge Cases

- **Match stall (primary):** mitigated by the `approved = true` filter in `checkForMatch` and the poll roster/count.
- **Pending member voting:** blocked by the votes-route guard and the pending UI.
- **Accept mid-position:** the approved member votes on the current movie; `active_count` rises by one, so an in-progress "all yes but waiting" resolves once they vote yes (or advances on their no). Natural with the shared queue; no special move logic.
- **Reject detection:** poll returns `notAdmitted` when the current member is `leftAt != null && approved == false`.
- **Authorization:** approvals route must verify the caller is the room's host and the target is a pending member of the same room.
- **Migration drift:** run `prisma migrate dev` and append the generated `migration.sql` to `.workflow_plan_files` in the same Bash command (as in Group B) to avoid `.workflow_drift`.

## 5. Assumptions & Open Questions

- Assume one host; only the host approves (matches existing host-gated routes).
- Assume pending members never count anywhere active members are counted (match, roster, memberCount).
- Confirmed with user: reject → "not admitted" screen; pending hidden from roster; wait indefinitely.
- No open questions blocking planning.

## 6. Out of Scope

- Per-member catch-up queues / MemberQueue changes (shared queue handles it; MemberQueue retirement remains separate).
- Approval timeouts, multiple hosts/co-hosts, re-request after reject, LOBBY-join approval.
- Changing the start route's member threshold (LOBBY-only, all approved there).

## 7. Readiness Verdict: READY FOR PLANNING

One additive nullable-default column, one corrected SQL count, one new host endpoint, and pending/host UI on the existing vote poll. The critical match-counting fix is identified. **READY FOR PLANNING.**
