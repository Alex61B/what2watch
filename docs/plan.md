# Plan — Streaming links, prefilled name, second-user hang

Derived from `docs/research.md`. Three independent changes; each lists the edit, the contract, and an acceptance criterion. Every file below is in `.workflow_plan_files`.

---

## Task 1 — "Watch on …" opens the real streaming service

### 1a. `lib/tmdb.ts` — add a pure URL builder
Add an exported helper plus an internal provider→search-URL map:

```ts
export function buildStreamingUrl(opts: {
  providerName?: string | null   // live TMDB provider name, e.g. "Amazon Prime Video"
  serviceId?: string | null      // internal STREAMING_SERVICES id, e.g. "prime"
  title: string
}): string | null
```

- Resolve a `serviceId` from `providerName` (lowercased keyword match: `netflix`, `prime|amazon`, `disney`, `hbo|max`, `hulu`, `apple`) → fall back to the passed `serviceId`.
- Map the resolved id to a title-search deep link (US region), title URL-encoded:
  - `netflix` → `https://www.netflix.com/search?q={t}`
  - `prime` → `https://www.primevideo.com/search?phrase={t}`
  - `disney` → `https://www.disneyplus.com/search?q={t}`
  - `hbo` → `https://play.max.com/search?q={t}`
  - `hulu` → `https://www.hulu.com/search?q={t}`
  - `apple` → `https://tv.apple.com/search?term={t}`
- Return `null` when nothing maps (caller falls back to the TMDB link).
- Pure function (no fetch/env) so it is safe to import in the (server) `MatchResult` component and unit-test directly.

### 1b. `components/MatchResult.tsx` — prefer the real service link
Change the `watchLink` derivation (currently line 61):

```ts
const serviceUrl = buildStreamingUrl({
  providerName: movie.watchProviders?.providers?.[0]?.name,
  serviceId: movie.streamingService,
  title: movie.title,
})
const watchLink = serviceUrl ?? movie.watchProviders?.link ?? movie.watchUrl ?? null
```

`serviceName` logic is unchanged. CTA markup unchanged.

### 1c. Tests
- `__tests__/lib/tmdb.test.ts` — add cases for `buildStreamingUrl`: provider-name match, internal-id fallback, name-variant ("Amazon Prime Video" → primevideo), unknown → null, title encoding.
- `__tests__/components/MatchResult.test.tsx` — update the two TMDB-href assertions (lines 54-76) to expect the Netflix search URL for the Netflix fixtures; add/keep a fallback case where an unmapped service still yields the TMDB link.

**Acceptance:** Given a matched movie on Netflix, the "Watch on Netflix" CTA `href` is `https://www.netflix.com/search?q=Parasite` (not a themoviedb.org URL). An unrecognized service still produces a working CTA via the TMDB fallback.

---

## Task 2 — Prefill the name when signed in

### 2a. `app/api/user/preferences/route.ts` — return `displayName` from GET
Add `displayName: true` to the `select` and include `displayName` in the JSON response. PUT is unchanged.

### 2b. `app/page.tsx` — prefill the shared `name`
Add an effect: when `session?.user?.id` is present, `GET /api/user/preferences`; on success set `name` to the returned `displayName` **only if the field is still empty** (one-shot guard so it never clobbers typed input). Anonymous → endpoint 401s → leave empty.

### 2c. `app/room/[code]/lobby/page.tsx` — prefill `joinName`
Add an effect on mount: `GET /api/user/preferences`; on success set `joinName` to `displayName` **only if still empty**. 401/failure → leave empty (no `useSession` needed). Lives alongside the Task 3 fix in the same file.

**Acceptance:** A signed-in user opening the home page sees their display name pre-filled in "Your name"; opening a room link sees it pre-filled in the join form; both remain editable; a signed-out user sees an empty field.

---

## Task 3 — Fix the second-user "Loading movies…" hang

### 3a. `app/room/[code]/lobby/page.tsx` — gate redirect on membership + redirect after join
1. In `loadRoom` (currently line 73), **only** call `handleRedirect(data.status)` when `data.currentMemberId !== null`. A non-member (no session) stays on the lobby and sees the "Join this room" form even when the room is `VOTING`.
2. In `handleJoin`, after a successful join + room refetch, call `handleRedirect(data.status)` so a mid-session joiner is routed to `/vote` (which already renders the pending-approval "Waiting for the host…" screen) and a lobby joiner stays put (no-op for `LOBBY`).

The 3s poll effect already 401s for non-members and returns early, so no change needed there.

**Acceptance:** With a room in `VOTING`, opening the shared `/room/{code}/lobby` link as a brand-new browser shows the join form (no infinite spinner); after entering a name and joining, the user lands on `/vote` showing "Waiting for the host…"; the host sees and can accept the join request, after which the joiner's movies load.

---

## Schema changes
None. No Prisma model or migration changes.

## API changes
- `GET /api/rooms/[code]` — no change (already returns `currentMemberId`).
- `GET /api/user/preferences` — response gains `displayName: string`.

## Component changes
- `components/MatchResult.tsx` — watch CTA href now points to the streaming service.
- `app/page.tsx` — name field prefilled for signed-in users.
- `app/room/[code]/lobby/page.tsx` — join-name prefilled; redirect now gated on membership and fired after join.

## Verification (TEST state)
`bash scripts/verify.sh` → `npm run typecheck` + `npm run lint` + `npm test` must exit 0. The updated/added Jest cases lock R1; R2 and R3 (client-component flows) are confirmed by manual run-through per the acceptance criteria above.
