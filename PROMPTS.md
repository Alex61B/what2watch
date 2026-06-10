# PROMPTS

A running log of the prompts that drove each workflow cycle.

## 2026-06-10 — Streaming-service links, prefilled name, second-user "loading movies…" hang

**Prompt (summary):** (1) Make the "watch" links redirect to the actual streaming service (e.g.
Netflix) instead of the TMDB site. (2) Pre-populate the name field with the signed-in user's name
(still editable). (3) Fix the bug where a second user opening a shared link after the host starts the
room is stuck forever on "Loading movies…".

**Approach:** (1) New pure `buildStreamingUrl()` in `lib/tmdb.ts` maps the live TMDB provider name
(or stored service id) to a title-search deep link per service (Netflix/Prime/Disney+/Max/Hulu/Apple
TV+); `MatchResult.tsx` prefers it, falling back to the TMDB link only for unrecognized services.
(2) `GET /api/user/preferences` now returns `displayName`; `app/page.tsx` and the lobby page prefill
the name field from it on mount (one-shot, never clobbers typed input; anonymous 401 → empty).
(3) Root cause: `lobby/page.tsx` redirected to `/vote` before the visitor joined, so a non-member
got no session cookie and the poll 401'd forever. Fix: only redirect when `currentMemberId !== null`
(non-members now see the join form even for in-progress rooms), and redirect *after* a successful
join so a mid-session joiner lands on the existing host-approval screen.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 178 Jest tests pass (added
`buildStreamingUrl` cases, updated `MatchResult` href assertions). R2/R3 are client-flow changes
confirmed against the documented acceptance criteria in `docs/plan.md`.

## 2026-06-10 — Route tests for start + queue (GET) handlers

**Prompt (summary):** Add unit tests for the requeue route + the seen-it/skip-reruns vote flow, and
for functionality not yet tested. The requeue/watched/votes suites had already landed (entry below)
via a parallel session, so this cycle covered the two highest-value still-untested handlers (the
parallel session's research listed `start` and `queue` (GET) as out of scope).

**Approach:** Two additive `@jest-environment node` suites — `__tests__/api/start.test.ts` (12 tests)
and `__tests__/api/queue-route.test.ts` (9) — using the established mocked-`@/lib/prisma` + cookie-jar
pattern; `discoverMovies`/`auth`/`getMovieById` mocked. start: host/state/member-count/service guards,
422 no-movies, the shared-queue + per-member-queue build, and the non-fatal save-prefs hook. queue
(GET): guards, voted/rejected/watched exclusion incl. the `watchedFilter` OR-clause for a linked
user, the three null short-circuits (no eligible card / missing room-queue row / TMDB failure), the
heartbeat, and the hydrated card + remaining count. No production changes.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 170 Jest tests pass (28 suites; 21 new).

## 2026-06-10 — Route-handler tests for requeue / watched / votes (rec #4)

**Prompt (summary):** Go ahead with recommendation #4 — unit tests for the requeue / watched / votes
route handlers (the still-untested ones; the concurrency cycle covered match/queue/join-approval/
rooms-session/poll-members/room-code-collision).

**Approach:** Three additive `@jest-environment node` suites
(`__tests__/api/{requeue,watched,votes}.test.ts`, 24 tests) using the established in-memory
`@/lib/prisma` + cookie-jar mock pattern; `advanceQueueAtomic`/`checkForMatch`/`getMovieById`/
`discoverMovies` mocked (each already has its own unit suite). Cover the guards plus: requeue
VOTING-vs-DRAINED position math + exclusion + no-fresh branch; watched skip-reruns ON/OFF advance
branching (incl. the fresh-position re-read from the concurrency fix) + best-effort hook;
votes stale-vote 409 / NO-advance / YES-no-match / YES-match hydration. No production changes.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 149 Jest tests pass (24 new).

## 2026-06-10 — Fix concurrency / race conditions in room voting & lifecycle

**Prompt (summary):** Audit the app for bugs / race conditions, then fix all the findings.

**Approach:** Five query-level fixes (no schema change):
- `lib/match.ts` — `checkForMatch` writes MATCHED via a `status:'VOTING'`-guarded `updateMany` and
  reports a match only when it actually wrote a row, so a delayed vote can't resurrect a terminal
  (matched/drained) room.
- `lib/queue.ts` — `advanceQueueAtomic` counts queue length AFTER the CAS and drains via a guarded
  `updateMany (status='VOTING' AND currentPosition >= len)`, so a stale length / concurrent MATCHED
  can't be clobbered to DRAINED.
- `votes` + `watched` routes — re-read live `currentPosition`/`queueVersion` after body-parse and
  validate the card + run the CAS advance against those fresh values (was a stale top-of-handler
  snapshot).
- `members` route — member-create + per-member-queue build now run in one `$transaction` from a
  single in-tx status read, so a late joiner is never left approved-but-queueless.
- `rooms` create — treat the INSERT as the source of truth and retry on P2002 (regenerating the
  code) instead of check-then-insert, which could 500 on a code collision.
Dropped a speculative `approvals` re-check after confirming it's unreachable (reject/accept only
target unapproved members, who aren't in the unanimity count); R2's live risk is covered by the
match guard.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 125 Jest tests pass (updated
match/queue/join-approval/rooms-session/poll-members mocks for the guarded writes + `$transaction`;
added a `room-code-collision` P2002 retry test).

## 2026-06-09 — Strip debug logging + wire "Deal more movies"

**Prompt (summary):** Do recommendations #2 and #3 — strip the debug logging, and make the drained-
room "Deal more movies" button functional.

**Approach:** Removed the request-tracing `console.log`/`console.warn` (and the lone `TEMP DEBUG`)
from the rooms API routes + `members`/`approvals` + `lib/queue.ts` + `lib/tmdb.ts`, dropping
orphaned log-only vars (`queueLength` in poll/votes, `envReport` in start); kept every
`console.error` (fatal + non-fatal hook failures) and the `stage` markers used by error responses.
Wired `DrainedScreen`'s host button to `POST /api/rooms/[code]/requeue` (resumes a drained room with
the same filters), with loading + catalogue-exhausted messaging; the vote page's poll loop swaps
back to the card on success.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 120 Jest tests pass (DrainedScreen
suite updated for the now-functional button).

## 2026-06-09 — Functional depth dial (review-count bands)

**Prompt (summary):** For the "How deep are we going?" depth selector, figure out the number of
reviews per movie and make a distribution best fitting the 5 levels.

**Approach:** Sampled the live TMDB `discover` distribution (US + the app's 6 providers) and mapped
the 5 levels to equal-population `vote_count` (review-count) bands: L1 ≥500, L2 150–499, L3 75–149,
L4 35–74, L5 15–34 (default L3). `lib/tmdb.ts` gains a `DEPTH_BANDS` table + `depth` on
`DiscoverFilters`; `buildDiscoverUrl` applies the band (default `vote_count.gte=100` when no depth);
`discoverMovies` back-fills without the band when a band is starved (< 12 results) so no combo
regresses. `FilterControls` depth blurbs reworded to describe real review-count tiers. Depth already
flows via `room.filters.depth` → `start`/`requeue`. See `docs/research.md` for the measured data.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 119 Jest tests pass (incl. 5 new depth-band cases).

## 2026-06-09 — PikFlix editorial UI redesign (PDF-driven)

**Prompt (summary):** Restyle the existing PikFlix app to match `Preliminary Research.pdf` (5
mockups: landing, room setup, voting, match interstitial, final result). Global editorial design
system — off-white `#F4F3EE` canvas, near-black ink, red `#D0021B` accent, serif display headings
with italic accents, uppercase tracking-wide eyebrows, 1px black hairlines, sharp rectangular
corners, black/red/outlined rectangular buttons, `© 2026 PIKFLIX · WHERE DECISIONS GET MADE`
footer. Restyle existing pages (don't create new ones). Behavioral changes limited to: seen-it as a
pre-vote toggle (record-only when "Skip the Reruns" off; removes the movie for the whole room mid-
session when on), host editing filters mid-session from the room chip (applies to the remaining
queue), and a brief match interstitial before the result. Copy: "Pik" for brand actions
(`Let's Pik…`, `PIK IT`, `PIK AGAIN`), with "Tonight's pick." kept as the one result-heading
exception; never "pic".

**Decisions (Q&A):** keep the theme toggle but default to the editorial light theme (light matches
the PDF; dark is best-effort on the same tokens); depth 1–5 selector added as cosmetic UI (no
discovery change); restyle scope = core flow redesigned + other pages inherit palette/fonts; keep
the richer filter controls (dual rating slider + free-form runtime), restyled.

**Approach:** retarget the existing light tokens to the editorial palette + add an `accent` token;
load an editorial serif via `next/font`; flip the default theme to light. New shared components
(`BrandMark`, `BrandFooter`, `RoomCodeBar`, `FilterControls`, `HostFilterEditor`, `MatchResult`);
rebuild landing/setup/voting/match-result + restyle lobby/drained/services/member-list/voting-card.
Backend: `watched` route advances the shared veto queue when skip-reruns is on; new host-only
`requeue` route re-discovers + rebuilds the remaining queue; optional validated `code` on
`POST /api/rooms` for the pre-generated landing code (flagged deviation). See `docs/research.md`.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 114 Jest tests pass (22 suites).

## 2026-06-01 — Room Setup redesign + app-wide light/dark theme

**Prompt (summary):** Redesign the Room Setup page using Julia's "PikFlix" mockup as inspiration
(tighter/faster, not pixel-perfect): room identity header with room code + Copy code / Share link at
the top, "Name your movie night" input with fun placeholders, members, streaming services, filters,
a "Skip the reruns" personality card, and the Start Voting CTA. Remove the bottom invite/share card.
Add an app-wide light/dark theme toggle (default dark, preserved). Keep the max-runtime number input.

**Approach:** Semantic CSS-variable tokens (`canvas / surface / surface-soft / line / ink / muted /
faint`) defined in `app/globals.css` (`:root` light, `.dark` dark with the original hexes so dark
mode is unchanged), exposed as Tailwind colors with `darkMode: 'class'`. Custom `ThemeProvider`
(localStorage, no new deps) + `ThemeToggle` (inline SVG), with a pre-paint no-flash script in
`app/layout.tsx`. Redesigned `app/room/[code]/setup/page.tsx`; migrated all other pages and
components from hardcoded grays to tokens (adding explicit `text-white` to colored buttons that
previously relied on the page-wide white cascade).

**Verification:** `scripts/verify.sh` green — typecheck + lint + 111 Jest tests pass; `npm run build`
succeeds.
</content>
