import { startDwell, pauseDwell, resumeDwell, finalizeDwell } from '@/lib/dwell'
import { DWELL_CEILING_MS } from '@/lib/analytics-events'

test('accumulates only visible time across a pause/resume', () => {
  let s = startDwell(0, true) // visible at t=0
  s = pauseDwell(s, 1_000) // hidden at 1s → accum 1s
  s = resumeDwell(s, 5_000) // visible again at 5s (4s backgrounded, not counted)
  const { dwellMs, dwellCapped } = finalizeDwell(s, 6_000) // decide at 6s → +1s
  expect(dwellMs).toBe(2_000)
  expect(dwellCapped).toBe(false)
})

test('caps at the ceiling and flags it', () => {
  const s = startDwell(0, true)
  const out = finalizeDwell(s, DWELL_CEILING_MS + 30_000)
  expect(out.dwellMs).toBe(DWELL_CEILING_MS)
  expect(out.dwellCapped).toBe(true)
})

test('a card that starts hidden counts no time until resumed', () => {
  let s = startDwell(0, false) // not visible at mount
  s = resumeDwell(s, 2_000)
  expect(finalizeDwell(s, 3_000).dwellMs).toBe(1_000)
})

test('pause and resume are idempotent', () => {
  let s = startDwell(0, true)
  s = pauseDwell(s, 1_000) // 1s visible accrued, paused
  s = pauseDwell(s, 5_000) // already paused — no extra accrual
  s = resumeDwell(s, 6_000)
  s = resumeDwell(s, 9_000) // already active — must NOT reset the clock to 9s
  // Visible windows: 0–1s (1s) + 6–10s (4s) = 5s. A non-idempotent resume would
  // reset activeSince to 9s and wrongly yield 2s — so 5s asserts idempotence.
  expect(finalizeDwell(s, 10_000).dwellMs).toBe(5_000)
})
