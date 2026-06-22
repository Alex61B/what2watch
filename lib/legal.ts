// lib/legal.ts
// Single source of truth for the legal identity used by the privacy/terms pages and the
// account-deletion UI. Centralizing these means no duplicated literals scattered across the
// codebase — filling in the real values at launch is a one-place change.
//
// Resolved with the owner (2026-06-21): individual data controller, Florida governing law.
export const DATA_CONTROLLER = 'Alexander Smith'
export const GOVERNING_LAW = 'State of Florida, United States'

// The ONLY code-literal placeholder. Replace this single value at launch.
export const PRIVACY_CONTACT_EMAIL = '[PRIVACY_CONTACT_EMAIL]'

// Display-only site URL. `[PROD_DOMAIN]` is otherwise NOT hardcoded anywhere — the runtime
// domain is the single `NEXT_PUBLIC_SITE_URL` env var (consumed by app/layout.tsx metadataBase)
// plus AUTH_URL / the Google OAuth console config.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? '[PROD_DOMAIN]'

// Effective date shown on the policies. A literal so it renders stably in tests/builds.
export const LEGAL_LAST_UPDATED = 'June 21, 2026'
