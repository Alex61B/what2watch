'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggle: () => {},
})

export const THEME_STORAGE_KEY = 'w2w_theme'

/** Apply (or remove) the `dark` class on <html>. */
function applyThemeClass(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/**
 * App-wide light/dark theme. Defaults to LIGHT (the editorial PikFlix look) and
 * persists the choice to localStorage. The actual <html class="dark"> is set
 * pre-paint by an inline script in app/layout.tsx to avoid a flash; this
 * provider reads that initial state and keeps it in sync on toggle.
 */
export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  // Sync state with whatever the pre-paint script decided (localStorage / default).
  useEffect(() => {
    let initial: Theme = 'light'
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored === 'light' || stored === 'dark') initial = stored
    } catch {
      // localStorage unavailable — fall back to the current <html> class.
      initial = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    }
    applyThemeClass(initial)
    // Defer the state sync to a timer callback (an external trigger) so we are
    // not calling setState synchronously in the effect body
    // (react-hooks/set-state-in-effect). The <html> class is already correct
    // pre-paint via the inline script, so this only syncs React state.
    const id = setTimeout(() => setTheme(initial), 0)
    return () => clearTimeout(id)
  }, [])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      applyThemeClass(next)
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        // best-effort persistence
      }
      return next
    })
  }, [])

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
