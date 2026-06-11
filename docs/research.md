# Research — Event tracking pipeline (Phase 2b: funnel + feature emits)

Spec/plan: `docs/superpowers/{specs,plans}/2026-06-10-event-tracking-pipeline*`. Phases 1 + 2a
shipped (core pipeline + dwell signal). This cycle adds the remaining client-side emits.

## Requirements Summary

Add `track()` calls at the client action sites for the room funnel and feature usage, using the
Phase 1 client + allowlist. One-liners, additive, no behavior change.

| Event | Site |
|---|---|
| `room_created` | `app/page.tsx` `handleCreateRoom` (create success) |
| `room_joined` | `app/page.tsx` `handleJoinRoom` + `app/room/[code]/lobby/page.tsx` `handleJoin` |
| `room_started` | `app/room/[code]/setup/page.tsx` `handleStart` + `lobby/page.tsx` `handleStart` |
| `feature_used: share_link` | `app/page.tsx` + `components/RoomCodeBar.tsx` (copyLink/share) |
| `feature_used: skip_reruns` | `setup/page.tsx` `patchWatchedFilter` |
| `feature_used: depth_change` | `setup/page.tsx` `onDepthChange` |
| `feature_used: filter_edit` | `components/HostFilterEditor.tsx` `handleApply` (after PATCH ok) |
| `feature_used: requeue` | `components/DrainedScreen.tsx` `dealMore` |

`room_matched` already shipped in 2a.

## Stack Choices

- Reuse `track()` from `lib/analytics.ts` and the `FEATURES`/`EVENT_TYPES` allowlist from
  `lib/analytics-events.ts`. No new modules, no new tests (thin call-site wiring).
- `share` handlers that fall back to `copyLink` emit only once: `copyLink` always tracks; `share`
  tracks only in its `navigator.share` branch.

## Environment Verification

- Exact handler anchors read for all 6 files (create/join/start success points; the
  `patchWatchedFilter`, `onDepthChange`, `handleApply`, `dealMore`, `copyLink`/`share` bodies).
- All target files are `'use client'` components — `track()` runs client-side and no-ops on SSR.

## Risks & Edge Cases

- **Double-count on share fallback** — avoided by tracking link-share in `copyLink` + only the
  `navigator.share` branch of `share`.
- **No behavior change** — emits are fire-and-forget, added after the relevant success/branch.
- **Lint** — `track` imported and used in each file; inline `onDepthChange` gains a third statement.

## Assumptions & Open Questions

- `roomId` at the client layer is the room **code** (what the client holds) — acceptable; the
  Event table stores it as a string. No blocking questions.

## Out of Scope

- **`friend_compare`** intentionally dropped: visiting `/profile/friends/[id]` is already captured
  by `page_view`, so a separate event would be redundant.
- Recommender logic, dashboards, retention cron.

## Readiness Verdict: READY FOR PLANNING
