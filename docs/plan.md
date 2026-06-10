# Plan — Last-used name default, host approval popup, depth-band reshuffle

Derived from `docs/research.md`. Every file below is in `.workflow_plan_files`.

---

## Task 1 — Default name = last-used name, else full user name

### 1a. `app/api/user/preferences/route.ts` (GET)
After loading the user, query their most recent member row and return a resolved default:

```ts
const lastMember = await prisma.member.findFirst({
  where: { userId: session.user.id },
  orderBy: { joinedAt: 'desc' },
  select: { displayName: true },
})
return NextResponse.json({
  displayName: user.displayName,
  defaultName: lastMember?.displayName ?? user.displayName,
  savedServices: user.savedServices,
  savedFilters: user.savedFilters,
})
```

### 1b. `app/page.tsx` & 1c. `app/room/[code]/lobby/page.tsx`
In the prefill effects added last cycle, read `data.defaultName` (instead of `data.displayName`). Keep the one-shot "only when field is empty" guard so typed input is never clobbered.

**Acceptance:** A signed-in user who previously joined a room as "Al" sees "Al" prefilled; a signed-in user who never joined one sees their full account name; both remain editable; signed-out → empty.

---

## Task 2 — Host approval popup for mid-session joiners

### 2a. `components/JoinRequestModal.tsx` (NEW)
Presentational modal (mirrors `HostFilterEditor`'s overlay style). Props:
`{ pendingMembers: {id; displayName}[]; onApprove: (id, 'accept'|'reject') => void; approvingId: string | null }`.
Behavior (self-contained):
- `pendingMembers.length === 0` → render nothing.
- Otherwise auto-open a centered modal: a row per pending member with **Accept** and **Deny** buttons (disabled while `approvingId` is set), calling `onApprove`.
- "Not now" button sets internal `dismissed = true` → modal hides and a compact fixed pill "● N waiting to join — Review" renders instead (click → reopen).
- A `useEffect` tracks previous pending ids in a ref; when a **new** id appears, reset `dismissed = false` so a fresh request re-pops the modal.

### 2b. `app/room/[code]/vote/page.tsx`
- Import and render `<JoinRequestModal pendingMembers={state.pendingMembers ?? []} onApprove={handleApproval} approvingId={approvingId} />` for hosts (alongside `HostFilterEditor`).
- Remove the inline pending-requests box (current lines ~316-348). `handleApproval`/`approvingId` are unchanged.

### 2c. `__tests__/components/JoinRequestModal.test.tsx` (NEW)
- Renders nothing with no pending members.
- Renders each pending name with Accept/Deny; clicking calls `onApprove(id, 'accept'|'reject')`.
- "Not now" hides the modal and shows the review pill; clicking the pill reopens it.

**Acceptance:** With the room in VOTING, when a new person joins, the host immediately sees a popup naming them with Accept/Deny; accepting admits them (their movies load), denying removes them; the joiner keeps seeing "Waiting for the host…" until the host acts.

---

## Task 3 — Depth-band reshuffle (moderate shift)

### 3a. `lib/tmdb.ts`
Replace `DEPTH_BANDS` (and refresh the explanatory comment) with the user-approved moderate shift:

```ts
export const DEPTH_BANDS: Record<number, { gte: number; lte?: number }> = {
  1: { gte: 3000 },            // Crowd-Pleaser
  2: { gte: 1000, lte: 2999 }, // Easy Watch
  3: { gte: 350, lte: 999 },   // The Sweet Spot (default)
  4: { gte: 120, lte: 349 },   // Deep Cut
  5: { gte: 40, lte: 119 },    // Certified Cinephile
}
```

### 3b. `__tests__/lib/tmdb.test.ts`
Update the band assertions: L1 `gte=3000` (no cap), L3 `gte=350`/`lte=999`, L5 `gte=40`/`lte=119`. The monotonic-descending-floors test and the no-depth `gte=100` test are unaffected.

**Acceptance:** `buildDiscoverUrl(['netflix'], { depth: 3 })` yields `vote_count.gte=350` & `vote_count.lte=999`; floors stay strictly descending across levels 1→5.

---

## Schema changes
None.

## API changes
- `GET /api/user/preferences` — response gains `defaultName: string`.
- No other API changes; approval reuses `POST /api/rooms/[code]/approvals`.

## Component changes
- New `JoinRequestModal`; vote page swaps its inline pending box for the modal.
- Home + lobby name prefill now sources `defaultName`.

## Verification (TEST state)
`bash scripts/verify.sh` → typecheck + lint + jest must exit 0. New/updated Jest cases lock R2 (modal) and R3 (bands); R1 and the vote-page wiring are confirmed against the acceptance criteria.
