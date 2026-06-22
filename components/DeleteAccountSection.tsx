'use client'
// components/DeleteAccountSection.tsx
// WP6/M9: self-serve account deletion. A type-to-confirm guard arms the destructive button; on
// confirm it calls DELETE /api/account, then signs the user out. An email fallback is shown for the
// web-accessible deletion-request path (Google policy). The mailto uses the single lib/legal source.
import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { PRIVACY_CONTACT_EMAIL } from '@/lib/legal'

const CONFIRM_WORD = 'DELETE'

export default function DeleteAccountSection() {
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const armed = confirm.trim().toUpperCase() === CONFIRM_WORD

  async function handleDelete() {
    if (!armed || deleting) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch('/api/account', { method: 'DELETE' })
      if (res.ok) {
        // Clears the JWT session cookie and redirects home.
        await signOut({ callbackUrl: '/' })
        return
      }
      setError(
        res.status === 429
          ? 'Too many attempts. Please wait a moment and try again.'
          : 'Could not delete your account. Please try again.',
      )
    } catch {
      setError('Could not delete your account. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
      <h2 className="text-sm font-semibold text-red-400">Delete account</h2>
      <p className="text-sm text-muted">
        This permanently deletes your account and all associated data — your profile, watch and seen
        lists, friends, votes, and room memberships. Deleting your account also removes you from any
        active rooms. This cannot be undone.
      </p>
      <p className="text-sm text-muted">
        Prefer to request deletion by email? Contact{' '}
        <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
          {PRIVACY_CONTACT_EMAIL}
        </a>
        .
      </p>
      <label htmlFor="confirm-delete" className="block text-sm text-muted">
        Type <span className="font-semibold text-ink">{CONFIRM_WORD}</span> to confirm
      </label>
      <input
        id="confirm-delete"
        type="text"
        value={confirm}
        onChange={e => setConfirm(e.target.value)}
        autoComplete="off"
        className="w-full rounded-lg bg-surface-soft border border-line px-4 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-red-500"
      />
      <button
        type="button"
        onClick={handleDelete}
        disabled={!armed || deleting}
        className="rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2.5 font-semibold text-white transition-colors"
      >
        {deleting ? 'Deleting…' : 'Delete my account'}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  )
}
