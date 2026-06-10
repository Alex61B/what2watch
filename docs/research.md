# Research — Collapse filter controls behind a "Filters" toggle

Follow-up to the search/filters work: the controls currently render inline and always-visible. The
user wants the **search box to stay always visible** and the **Sort / Min rating / Year controls to
live behind a "Filters" toggle** that expands them on click.

---

## 1. Requirements Summary
- Search box: unchanged, always visible (with its clear button).
- A **"Filters" toggle button** next to the search box; the Sort / Min-rating / Year panel is hidden
  by default and expands when clicked (collapses again on a second click).
- A small **active-filter indicator** on the button when any filter is non-default (sort ≠ Recently
  added, min rating > 0, or a decade is selected), so applied-but-collapsed filters are discoverable.
- Behavior of the filters themselves and the result grid is unchanged.

## 2. Stack Choices
- Single contained change in `components/MovieListClient.tsx`: add a `filtersOpen` boolean state and
  render the existing controls row conditionally; add the toggle button with `aria-expanded`.
- Reuse existing tokens; mirror the disclosure pattern already used elsewhere (e.g. the vote page's
  roster toggle uses a button with `aria-expanded` + a ▾/▴ caret).
- Tests reuse the existing fetch/Response shim + `@testing-library/user-event`.

## 3. Environment Verification
- No data/API/env changes — purely presentational state in an existing client component. The
  `movies.length > 0` gate (filter bar only shows when there's a list) is retained.

## 4. Risks & Edge Cases
- **Existing tests break:** the current rating/year tests interact with controls that are now hidden
  until the toggle is clicked → those tests must first click "Filters" to expand. (Search/no-match
  tests are unaffected — the search box stays visible.)
- **Active-filter indicator accuracy:** compute from current state (`sort !== 'added' || minRating > 0
  || decade !== 'all'`) so it reflects collapsed-but-applied filters.
- **Lint:** keep the toggle as plain `useState` flipped in an `onClick` (no setState-in-effect).
- **A11y:** the toggle needs `aria-expanded` and the panel an `id` referenced by `aria-controls`.

## 5. Assumptions & Open Questions
- **Resolved (user):** search box stays visible; Sort/Min-rating/Year go behind the toggle.
- **Assumption:** the panel starts collapsed on each visit (no persistence) — simplest and expected.

## 6. Out of Scope
- Changing which filters exist or how they filter; persisting the open/closed state; animating the
  expand; any change to the watchlist/seen page wrappers.

## 7. Readiness Verdict: READY FOR PLANNING
- Implementation → `components/MovieListClient.tsx` (toggle state + button + conditional panel).
- Tests → `__tests__/components/MovieListClient.test.tsx` (controls hidden until toggled; open-then-
  filter for the rating/year cases; search/no-match unchanged).
