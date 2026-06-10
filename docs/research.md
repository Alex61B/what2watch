# Research — Last-used name default, host approval popup, depth-band reshuffle

Three follow-up requests, all building on the previous cycle:

1. **Name default = last-used name, else full user name.** Prefill the join/create name with the most recent name the user joined a room under; if they've never joined one, use their complete account name. Still editable.
2. **Host approval popup.** When someone joins after the room has started, the joiner sees "Waiting for the host…". Give the **host** a prominent popup to approve or deny that person (today it's only a small inline box on the vote screen).
3. **Depth-band reshuffle (moderate shift, user-approved).** Level 3 (the default) is too niche. Raise every level's TMDB review-count floor so the default lands on recognizable films.

---

## 1. Requirements Summary

### R1 — Last-used name default
- "Last used name" = the most recent `Member.displayName` for this signed-in user (`Member.userId == session.user.id`, latest `joinedAt`).
- "Complete name of the user" = `User.displayName` (set from Google `name` / signup name — `auth.ts:13-19`, `signup/route.ts:33`).
- Resolution: `lastUsedName ?? user.displayName`. Applies to both name inputs prefilled last cycle: home (`app/page.tsx`) and lobby (`app/room/[code]/lobby/page.tsx`).

### R2 — Host approval popup
- A mid-session joiner is created `approved:false` (`members/route.ts:45`) and sees the "Waiting for the host…" screen (`vote/page.tsx:254`).
- The host currently sees a small **inline box** on the vote page (`vote/page.tsx:316-348`) listing pending members with Accept/Reject, calling `POST /api/rooms/[code]/approvals` via `handleApproval` (`vote/page.tsx:206-222`).
- Want: a **modal popup** that surfaces automatically when a request arrives, with Accept/Deny per person. Replace the inline box with the modal; never lose access to pending requests.

### R3 — Depth bands (moderate shift)
`DEPTH_BANDS` in `lib/tmdb.ts:60-66` maps the 1–5 dial to `vote_count` bands. User-approved new values:

| Level | Label | Now | New |
|---|---|---|---|
| 1 | Crowd-Pleaser | ≥500 | **≥3000** |
| 2 | Easy Watch | 150–499 | **1000–2999** |
| 3 | Sweet Spot (default) | 75–149 | **350–999** |
| 4 | Deep Cut | 35–74 | **120–349** |
| 5 | Certified Cinephile | 15–34 | **40–119** |

---

## 2. Stack Choices (existing patterns to leverage)

- **R1:** extend the existing `GET /api/user/preferences` (already runs `auth()` + reads the `User` row) to also query the latest `Member` for the user and return a resolved `defaultName`. The client effects added last cycle just read `defaultName` instead of `displayName`. `Member` already has `userId`, `displayName`, `joinedAt` (`prisma/schema.prisma`).
- **R2:** mirror the existing modal pattern in `components/HostFilterEditor.tsx` (`fixed inset-0 z-50 … bg-ink/40` overlay) in a new `components/JoinRequestModal.tsx`. Reuse the vote page's `handleApproval` + `approvingId`. Encapsulate auto-open / dismiss / re-open-on-new-request inside the component so the vote page change is minimal.
- **R3:** pure data change to `DEPTH_BANDS` (+ comment). `FilterControls` shows only labels/blurbs (`DEPTH_LEVELS`), no band numbers — no UI change. The dial default stays level 3.

---

## 3. Environment Verification

- No new env, no packages. No schema/migration changes (`Member.userId`/`joinedAt`, `User.displayName` already exist).
- `DEFAULT_MIN_VOTES` (100) — the no-depth fallback floor — is **unchanged**; the request is about the 5 dial levels only, and the dial always defaults to 3, so a band is normally in effect.

---

## 4. Risks & Edge Cases

- **R1 latest-member query:** must scope to `userId == session.user.id` and order by `joinedAt desc`. A user who never joined a room → no member → fall back to `user.displayName`. `displayName` is always non-empty (validated at create), so no empty-name prefill.
- **R1 contract:** add a new `defaultName` field rather than overloading `displayName`, so the meaning stays clear. Nothing else consumes `displayName` from this endpoint (setup page reads only `savedServices`/`savedFilters`).
- **R1 no-clobber:** keep last cycle's one-shot guard (only set when the field is still empty).
- **R2 losing access if dismissed:** a dismissible modal must not strand pending requests. Mitigation: while dismissed with requests outstanding, show a compact "N waiting to join — review" re-open pill; a newly-arrived pending id auto-reopens the modal (track previous ids in a ref).
- **R2 stale list after action:** after Accept/Deny, the member leaves `pendingMembers` on the next poll; the modal closes when the list empties. `handleApproval` already calls `pollOnce()`.
- **R2 host-only:** the modal renders only when `state.isHost` (the poll already returns `pendingMembers` only meaningfully for the host UI; non-hosts never render it).
- **R3 sparse results:** higher floors intersected with strict genre/rating filters can thin out results. The existing back-fill in `discoverMovies` (`lib/tmdb.ts:182-196`) already removes the band when banded results are sparse, so no 422 regression. Floors remain strictly descending (3000 > 1000 > 350 > 120 > 40) — the monotonic-bands test still holds.
- **Existing tests:** `__tests__/lib/tmdb.test.ts` asserts the old band numbers (levels 1/3/5) — must be updated. The `vote_count.gte=100` no-depth test is unchanged.

---

## 5. Assumptions & Open Questions

- **Assumption (R1):** "last used" is account-scoped (DB member history), consistent with last cycle's signed-in prefill — not a per-device localStorage value.
- **Assumption (R2):** replacing the inline box with the modal (plus a re-open pill) is acceptable; the modal requires an explicit Accept/Deny per person but can be deferred via the pill.
- **Resolved (R3):** distribution confirmed by the user as the "moderate shift" option.

---

## 6. Out of Scope

- No `auth.ts` / `app/api/auth/*` / `.env*` changes.
- No Prisma schema or migration changes.
- No change to depth **labels/blurbs** (`DEPTH_LEVELS`) or `DEFAULT_MIN_VOTES`.
- No change to the joiner-side "Waiting for the host…" screen (only the host gets the new popup).
- No new approval API; reuse `POST /api/rooms/[code]/approvals`.

---

## 7. Readiness Verdict: READY FOR PLANNING

- R1 → `app/api/user/preferences/route.ts` (+ `defaultName`), `app/page.tsx`, `app/room/[code]/lobby/page.tsx`.
- R2 → new `components/JoinRequestModal.tsx`, `app/room/[code]/vote/page.tsx`, new `__tests__/components/JoinRequestModal.test.tsx`.
- R3 → `lib/tmdb.ts` (`DEPTH_BANDS`), `__tests__/lib/tmdb.test.ts`.
