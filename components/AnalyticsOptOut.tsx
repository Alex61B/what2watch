'use client'
// components/AnalyticsOptOut.tsx
// WP6: a per-device toggle for the first-party analytics opt-out. Reads the localStorage flag via
// useSyncExternalStore (the React-sanctioned way to read a client-only store without a hydration
// mismatch and without setState-in-effect). Disclosed in /privacy; no consent banner, opt-out only.
import { useSyncExternalStore } from 'react'
import { isAnalyticsOptedOut, setAnalyticsOptOut } from '@/lib/analytics'

// 'storage' fires for cross-tab changes; the custom event covers same-tab toggles.
const OPTOUT_EVENT = 'pikflix:analytics-optout-changed'

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(OPTOUT_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(OPTOUT_EVENT, callback)
  }
}

export default function AnalyticsOptOut() {
  // Server snapshot is `false` so SSR/hydration is stable; the client snapshot reflects localStorage.
  const optedOut = useSyncExternalStore(subscribe, isAnalyticsOptedOut, () => false)

  function toggle() {
    setAnalyticsOptOut(!optedOut)
    window.dispatchEvent(new Event(OPTOUT_EVENT))
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">Analytics</h2>
      <p className="text-sm text-muted">
        We use privacy-friendly, first-party analytics (no IP address stored, no third-party
        trackers) to understand how the app is used. You can opt out on this device.
      </p>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={optedOut}
        className="rounded-lg bg-surface-soft border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface transition-colors"
      >
        {optedOut ? 'Analytics off — tap to re-enable' : 'Opt out of analytics on this device'}
      </button>
    </div>
  )
}
