// components/SettingsClient.tsx
'use client'

import { useEffect, useState } from 'react'
import StreamingServicePicker from '@/components/StreamingServicePicker'
import type { ServiceId } from '@/lib/tmdb'

export default function SettingsClient({ email, initialName }: { email: string; initialName: string }) {
  const [displayName, setDisplayName] = useState(initialName)
  const [services, setServices] = useState<ServiceId[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True once we've loaded the saved services from the server. Until then we must NOT
  // send savedServices on save — that would wipe them to [] before they loaded.
  const [servicesKnown, setServicesKnown] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/user/preferences')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!active) return
        if (d && Array.isArray(d.savedServices)) {
          setServices(d.savedServices as ServiceId[])
          setServicesKnown(true)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      // Only persist services once we've loaded them; otherwise omit the field so the
      // route leaves the user's saved services untouched (no save-before-load wipe).
      const payload: { displayName: string; savedServices?: ServiceId[] } = {
        displayName: displayName.trim(),
      }
      if (servicesKnown) payload.savedServices = services
      const res = await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setSaved(true)
      } else if (res.status === 401) {
        // Stale session (the account no longer exists) — re-authenticate.
        window.location.href = '/auth/signin'
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d?.error ?? 'Could not save your settings. Please try again.')
      }
    } catch {
      setError('Could not save your settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <label className="text-sm text-muted">Email</label>
        <p className="text-ink">{email}</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted">Display name</label>
        <input
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          className="w-full rounded-lg bg-surface-soft border border-line px-4 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted">Default streaming services</label>
        <StreamingServicePicker selected={services} onChange={setServices} />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2.5 font-semibold text-white transition-colors"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && <p className="text-sm text-emerald-400">Saved.</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
