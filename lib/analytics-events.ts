// lib/analytics-events.ts
// Single source of truth for event names, feature names, and limits.
// Imported by BOTH the client tracker and the server ingest validator so the two
// can never disagree about what is valid.

export const EVENT_TYPES = [
  'session_start',
  'login',
  'page_view',
  'room_created',
  'room_joined',
  'room_started',
  'room_matched',
  'card_decided',
  'feature_used',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const FEATURES = [
  'filter_edit',
  'depth_change',
  'skip_reruns',
  'requeue',
  'share_link',
  'friend_compare',
] as const
export type Feature = (typeof FEATURES)[number]

export const MAX_EVENTS_PER_REQUEST = 20
export const MAX_PROPS_BYTES = 2_048
export const DWELL_CEILING_MS = 60_000

export function isEventType(v: unknown): v is EventType {
  return typeof v === 'string' && (EVENT_TYPES as readonly string[]).includes(v)
}
