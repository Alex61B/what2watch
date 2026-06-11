# Research — Fix: SettingsClient save-before-load race wipes saved services

## Requirements Summary

Follow-up to the stale-session fix (#18). `SettingsClient` has a race: `services` initializes to `[]`
and is populated by an async `GET /api/user/preferences`; `handleSave` **unconditionally** sends
`savedServices`. Clicking **Save before the GET resolves** persists `[]`, wiping the user's saved
streaming services. Fix so a save can never wipe services it hasn't loaded yet.

## Root Cause

`components/SettingsClient.tsx`:
- `const [services, setServices] = useState<ServiceId[]>([])` — starts empty.
- `useEffect` GETs prefs and `setServices(d.savedServices)` asynchronously.
- `handleSave` body: `{ displayName, savedServices: services }` — always includes `services`, which
  is `[]` until the GET lands. The PUT route applies `savedServices` whenever it's a valid array,
  so an early save writes `[]`.

## Stack Choices

- Add a `servicesKnown` flag set **true only after a successful load** (a `savedServices` array came
  back). `handleSave` includes `savedServices` in the body **only when `servicesKnown`**; otherwise it
  omits the field, so the PUT route's `if (Array.isArray(body.savedServices))` is false and services
  are left untouched. This distinguishes "not loaded yet" (omit) from "loaded, user chose empty" (send `[]`).
- Guard the GET effect with an `active` cleanup flag (avoid setState after unmount).
- Test: new `__tests__/components/SettingsClient.test.tsx` (jsdom) mocking `global.fetch` — the repo's
  jsdom env lacks fetch, so a full mock is used (see memory `reference-jest-jsdom-no-fetch`).

## Environment Verification

- The stale-session fix (#18) is on `main`; this branches off it.
- `StreamingServicePicker` renders each service's name + `aria-pressed` — usable to assert the loaded
  state in the test.

## Risks & Edge Cases

- User toggles a service before load → GET overwrites it (server value wins). Minor, no data loss; not
  the reported bug. (No `disabled` prop on the picker; not adding one.)
- Explicit "clear all services" after load: `services=[]` + `servicesKnown=true` ⇒ sends `[]` ⇒ clears
  (correct).
- Name-only save before load: omits `savedServices` ⇒ name saved, services preserved.

## Assumptions & Open Questions

- The route already treats a missing `savedServices` as "leave unchanged". No blocking questions.

## Out of Scope

- Disabling the picker during load; broader settings UX changes.

## Readiness Verdict: READY FOR PLANNING
