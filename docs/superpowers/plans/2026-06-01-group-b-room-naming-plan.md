# Group B — Room Naming Implementation Plan

Design: `docs/superpowers/specs/2026-06-01-group-b-room-naming-design.md`
Research: `docs/research.md`

## 1. Schema changes
- `prisma/schema.prisma`: add `name String?` to model `Room`.
- Migration `add_room_name` (additive, nullable). Generated `prisma/migrations/<ts>_add_room_name/migration.sql` is appended to `.workflow_plan_files` in the same Bash command that runs `npx prisma migrate dev --name add_room_name`, so the post-Bash drift check finds it already planned.

## 2. API changes
- `app/api/rooms/route.ts` (`POST`): read `body.name`, normalize (`trim()`, empty→null, cap 60), store as `room.name`.
- `app/api/rooms/[code]/route.ts`: `GET` returns `name`; `PATCH` adds `name` to the host-only whitelist with the same normalization.
- `app/api/rooms/[code]/poll/route.ts`: include `name` in the JSON response.

## 3. UI changes
- `app/page.tsx`: optional "Room name" input in the Create Room form; pass `name` to the create POST.
- `app/room/[code]/setup/page.tsx`: editable "Room name" input; seed from `GET`; PATCH on blur.
- `app/room/[code]/lobby/page.tsx`: render name under the room code when present.
- `app/room/[code]/vote/page.tsx`: show name beside "What2Watch" (truncate); from poll `name`.
- `app/room/[code]/match/page.tsx`: show "from <name>" when present; from poll `name`.
- `app/room/[code]/done/page.tsx`: fetch `GET /api/rooms/[code]` once; show `<name> ·` before heading when present.

## 4. Tests
- `__tests__/api/room-name.test.ts` (node env): create-with-name stores trimmed value (and empty→null); host `PATCH name` updates; `GET`/`poll` include `name`.

## 5. Acceptance criteria
- Creating a room with a name persists it; blank stays null.
- Host can rename on setup; the new name appears in lobby/vote/match/done.
- Lobby, vote header, match, and done show the name when set, and omit it when null.
- `npm run typecheck && npm run lint && npm test` pass (after migration regenerates the client).

## 6. Migration execution (IMPLEMENT, last step)
Single Bash command (user approves the prompt):
```
npx prisma migrate dev --name add_room_name \
  && git ls-files --others --exclude-standard prisma/migrations | grep '_add_room_name/' >> .workflow_plan_files
```
Requires `DIRECT_URL` in `.env.local`. Regenerates the Prisma client so `room.name` typechecks.
