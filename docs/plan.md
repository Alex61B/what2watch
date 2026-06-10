# Plan — Collapse filters behind a "Filters" toggle

Every file below is in `.workflow_plan_files`.

## `components/MovieListClient.tsx`
- Add state: `const [filtersOpen, setFiltersOpen] = useState(false)`.
- Compute `filtersActive = sort !== 'added' || minRating > 0 || decade !== 'all'`.
- Layout: put the always-visible search box and a **"Filters" toggle button** on one row (search
  `flex-1`, button shrink-0). Button:
  - `onClick={() => setFiltersOpen(o => !o)}`, `aria-expanded={filtersOpen}`, `aria-controls="list-filters"`.
  - Label `Filters` + a ▾/▴ caret; show a small accent dot when `filtersActive`.
- Wrap the existing Sort / Year / Min-rating controls row in `{filtersOpen && (<div id="list-filters">…</div>)}`.
- Everything else (search input + clear, the derived `visible` list, grid, empty/no-match states)
  unchanged.

## `__tests__/components/MovieListClient.test.tsx`
- Add a helper to open the panel: click the `Filters` button before interacting with Sort/Year/Rating.
- Update the **min-rating** and **release-year** cases to open Filters first.
- Add a case: the Sort/Year/Rating controls are **not** in the document on load, and **appear** after
  clicking `Filters`.
- Leave the **search-narrows** and **no-match** cases as-is (search box stays visible).

## Schema / API
None.

## Acceptance criteria
- On load, only the search box + a "Filters" button show; the sort/rating/year controls are hidden.
- Clicking "Filters" reveals them; clicking again hides them.
- Applying a filter then collapsing shows an active indicator on the button.
- Search still works with the panel collapsed.

## Verification
`bash scripts/verify.sh` → typecheck + lint + jest exit 0.
