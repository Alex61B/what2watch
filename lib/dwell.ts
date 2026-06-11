// lib/dwell.ts
// Pure, visibility-aware dwell accumulator. The clock is injected (now: number) so it
// is unit-testable without a DOM. Only time while the card is the current card AND the
// tab is visible is counted; the result is hard-capped so a backgrounded tab can never
// poison the average that feeds the recommender.
import { DWELL_CEILING_MS } from './analytics-events'

export interface DwellState {
  accumMs: number
  activeSince: number | null // timestamp while visible+current; null while paused
}

export function startDwell(now: number, visible: boolean): DwellState {
  return { accumMs: 0, activeSince: visible ? now : null }
}

export function pauseDwell(s: DwellState, now: number): DwellState {
  if (s.activeSince === null) return s // already paused — idempotent
  return { accumMs: s.accumMs + (now - s.activeSince), activeSince: null }
}

export function resumeDwell(s: DwellState, now: number): DwellState {
  if (s.activeSince !== null) return s // already active — idempotent
  return { ...s, activeSince: now }
}

export function finalizeDwell(s: DwellState, now: number): { dwellMs: number; dwellCapped: boolean } {
  const raw = s.accumMs + (s.activeSince !== null ? now - s.activeSince : 0)
  if (raw > DWELL_CEILING_MS) return { dwellMs: DWELL_CEILING_MS, dwellCapped: true }
  return { dwellMs: Math.max(0, Math.round(raw)), dwellCapped: false }
}
