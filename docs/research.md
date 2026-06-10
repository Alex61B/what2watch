# Research — Seed script for test profiles + sample data

## Requirements Summary

Starting a room and exercising the social features (rooms, profiles, friend-comparison)
requires **multiple real, login-able users** with data. Manually creating 4 accounts +
watchlists + friendships through the UI every time the dev DB is reset is tedious.

Deliver an **idempotent seed script** (`prisma/seed.ts`) that populates the dev database
with 4 credential-login users and realistic sample data so the full multi-user flow can be
tested immediately by opening 4 browser sessions.

What it creates (all via `upsert` → safe to re-run):

- **4 users** — credentials login, password `password123` for all:
  - `alice@test.dev` / Alice, `bob@test.dev` / Bob, `carol@test.dev` / Carol, `dave@test.dev` / Dave
  - Each with `savedServices` (real `ServiceId` slugs) and `savedFilters` (real `DiscoverFilters` shape).
- **~12 `MovieCache` rows** — fetched **live from TMDB** via the app's own `getCachedMovie()`,
  so titles / years / ratings / overviews / **real poster paths** are genuine and current.
- **`UserMoviePreference`** — each user gets ~4 `WATCHLIST` + ~3 `SEEN_BEFORE` entries, with
  deliberate overlaps so **friend-comparison shows shared movies**.
- **Friendships** — Alice↔Bob, Alice↔Carol, Bob↔Carol, Carol↔Dave = `ACCEPTED`;
  Dave→Alice = `PENDING` (to test the incoming-request accept/decline UI).

## Stack Choices

Leverage existing code and patterns — no new dependencies:

- **`bcryptjs` `hash(password, 12)`** — matches `app/api/auth/signup/route.ts` exactly, so
  credentials login (`auth.ts`) works for the seeded users.
- **`getCachedMovie()` from `lib/movie-cache.ts`** — already fetches a movie from TMDB and
  upserts `MovieCache`. Reusing it guarantees real poster paths/metadata and the exact row
  shape the app writes, instead of hardcoding (possibly stale) paths.
- **`STREAMING_SERVICES` slugs** (`lib/tmdb.ts`): `netflix | prime | disney | hbo | hulu | apple`.
- **`DiscoverFilters` / `RoomFilters` shape**: `{ genres?: number[], maxRuntime?: number,
  minRating?: number, maxRating?: number, depth?: number }` — confirmed at the authoritative
  write site `app/api/rooms/[code]/start/route.ts` (persists `savedFilters: filters`). `genres`
  use `TMDB_GENRES` ids; `depth` is 1–5.
- **Prisma client** via `lib/prisma.ts` (reads `DATABASE_URL`).
- **`dotenv`** (already installed) to load `.env.local` for the standalone script.

Idempotency keys: `User.email` unique; `UserMoviePreference @@unique([userId, tmdbMovieId, type])`;
`Friendship @@unique([requesterId, receiverId])`; `MovieCache.tmdbMovieId @id`.

## Environment Verification

- **Node v26** — native `--env-file` support (not required given the dynamic-import approach below).
- **`ts-node`**, **`tsconfig-paths`**, **`dotenv`**, **`bcryptjs`** all present in `node_modules`.
- **`.env.local`** defines `DATABASE_URL`, `DIRECT_URL`, `TMDB_API_KEY` (configured), `AUTH_*`,
  `GOOGLE_*`. `TMDB_API_KEY` being set means live poster fetch will succeed.
- **Module mismatch**: `package.json` has no `"type": "module"` (CommonJS), but `tsconfig.json`
  uses `module: esnext` + `moduleResolution: bundler` (Next-only). ts-node must override these.
- **Run command (no `package.json` edit needed):**
  ```bash
  TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
    npx ts-node --transpile-only prisma/seed.ts
  ```
- **Env-load ordering**: `lib/prisma.ts` creates the pg `Pool` at import time, so `DATABASE_URL`
  must be set first. The script statically imports only `dotenv`, calls `config({ path: '.env.local' })`,
  then **dynamically imports** `../lib/prisma` and `../lib/movie-cache` inside `main()` so env is
  loaded before the pool is created. Relative imports avoid the `@/` alias (no tsconfig-paths reg).

## Risks & Edge Cases

- **TMDB unreachable / rate-limited at seed time** → `getCachedMovie()` returns a fallback
  (`Title unavailable`, empty poster) and does **not** write a `MovieCache` row. Mitigation: seed
  logs a warning per movie that came back as fallback; in-app the card would then live-fetch on view.
- **Re-running the seed** must not duplicate or error → all writes are `upsert`/unique-key based.
- **Writes to the real dev DB** (`DATABASE_URL` in `.env.local`). The run command is a mutating,
  non-allowlisted command → it will prompt for permission (explicit confirmation gate). Not run
  automatically.
- **bcrypt cost 12** for 4 hashes is fast (<1s); negligible.
- **`prisma/` is a workflow-tracked dir** → `prisma/seed.ts` must be listed in
  `.workflow_plan_files` (PLAN) to avoid drift in IMPLEMENT.
- **`verify.sh` runs `tsc --noEmit` project-wide** → `prisma/seed.ts` must be type-clean and
  lint-clean even though no test imports it.

## Assumptions & Open Questions

- Target DB = the dev Postgres in `.env.local` (assumed; confirmed acceptable by user).
- Movie ID list uses canonical, well-known TMDB ids (e.g. 27205 Inception, 157336 Interstellar,
  155 The Dark Knight, 603 The Matrix, 680 Pulp Fiction, 13 Forrest Gump, 550 Fight Club,
  278 Shawshank, 238 The Godfather, 19995 Avatar, 24428 The Avengers, 122 LOTR: ROTK). Titles
  are sourced live from TMDB, so only the ids need to be correct.
- No `package.json` `db:seed` script added (restricted file); run via the documented command.
- No open blocking questions.

## Out of Scope

- Editing `package.json` (no `prisma.seed` / npm script).
- Editing `.env*`, auth logic, or running any Prisma **migration** (schema already migrated).
- Seeding `Room` / `Member` / `Vote` / `RoomQueue` rows — rooms are created live through the UI;
  the seed only provides the users + profile/social data needed to start one.
- Google-OAuth-based seed users (credentials only).
- Any change to Jest tests (they are fully mocked and unaffected).

## Readiness Verdict: READY FOR PLANNING

All inputs (slugs, filter shape, hashing config, runner, env loading) are verified against source.
The only residual runtime dependency (TMDB reachability) degrades gracefully and is logged.

---

## Addendum (follow-up) — add a `db:seed` npm script

**Requirement:** the user explicitly authorized editing `package.json` to add a convenience script
that wraps the documented run command, so the seed can be run with `npm run db:seed`.

**Stack/approach:** add one line to `package.json` `"scripts"`:
`"db:seed": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' ts-node --transpile-only prisma/seed.ts"`.
npm puts `node_modules/.bin` on PATH, so `ts-node` (not `npx`) suffices. The single quotes protect the
JSON env value from the shell. No `prisma.seed` config (that hooks `prisma db seed`, which the workflow
hook blocks); a plain script keeps it explicit and out of Prisma's migrate/reset paths.

**Environment:** `package.json` is a hook-gated app file → editable only in IMPLEMENT with the path in
`.workflow_plan_files`. `npm run db:seed` is not on the read-only allowlist and mutates the DB, so it
prompts for permission (expected). `ts-node` already present.

**Risks/edge cases:** the inner double-quotes must be JSON-escaped in the file. `npm run db:seed`
inherits the same TMDB/DATABASE_URL requirements as the raw command. Verified by actually running it.

**Out of scope:** unchanged from above (still no `.env*`/auth/migration changes).

**Readiness:** READY FOR PLANNING.
