# Group B — Room Naming Design

**Date:** 2026-06-01
**Cycle:** Second of four (A shipped; C = watch-providers, D = join-with-approval later).
**Status:** Approved for planning.

## Goal

The host optionally names the room at creation; the name is editable on the setup page and shown to everyone in the lobby, the vote header, and at the end of a session (match + done).

## Decisions (confirmed with user)
- **Optional** name (nullable `Room.name`).
- Shown in: **lobby**, **vote header**, **match + done**.
- **Editable** by the host on the setup page.
- Migration: **I run** `prisma migrate dev`, user **approves** the prompt.

## Schema
Add to `Room`:
```prisma
name String?
```
Migration `add_room_name` (additive, nullable — safe). Drift mitigation: append the generated `migration.sql` path to `.workflow_plan_files` in the same Bash command that runs the migration.

## API
- `POST /api/rooms` — accept optional `name` in the body; `trim()`, treat empty as null, cap at 60 chars; store on the room.
- `PATCH /api/rooms/[code]` — add `name` to the host-only whitelist (same trim/null/cap rules).
- `GET /api/rooms/[code]` — return `name`.
- `GET /api/rooms/[code]/poll` — return `name`.

## UI
- **`app/page.tsx`** (Create Room form): add an optional "Room name" text input; send `name` with the create POST.
- **`app/room/[code]/setup/page.tsx`**: add an editable "Room name" input (controlled), PATCH on blur (reusing the existing PATCH pattern); seed from `GET`.
- **`app/room/[code]/lobby/page.tsx`**: show the name under the room code when present.
- **`app/room/[code]/vote/page.tsx`**: show the name beside "What2Watch" in the header (truncate if long); read from poll.
- **`app/room/[code]/match/page.tsx`**: show "from <name>" when present; read from poll.
- **`app/room/[code]/done/page.tsx`**: fetch `GET /api/rooms/[code]` once to read `name`; show "<name> · " before the heading when present.

## Tests (node env, mirroring existing API test mocks)
- Create room with a `name` stores it (and trims/empties to null).
- `PATCH` `name` as host updates it; non-host still rejected.
- `GET` and `poll` responses include `name`.
- UI wiring covered by typecheck + lint (lobby/vote/match/done have no component tests due to the jsdom fetch shim limitation).

## Files
`prisma/schema.prisma` (+ generated `prisma/migrations/<ts>_add_room_name/migration.sql`), `app/api/rooms/route.ts`, `app/api/rooms/[code]/route.ts`, `app/api/rooms/[code]/poll/route.ts`, `app/page.tsx`, `app/room/[code]/setup/page.tsx`, `app/room/[code]/lobby/page.tsx`, `app/room/[code]/vote/page.tsx`, `app/room/[code]/match/page.tsx`, `app/room/[code]/done/page.tsx`, and API tests.

## Out of Scope
Watch-providers (C), join-with-approval (D), name uniqueness/moderation/search.
