'use client'

import { useTheme } from '@/components/ThemeProvider'

/**
 * Global light/dark toggle. Rendered once (fixed, bottom-right) from the root
 * layout so it's reachable on every page without colliding with the top-bar
 * chrome. Editorial styling: small square, near-black hairline, sharp corners.
 * Shows a sun in dark mode (tap for light) and a moon in light mode (tap for dark).
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="fixed bottom-4 right-4 z-50 inline-flex h-9 w-9 items-center justify-center border border-ink/70 bg-surface text-ink shadow-sm transition-colors hover:bg-ink hover:text-canvas focus:outline-none focus:ring-2 focus:ring-accent"
    >
      {isDark ? (
        // Sun
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        // Moon
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}
