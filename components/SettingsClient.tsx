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

  useEffect(() => {
    fetch('/api/user/preferences')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.savedServices) setServices(d.savedServices as ServiceId[]) })
      .catch(() => {})
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim(), savedServices: services }),
      })
      if (res.ok) setSaved(true)
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
    </div>
  )
}
