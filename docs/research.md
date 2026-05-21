# Research: Dual-Handle Rating Range Slider

## Requirements Summary

Replace the two stacked `<input type="range">` sliders in the room setup filter panel with a single-track dual-handle slider. Two bugs to fix:
1. The min slider's `max` prop is set to `maxRating` and the max slider's `min` prop is set to `minRating` — dragging max leftward forces min to move too (coupled state).
2. Once both handles reach the same position, only the top-z-index slider is reachable.

Implementation: CSS overlay approach — two absolutely-positioned inputs on one track, `pointer-events: none` on the slider element, `pointer-events: all` on the `::webkit-slider-thumb` pseudo-element only. Last-touched handle gets `z-index: 5` via React `onPointerDown` state.

## Stack Choices

- Next.js 15 / React 19, TypeScript, Tailwind CSS
- No new packages — change is pure CSS + React state
- CSS class added to `app/globals.css` (already imported globally)
- `accent-indigo-500` replaced by custom thumb style in the `.dual-thumb` CSS rule

## Environment Verification

- `app/globals.css` is the global stylesheet (3 lines, Tailwind directives only) — safe to append
- `app/room/[code]/setup/page.tsx` contains the filter UI and both rating state variables
- Both state variables (`minRating`, `maxRating`) are typed `number | ""` — handlers must guard against `""` when clamping

## Risks & Edge Cases

- `Number("") === 0` — if either state value is `""`, naive clamping would clamp to 0; handlers explicitly guard this
- Thumb overlap when min === max: z-index is set via `onPointerDown`, last-touched always wins; edge case at 0 and 10 defaults to max-on-top and min-on-top respectively
- Firefox uses `::-moz-range-thumb` — both vendor prefixes included in CSS

## Assumptions & Open Questions

- No other page references the rating range sliders; change is isolated to `setup/page.tsx`
- No open questions

## Out of Scope

- Touch event handling beyond what the native `<input type="range">` provides
- Changing the 0–10 scale or the 0.5 step
- Any other filter UI changes

## Readiness Verdict: READY FOR PLANNING

Two files to change: `app/globals.css` (new CSS class) and `app/room/[code]/setup/page.tsx` (state, handlers, JSX).
