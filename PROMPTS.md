# PROMPTS

A running log of the prompts that drove each workflow cycle.

## 2026-06-18 — M1: Operational Floor (production hardening)

**Prompt (summary):** After an architecture review of the next improvement milestones,
formalize **M1: Operational Floor** and implement it. Scope to production-readiness only (no
recommender/product features): expired-room enforcement, cleanup cron, durable rate limiting,
safe error responses, cookie hardening, health check + monitoring, and `MemberQueue`
retirement. Prefer centralized helpers and small safe changes. Branch off `main` after the
admin work is merged.

**Findings (RESEARCH):** `Room.expiresAt` set but enforced nowhere; no cron/`vercel.json`;
rate limiter in-memory/per-instance with signup+room-create+join unprotected; 6 routes leak
`{stack,stage}` on 500; session cookie lacks `secure`; no `/api/health`; `MemberQueue` is
write-only (read nowhere). Decided: Postgres-backed limiter (no Upstash), Vercel Cron
(secured by `CRON_SECRET`), Sentry deferred (centralized error helper is the seam),
`MemberQueue` **code-only** this cycle (stop writing; drop deferred).

**Implementation:** new `lib/room.ts` (`roomExpired`/410 guard wired into 8 mutation routes +
`expired` flag on poll/GET + client surfacing in vote/lobby), `lib/api-error.ts`
(`logServerError`/`serverError` — generic 500s, full server logs), `lib/rate-limit-db.ts`
(durable fixed-window Postgres limiter on signup/room-create/join/events; fails open),
`app/api/health/route.ts`, `app/api/cron/cleanup/route.ts` + `vercel.json` (daily). Cookie
`secure` in prod; removed the two `MemberQueue` writes. Schema adds `RateLimit` (additive).

**Verification:** Full RESEARCH→PLAN→IMPLEMENT→TEST cycle on `feat/operational-floor` (TDD);
`scripts/verify.sh` green — typecheck + lint + 283 Jest tests (45 suites). **User must run the
`RateLimit` migration (`./node_modules/.bin/prisma migrate dev`) and set `CRON_SECRET` before
deploy.** `MemberQueue` table drop and Sentry wiring deferred to a fast-follow.

## 2026-06-11 — Fix: SettingsClient save-before-load race wiped services

**Prompt (summary):** Follow-up to #18 — fix the race where saving Settings before the prefs GET
resolves persists an empty services list, wiping the user's saved streaming services.

**Root cause:** `services` inits to `[]` and loads async; `handleSave` unconditionally sent
`savedServices`, so an early save wrote `[]`.

**Fix:** add a `servicesKnown` flag (true only after a successful load) and include `savedServices`
in the PUT body **only when known** — otherwise omit it so the route leaves services untouched.
Guarded the GET effect with an `active` cleanup flag. New `__tests__/components/SettingsClient.test.tsx`
(TDD; jsdom + mocked `global.fetch`): the no-wipe case was red, now green.

**Verification:** `scripts/verify.sh` green (2 new component tests).

## 2026-06-11 — Fix: Profile/Settings breaks for a stale session

**Prompt (summary):** "Profile / Settings Info sometimes results in a bug or error." Figure out why and fix.

**Root cause (reproduced):** the Settings flow assumed the session's user still exists. A valid JWT can
outlive its `User` row (deleted account / dev DB reset). Then `/profile/settings` rendered blank info
(`user?.email ?? ''`) — the "bug" — and Save (`PUT /api/user/preferences`) threw an unhandled
`prisma` `P2025` → **500** — the "error". Confirmed by deleting a throwaway user mid-session.

**Fix (defense-in-depth, one root cause, three layers):** PUT uses `updateMany` (no P2025 throw) →
`count === 0` ⇒ `401`; the settings page `redirect('/auth/signin')` when the user row is gone;
`SettingsClient` surfaces failures (redirect on 401, show the error otherwise) instead of failing
silently. New `__tests__/api/user-preferences.test.ts` (TDD — stale-session case was red, now green).

**Verification:** `scripts/verify.sh` green (7 new preference tests). Live re-run: stale `/profile/settings`
→ 307 → `/auth/signin` (was 200 blank); stale Save → 401 (was 500). Seed data restored, test users removed.

## 2026-06-11 — Tier-0 recommender (cycle 2: schema + queue wiring)

**Prompt (summary):** Wire the cycle-1 scorer into the live flow: persist movie features on
`RoomQueue` and re-rank the next card by group-consensus score, with cold-start fallback and
`pickedBy` observability. Migration left gated.

**Approach:** Added `RoomQueue.genreIds Int[]` + `rating Float` (schema only; `prisma generate`'d via
the local CLI — migration deferred/gated). Populated them in `start` + `requeue` from `discoverMovies`.
`queue/route.ts`: load all queue entries (with features) → exclude voted/vetoed/watched in JS → build
the room signal from all votes (dwell joined from `Event` by room **code**, YES only) → `pickNext` →
fall back to lowest position; response gains `pickedBy` + a `[queue] picked` log (`voteCount`,
`dwellMatches`, `topScore`). Reworked `queue-route.test.ts` (mock `findMany`/`event`, id-echoing
`getMovieById`, exclusion-by-selection, warm/cold cases).

**Verification:** `scripts/verify.sh` green — typecheck + lint + Jest (queue-route reworked + 2 new
cases). DB migration NOT yet run (gated).

## 2026-06-11 — Tier-0 recommender (cycle 1: pure scorer)

**Prompt (summary):** Build the in-session group-consensus re-ranker's algorithmic core: a pure
`lib/recommender.ts` that turns the room's `(genres, vote, dwellMs?)` decisions into an
exposure-normalized genre-weight vector and scores/ranks eligible candidates. Spec/plan in
`docs/superpowers/{specs,plans}/2026-06-11-recommender-tier0*`.

**Approach:** `buildRoomSignal` (YES → 1–2× by dwell over 8s, NO → −1, normalize by exposure),
`scoreCandidate` (avg genre weight over candidate genres + 0.1·(rating−6) prior, unknown rating
neutral), `pickNext` (argmax, lowest-position tie-break, null below 5 votes / empty ⇒ caller falls
back). No I/O — pure + unit-tested. Cycle 2 will add the `RoomQueue.genreIds/rating` schema +
persistence + `queue/route.ts` wiring (dwell-by-code join, `pickedBy`) + the gated migration.

**Verification:** `scripts/verify.sh` green — typecheck + lint + Jest (added 12 recommender cases).

## 2026-06-10 — Event tracking pipeline (Phase 2b: funnel + feature emits)

**Prompt (summary):** Wire the remaining client emits: room funnel (`room_created`/`room_joined`/
`room_started`) and `feature_used` (`share_link`, `skip_reruns`, `depth_change`, `filter_edit`,
`requeue`) across the landing, lobby, setup pages and the RoomCodeBar / HostFilterEditor /
DrainedScreen components. (`friend_compare` intentionally dropped — covered by `page_view`.)

**Approach:** One-line `track()` calls at each action's success/branch (link-share tracked once
across the `copyLink`/`navigator.share` fallback). Remediation: my new emit in `DrainedScreen` made
its component test surface a latent bug — `getAnonId` called `crypto.randomUUID()`, which throws in
the jsdom env (and non-secure-context browsers); hardened `lib/analytics.ts` with a `randomUUID`
fallback + a fully fire-and-forget `flush` that never throws.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 204 Jest tests (31 suites). One
remediation loop (the crypto.randomUUID bug), then green.

## 2026-06-10 — Event tracking pipeline (Phase 2a: dwell signal)

**Prompt (summary):** Build the recommender-critical dwell signal: a pure visibility-aware,
ceiling-capped dwell accumulator wired into the vote page as `card_decided`, plus the
`room_matched` funnel event and the analytics-queries doc. (Phase 2 split; 2b = remaining
funnel + `feature_used` emits across ~8 client sites, next cycle.)

**Approach:** New pure `lib/dwell.ts` (clock injected → unit-tested). Vote page (`app/room/[code]/
vote/page.tsx`): a `dwellRef` started by an effect keyed on the current movie id, a
`visibilitychange` listener for pause/resume, and `finalizeDwell` + `track('card_decided', …)`
in `handleVote`; `track('room_matched', …)` in the existing match branch. `docs/analytics-queries.md`
with example SQL. Prisma 6.19.3 restored after an accidental npx-driven 6→7 bump; `Event` migration
committed.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 204 Jest tests (31 suites; +4 dwell).
One self-inflicted test-expectation error (idempotent-resume case) caught by the gate and fixed via
the remediation loop (failures reset on pass).

## 2026-06-10 — Event tracking pipeline (Phase 1: core)

**Prompt (summary):** Implement Phase 1 of the approved event-tracking spec/plan
(`docs/superpowers/{specs,plans}/2026-06-10-event-tracking-pipeline*`): a first-party `Event`
table, an unauthenticated `POST /api/events` ingest, a client `track()`/`flush()` over
`sendBeacon`, and `<AnalyticsTracker/>` (session_start + strict-mode-safe page_view). Approved
amendments: `pikflix_` storage prefix, `clientTs`→`props._clientTs`, test-only rate-limit reset.

**Approach:** Shared allowlist (`lib/analytics-events.ts`) imported by client + ingest. Pure,
clock-injected rate limiter (`lib/rate-limit.ts`) with a `__resetRateLimit` test hook. Ingest is
best-effort (drops bad input → 204; 429 only on rate limit; never 500s). `Event` model added to
`schema.prisma` (no relations) and the Prisma client regenerated via `prisma generate` so it
typechecks — the **DB migration is deferred to a gated step** (user approval required).

**Verification:** `scripts/verify.sh` green — typecheck + lint + 200 Jest tests (31 suites; +11:
7 ingest, 4 rate-limit). DB migration NOT yet run.

## 2026-06-10 — Seed script for test profiles + sample data

**Prompt (summary):** Create login-able profiles + sample data so multi-user flows (starting a room
needs ≥2 members), profiles, and friend-comparison can be tested without manual setup.

**Approach:** New idempotent `prisma/seed.ts`, run via
`TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' npx ts-node --transpile-only prisma/seed.ts`
(no `package.json` change). Creates 4 credential users (alice/bob/carol/dave `@test.dev`, password
`password123`, `bcrypt.hash(pw, 12)` matching `app/api/auth/signup`) with real `savedServices` +
`savedFilters` (`DiscoverFilters` shape). Fetches 12 canonical movies live from TMDB into `MovieCache`
(real poster paths, mirroring `lib/tmdb`'s image base). Seeds overlapping `UserMoviePreference`
watchlist/seen rows + a friendship graph (Alice/Bob/Carol ACCEPTED trio, Carol↔Dave ACCEPTED,
Dave→Alice PENDING). All writes are upserts on unique keys → safe to re-run. Loads `.env.local` via
`dotenv` then dynamically imports `../lib/prisma` so the pg Pool sees `DATABASE_URL`; relative imports
avoid the `@/` alias under ts-node.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 189 Jest tests (29 suites). Seed
executed against the dev DB: 4 users, 12 `MovieCache` rows (real titles/years), watch/seen prefs, and
5 friendships created.

**Follow-up:** added a `db:seed` script to `package.json` (explicitly authorized — restricted file) so
the seed runs via `npm run db:seed`. Drift note: resetting `.workflow_plan_files` orphaned the
uncommitted `prisma/seed.ts` → `.workflow_drift` blocked all mutating tools; recovered via
`advance_state.sh drift-to-plan` (run by user), then re-planned both files. Verified: `npm run db:seed`
re-ran cleanly (idempotent), `verify.sh` green.

## 2026-06-10 — Collapse list filters behind a "Filters" toggle

**Prompt (summary):** Keep the search box always visible, but put the filter options (sort / min
rating / year) behind a "Filters" toggle that expands on click.

**Approach:** Added a `filtersOpen` state to `MovieListClient`. The search box + a "Filters" button now
share one row; the Sort/Year/Min-rating controls render only when expanded (`aria-expanded` +
`aria-controls`, ▾/▴ caret). A small accent dot on the button signals when a filter is applied while
collapsed (`sort !== 'added' || minRating > 0 || decade !== 'all'`). Filtering logic unchanged.

**Verification:** `scripts/verify.sh` green first pass — typecheck + lint + 189 Jest tests (new
"controls behind a Filters toggle" case; the rating/year cases now open the panel first).

## 2026-06-10 — Search + filters for Watch List / Seen Before

**Prompt (summary):** Add a search box and filters to the watch list and seen-before pages. (User
picked the filter set: search + sort + minimum rating + release-year.)

**Approach:** Both pages render the shared `MovieListClient`, so all work landed there. Search/sort/
filter run client-side over the already-loaded list (small personal lists; no API/schema change).
Added a title search box (live filter + clear button), a sort dropdown (Recently added / Highest
rated / Newest / A–Z), a minimum-rating slider, and a release-year decade dropdown (decades derived
from the list). A distinct "No movies match your filters." state shows when the controls exclude
everything (vs. the raw-empty "Nothing here yet."). Note: `MovieCache` only stores title/year/rating,
so genre/runtime/streaming-service filters weren't possible without a migration (out of scope).

**Verification:** `scripts/verify.sh` green — typecheck + lint + 188 Jest tests (added search-narrows,
rating-filter, decade-filter, and no-match cases; one remediation loop to widen a test helper's param
type).

## 2026-06-10 — Cycle 2: per-member decks ("nope" only affects you) + card fits one screen

**Prompt (summary):** A "nope" shouldn't yank the rest of the room to the next movie — just remove it
from the deck (user chose: drop it from everyone's *upcoming* deck, never interrupt the card they're
viewing). Also make the movie card fit one screen (no scrolling to the vote buttons).

**Approach:** Moved from the shared `currentPosition` card to **per-member decks**. `/queue` now sources
the current card from `RoomQueue` (lowest position not in `member votes ∪ global rejects ∪ watched`),
so requeue feeds decks and each member advances independently. The vote page fetches its card from
`/queue` only on mount + after the member's own vote/seen action (never on a poll), so others' votes
never change your card; poll still drives status/members/pending/match. `votes` route drops the
staleness check + `advanceQueueAtomic` (a NO just records a room-wide reject; a YES runs match);
`watched` route drops its shared advance (removal handled by `/queue`'s watched exclusion);
`checkForMatch` now bumps `queueVersion` so MATCHED propagates through the poll's 304 fast-path now
that votes don't. Exhausting your deck shows a per-member "all caught up" screen (host can broaden
filters). `VotingCard` + vote page restructured to a `h-[100dvh]` flex column (poster fills space,
buttons pinned). Updated the queue/votes/watched/match suites accordingly.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 184 Jest tests (remediation loops for
a `set-state-in-effect` lint warning → deferred the card fetch via setTimeout, and a Jest mock
hoisting/TDZ + arity fix in votes.test). The per-member deck flow and one-screen layout are
client-side — confirmed against the acceptance criteria; worth a real two-device browser pass.

## 2026-06-10 — Cycle 1: popup freshness + close, depth bump

**Prompt (summary):** Host approval popup appears late (only after the host advances a card) and
won't close after approving; also the depth levels are still too niche — bump again. (Split the
larger per-member "nope" change into Cycle 2.)

**Approach:** Root cause of the popup staleness: joins/approvals don't bump `room.queueVersion`, so
the poll's ETag/304 fast-path hides membership changes until the queue advances (the poll route's own
comment flags this gap). Fix at the source — bump `queueVersion` in the members-join transaction and
in the approvals handler, so the host's poll refreshes within one tick. Plus `JoinRequestModal` now
closes optimistically (a tapped Accept/Deny row vanishes immediately via a local `resolvedIds` set,
independent of poll timing). Depth `DEPTH_BANDS` raised again: L1 ≥6000 · L2 2000–5999 · L3 800–1999
· L4 250–799 · L5 80–249. Extended the `room.update` mock in the three suites that import the
members/approvals routes.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 185 Jest tests (one remediation loop
for a `set-state-in-effect` lint error, fixed by dropping unnecessary effect-based pruning).

## 2026-06-10 — Last-used name default, host approval popup, depth-band reshuffle

**Prompt (summary):** (1) Default the name field to the user's last-used name, falling back to their
full account name. (2) When someone joins after the room has started, give the host a popup to
approve or deny them (not just the joiner's "waiting" screen). (3) Shift the 5 depth levels more
mainstream — L3 was too niche. (User picked the "moderate shift" distribution.)

**Approach:** (1) `GET /api/user/preferences` now returns `defaultName` = most recent
`Member.displayName` for the user (by `joinedAt`) `?? user.displayName`; the home + lobby prefill
effects read `defaultName`. (2) New `components/JoinRequestModal.tsx` — host-only popup that
auto-opens on pending join requests with per-person Accept/Deny (reusing `handleApproval` +
`POST /approvals`); "Not now" collapses it to a re-open pill, and a brand-new request re-opens it.
The vote page renders it for hosts and drops the old inline pending box. (3) `DEPTH_BANDS` raised to
L1 ≥3000 · L2 1000–2999 · L3 350–999 · L4 120–349 · L5 40–119 (labels/blurbs and `DEFAULT_MIN_VOTES`
unchanged; `FilterControls` shows only labels so no UI change).

**Verification:** `scripts/verify.sh` green — typecheck + lint + 184 Jest tests pass (new
`JoinRequestModal` suite + updated depth-band assertions).

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

## 2026-06-12 — Admin / developer dashboard (V1)

**Prompt (summary):** Add a private, read-only internal admin dashboard at `/admin` to view users,
activity, and analytics — never exposed to normal users, enforced server-side, unauthorized → 404.
Authorize via an `ADMIN_EMAILS` env allowlist (no `isAdmin` column). Keep V1 read-only, tables/numbers
(no charts), no DB migrations, manual `Event.userId → User.id` joins, and add small best-effort login
tracking that must never break sign-in. Do not expose password hashes, session tokens, or auth tokens.

**Approach:** `lib/admin.ts` `requireAdmin()` (allowlist parse + DB email lookup → `notFound()` on any
non-admin); `lib/admin-queries.ts` read-only data layer (overview metrics, per-day actives via one
`date_trunc` `$queryRaw`, users list with a per-page `event.groupBy` activity join, user detail, user
events, global events feed with a batched user-identity join) — every `select` is a safe-column
allowlist. Pure server-component pages (`app/admin/{layout,page,users,users/[id],events}`) guarded
before any query; paging/filtering via `searchParams`; no admin API routes. Login tracking: add
`'login'` to `EVENT_TYPES`, a best-effort `lib/login-event.ts` `recordLoginEvent()` (added to the
manifest in IMPLEMENT for testability), wired into `auth.ts` `events.signIn`. `ADMIN_EMAILS` documented
in a new `README.md` (no `.env*` touched). Spec/plan in `docs/superpowers/{specs,plans}/2026-06-12-*`.

**Verification:** `scripts/verify.sh` green — typecheck + lint + 250 Jest tests pass (39 suites),
drift-free. New tests: admin guard (8), admin queries incl. PII-leak guard (9), login event (4),
per-page access control (5).
</content>
