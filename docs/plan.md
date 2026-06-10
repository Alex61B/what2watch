# Plan — PikFlix editorial UI redesign

Execution plan for the redesign. Build order: (1) tokens/fonts/theme → (2) shared components →
(3) backend → (4) core screens. Drive serially (no parallel agents — the workflow state is a
singleton). Every file below is in `.workflow_plan_files`.

## Design tokens (light = default, editorial)

`app/globals.css` `:root` (light) — retarget to:
```
--canvas:       #F4F3EE   /* off-white page */
--surface:      #FFFFFF   /* cards, inputs */
--surface-soft: #EDEBE3   /* inactive chips, slider track, hover, fills */
--line:         #D8D5CC   /* hairline borders */
--ink:          #16130F   /* near-black text + crisp borders/buttons */
--muted:        #5C584F   /* secondary text */
--faint:        #8E897C   /* tertiary text / placeholders */
--accent:       #D0021B   /* red */
--accent-ink:   #FFFFFF   /* text on red */
color-scheme: light
```
`.dark` block stays as-is; add `--accent: #EF4444; --accent-ink:#FFFFFF` so the token resolves.
`.dual-thumb` thumbs: indigo → `--accent` red. `body { background: var(--canvas); color: var(--ink) }`.

`tailwind.config.ts` — add `colors.accent: { DEFAULT: 'var(--accent)', ink: 'var(--accent-ink)' }`
and `fontFamily: { sans: ['var(--font-sans)', ...system], serif: ['var(--font-serif)','Georgia','serif'] }`.

## Fonts (`app/layout.tsx`)

- `next/font/google`: `Inter` (`variable:'--font-sans'`) + `Playfair_Display`
  (`style:['normal','italic']`, `variable:'--font-serif'`) — no new npm dep.
- `<body className="${inter.variable} ${playfair.variable} font-sans">`.
- Flip default theme to **light**: init script adds `.dark` only when `localStorage w2w_theme === 'dark'`
  (default = light/no class). `metadata.title = 'PikFlix'`.

## Class conventions (apply on core screens + shared components)

- Eyebrow: `text-[11px] font-semibold uppercase tracking-[0.18em] text-faint`.
- Serif hero/headings: `font-serif` (+ `italic` for accent words, often `text-accent`).
- Primary button (black): `bg-ink text-canvas font-semibold uppercase tracking-wide rounded-none`.
- Accent button (red): `bg-accent text-accent-ink ... rounded-none`.
- Outlined secondary: `border border-ink bg-transparent text-ink rounded-none` (NOPE: `border-accent text-accent`).
- Disabled primary: `bg-faint/40 text-canvas cursor-not-allowed`.
- Cards/inputs: `bg-surface border border-line rounded-none`. Selected chip/card: `bg-ink text-canvas` (or `bg-accent`).
- Sharp corners everywhere on these screens (`rounded-none`); inherited pages keep their radii.

## Files

### 1. Tokens / theme
- **app/globals.css** — editorial `:root`, dark `--accent`, red slider thumbs.
- **tailwind.config.ts** — `accent` color + `fontFamily` serif/sans.
- **app/layout.tsx** — load Playfair+Inter as vars, default-light init script, `font-sans` body, title.
- **components/ThemeProvider.tsx** — default `'light'`; init reads `w2w_theme`, light unless `'dark'`.
- **components/ThemeToggle.tsx** — restyle: small square, `border-ink`, `rounded-none`, sun/moon.

### 2. Shared components (new)
- **components/BrandMark.tsx** — `Pik`(ink)+`Flix`(accent) serif wordmark; props `size`, `tone`
  ('ink' | 'inverse' for dark hero).
- **components/BrandFooter.tsx** — `© 2026 PIKFLIX · WHERE DECISIONS GET MADE` eyebrow, centered.
- **components/RoomCodeBar.tsx** — top chrome: BrandMark left; right = room-code chip + `CODE`/`LINK`
  (red)/`SHARE` chip-buttons (copy code / copy link / native share). Optional `onEditFilters` makes
  the code chip a host button. `tone` for dark hero.
- **components/FilterControls.tsx** — extracted controls (props: values + onChange callbacks):
  `StreamingServicePicker`, dual rating slider, free-form runtime, genre chips, skip-reruns switch,
  **cosmetic depth 1–5 selector** (`HOW DEEP ARE WE GOING?` + `LVL n` caption). Pure controlled
  component; persistence handled by callers (setup PATCHes live; host editor stages then applies).
- **components/HostFilterEditor.tsx** — modal/sheet over the vote page; loads current room, renders
  `FilterControls` (staged local state), `Apply` → PATCH `/api/rooms/[code]` then POST
  `/api/rooms/[code]/requeue`; surfaces "no movies match" message; `Cancel`/backdrop closes.
- **components/MatchResult.tsx** — rich result layout (dark hero band + BrandMark inverse + `ALL VOTES
  IN` + serif `Tonight's pick.` + member-initial red squares + `n/n MATCHED`; off-white body: poster,
  serif title, `YEAR · RUNTIME MIN`, stars + `/10 IMDB`, genre chips from `genreIds`, overview,
  `THE ROOM` member cards w/ check, `AVAILABLE ON` red `● WATCH ON {SERVICE} ↗` CTA, `PIK AGAIN`,
  BrandFooter). Props: matched movie, members, code.

### 3. Backend (minimal)
- **app/api/rooms/[code]/watched/route.ts** — after recording WatchedMovie, if `room.watchedFilter`
  and the marked id === current `roomQueue[currentPosition]`, call `advanceQueueAtomic(room.id,
  room.currentPosition, room.queueVersion)` (removes for the whole room, bumps queueVersion). Return
  `{ ok, removed, advance? }`. OFF → record-only (unchanged).
- **app/api/rooms/[code]/requeue/route.ts** (new) — host-only, VOTING only. Exclude
  rejected(vote=false) + positions ≤ currentPosition + (watched whole-room if watchedFilter).
  `discoverMovies(services, filters, 60)` minus excluded → in a `$transaction`: delete roomQueue
  positions > currentPosition, `createMany` new at currentPosition+1.. (`skipDuplicates`),
  `queueVersion: { increment: 1 }`. If 0 new, leave queue, return `{ requeued:false }`.
- **app/api/rooms/route.ts** — accept optional `body.code`: if `isValidRoomCode` and unused, use it;
  else fall back to the existing generator loop. Backward compatible.

### 4. Core screens
- **app/page.tsx** — landing: `SIGN IN` top-right (AuthStatus), serif `Let's Pik…` (red `…`),
  subtitle, `YOUR NAME` label + "Who's watching tonight?" input (shared name), rule, `Create a room`
  (serif) + pre-gen code (generated in effect) + Copy Code/Copy Link/Share + black `CREATE ROOM →`,
  `OR` rule, `Join a room` (serif) + code input + red `JOIN →`, rule, BrandFooter. Create POSTs with
  pre-gen `code`, navigates using returned code. Keep Google sign-in affordance minimal/below.
- **app/room/[code]/setup/page.tsx** — `RoomCodeBar` chrome (CODE/LINK/SHARE), `ROOM SETUP` eyebrow +
  serif `Settle in.` (red italic `in.`), subtitle; members; **remove** "What's on tonight?" &
  "Fine-tune the evening." headings (keep `REQUIRED · STREAMING SERVICES` / `OPTIONAL · FILTERS`
  eyebrows); render controls via `FilterControls` (live PATCH on change); name-your-night input;
  gray disabled `START VOTING ›` until ≥1 service; red error text. Keep ≥1-service requirement.
- **app/room/[code]/vote/page.tsx** — `RoomCodeBar` (host → opens `HostFilterEditor`); `MOVIE n OF N`
  + `x remaining` eyebrow row; `VotingCard` with `seen`, `onToggleSeen`, `skipReruns=watchedFilter`.
  Seen logic: skip-reruns ON → toggle calls `handleMarkWatched` (now removes for room) ; OFF → toggles
  local `seen`, and on vote-commit if `seen` POST `/watched` (record-only). Reset `seen` per card.
  Keep pending-approval/roster/drained branches, restyled.
- **components/VotingCard.tsx** — editorial: poster with `SEEN IT?` toggle pill bottom-right (eye icon,
  checked style), serif title, `YEAR · RUNTIME MIN`, stars + `{rating} /10 IMDB`, overview, swipe
  hints (`‹ SWIPE TO PASS  |  SWIPE TO PICK ›`), `NOPE` (outlined red) + `PIK IT` (black) buttons,
  swipe stamps recolored (PICK=ink, NOPE=accent). New props: `seen`, `onToggleSeen`, `skipReruns`.
- **app/room/[code]/match/page.tsx** — phase state: show `MatchCelebration` interstitial ~1.8s
  (timer), then render `MatchResult`. Fetch poll once for matchedMovie + members + name + code.
- **components/MatchCelebration.tsx** — repurpose as brief full-screen interstitial: serif
  `It's a match.` (red `match.`), subtle reveal, on canvas. (No longer the final layout.)
- **app/room/[code]/done/page.tsx** — editorial no-match: eyebrow + serif `No match tonight.`, copy,
  black `PIK AGAIN` (→ setup), `Back to home`, BrandFooter.
- **components/DrainedScreen.tsx** — editorial restyle (sharp, ink/accent), keep coming-soon affordance.
- **app/room/[code]/lobby/page.tsx** — editorial: `RoomCodeBar`/BrandMark, serif room code/name,
  join form, members via `MemberList`, share, host setup link — restyled to tokens + sharp corners.
- **components/MemberList.tsx** — editorial member rows (red initial square, check), sharp corners.
- **components/StreamingServicePicker.tsx** — editorial cards: thin border, colored dot + name,
  selected = `bg-ink text-canvas` (sharp), keep brand dot color; `X selected` handled by caller.
- **components/AuthStatus.tsx** — restyle `SIGN IN` as an outlined chip top-right; signed-in state tidy.

## Verification (TEST)
`bash scripts/verify.sh` → typecheck + lint + jest. Watch for: `react-hooks/set-state-in-effect`
(use setTimeout pattern for the pre-gen code, placeholder, interstitial timer), `next/image` for any
poster, escaped entities, no unused imports. Then `advance_state.sh next`.
