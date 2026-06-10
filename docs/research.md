# Research — Streaming links, prefilled name, second-user "loading movies…" hang

Three independent requests in one cycle:

1. **Streaming redirect** — the "Watch on …" button on the match screen should open the actual streaming service (Netflix, etc.), not the TMDB website.
2. **Prefilled name** — when the user is signed in, pre-populate the name field on the home and lobby join forms (still editable).
3. **Bug: second user stuck on "Loading movies…"** — after the host starts a room, opening the shared link as a new user hangs forever on the vote screen's spinner.

---

## 1. Requirements Summary

### R1 — Streaming service redirect
The match-result page (`components/MatchResult.tsx`) renders a "● Watch on {service}" CTA. Today its `href` is a TMDB URL:

```
const watchLink = movie.watchProviders?.link ?? movie.watchUrl ?? null   // MatchResult.tsx:61
```

- `watchProviders.link` → TMDB/JustWatch redirect `https://www.themoviedb.org/movie/{id}/watch?locale=US`
- `watchUrl` → `https://www.themoviedb.org/movie/{id}` (stored at queue build: `start/route.ts:90`, `requeue/route.ts:119`)

Both land on TMDB. The user wants the button to open the real service (e.g. `netflix.com`). TMDB does **not** expose stable per-title deep links to Netflix/Prime/etc., so the realistic best-effort is a **title-search deep link into the matched service** (e.g. `https://www.netflix.com/search?q=Parasite`).

### R2 — Prefilled name when signed in
Two name inputs, both editable:
- Home page `app/page.tsx:28` — shared `name` state for create + join (input at :167).
- Lobby page `app/room/[code]/lobby/page.tsx:42` — `joinName` (input at :192).

When signed in, the field should arrive populated with the user's display name; the user can overwrite it.

### R3 — Second user hang (the bug)
A new user who opens the shared link (`/room/{code}/lobby`) after the room is in `VOTING` is immediately redirected to `/room/{code}/vote` **before joining**, never gets a session cookie, and the vote page's poll 401s forever → "Loading movies…" never clears.

---

## 2. Stack Choices (existing patterns to leverage)

- **Streaming map:** `lib/tmdb.ts` already owns `STREAMING_SERVICES` (id → name → tmdbId) and is already imported by `MatchResult.tsx`. Add a pure `buildStreamingUrl()` helper there; no new file or dependency.
- **Name source:** `app/api/user/preferences` already runs `auth()` and reads the `User` row, and its `PUT` already accepts `displayName`. Extend its `GET` to also return `displayName` (authoritative, reflects profile/settings). This avoids touching the restricted `auth.ts` and works for both pages without wiring `useSession()` into the lobby (a 401 from the endpoint simply means "anonymous → don't prefill").
- **Redirect gating:** the existing GET `/api/rooms/[code]` already returns `currentMemberId` (null for non-members). Use it to gate the lobby redirect. No API change needed for the bug fix.
- **Tests:** Jest + Testing Library already cover `MatchResult` and `lib/tmdb`. Update/extend those.

---

## 3. Environment Verification

- `TMDB_API_KEY` is read in `lib/tmdb.ts:88` (already working — discover/match flows function for the host today). No new env needed.
- No new packages, no schema/migration changes. `RoomQueue.streamingService` and `watchUrl` already exist and stay as-is.
- Auth unchanged: `session.strategy = 'jwt'`; `User.displayName` already populated on signup (`auth.ts:13-19`, credentials `authorize` returns `name: user.displayName` at :50).
- `.env.local` is open in the IDE but **must not be edited** (restricted) — no change required for any of these tasks.

---

## 4. Risks & Edge Cases

- **R1 provider-name variance:** TMDB provider names vary ("Amazon Prime Video", "Disney Plus", "Apple TV Plus", "HBO Max"/"Max"). The helper must match by keyword/substring (lowercased) and also accept the internal `STREAMING_SERVICES` id as a fallback. `RoomQueue.streamingService` is only `serviceIds[0]` (`start/route.ts:89`), i.e. the *first selected* service, not necessarily where the title actually streams — so prefer the live `watchProviders.providers[0].name`, fall back to the stored id, then to the TMDB link if nothing maps.
- **R1 unmatched service:** if no provider maps (unknown service / no providers returned), fall back to the existing TMDB link / "Check {service} for availability" so the CTA never breaks.
- **R1 existing tests:** `__tests__/components/MatchResult.test.tsx:54-76` assert the TMDB href. They must be updated to assert the new service URL (otherwise verify.sh fails).
- **R2 clobbering input:** prefill must not overwrite text the user already typed — only set when the field is still empty. Guard with a one-shot effect / empty-check.
- **R2 anonymous users:** `GET /api/user/preferences` 401s when signed out — swallow and leave the field empty.
- **R3 mid-session join is pending-approval:** joining while `VOTING` creates an unapproved member (`members/route.ts:45`). After the fix the joiner should be routed to `/vote`, which already renders the "Waiting for the host…" screen (`vote/page.tsx:254`) and the host already sees the approval prompt (`vote/page.tsx:317`). So the fix must **redirect after a successful join**, not only suppress the premature redirect.
- **R3 polling path is already safe:** the lobby's 3s poll calls `/poll`, which 401s for non-members and returns early (`lobby:88`), so it never redirects a non-member. The *only* offending redirect is in the initial `loadRoom` (`lobby:73`), which uses `/api/rooms/[code]` (no auth) and fires regardless of membership.
- **Client-component testing:** the lobby fix lives in a client component; jsdom lacks `fetch`/`Response`, so a full lobby render test is heavy. Lean on manual verification for the redirect flow; keep automated coverage on the pure/route-level pieces.

---

## 5. Assumptions & Open Questions

- **Assumption (R1):** A title-search URL into the service is acceptable as "redirect to Netflix" (no public per-title deep-link API exists). Region is US (matches `watch_region: 'US'` in `buildDiscoverUrl`).
- **Assumption (R2):** The authoritative name to prefill is `User.displayName` (what the user manages in profile settings), not the per-room display name.
- **Assumption (R3):** A new user opening a `VOTING` room link *should* be allowed to join (mid-session join with host approval is an intended, already-built feature). The fix surfaces the existing join form rather than blocking.
- **Resolved:** `session.user.name` may or may not be reliably populated across providers; sidestepped by reading `displayName` from the DB via the preferences endpoint.

---

## 6. Out of Scope

- No changes to `auth.ts`, `app/api/auth/*`, session strategy, or any `.env*` file.
- No Prisma schema or migration changes; `RoomQueue.watchUrl`/`streamingService` columns are kept.
- No real per-title streaming deep links via a third-party availability API (only search-deep-links).
- No redesign of the lobby/vote/match UI beyond the targeted fixes.
- No change to `requeue`/`start` URL persistence (the link is computed at render time from provider data).

---

## 7. Readiness Verdict: READY FOR PLANNING

Root causes confirmed by reading source:
- R1 → `MatchResult.tsx:61` (+ `lib/tmdb.ts` for the helper).
- R2 → `app/page.tsx`, `app/room/[code]/lobby/page.tsx`, `app/api/user/preferences/route.ts`.
- R3 → `app/room/[code]/lobby/page.tsx:73` (premature redirect before join) + add post-join redirect.

Anticipated files to touch (finalized in PLAN): `lib/tmdb.ts`, `components/MatchResult.tsx`, `app/api/user/preferences/route.ts`, `app/page.tsx`, `app/room/[code]/lobby/page.tsx`, `__tests__/components/MatchResult.test.tsx`, `__tests__/lib/tmdb.test.ts`.
