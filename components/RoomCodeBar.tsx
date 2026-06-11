'use client'

import { useState } from 'react'
import BrandMark from '@/components/BrandMark'
import { track } from '@/lib/analytics'

interface RoomCodeBarProps {
  code: string
  /** `ink` = on light surfaces; `inverse` = on the dark result hero. */
  tone?: 'ink' | 'inverse'
  /** Show the CODE / LINK / SHARE chip buttons (default true). */
  actions?: boolean
  /**
   * When provided, the room-code chip becomes a button (host-only affordance to
   * edit filters mid-session). Otherwise the chip is static.
   */
  onEditFilters?: () => void
}

/** Person glyph for the room-code chip. */
function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

/**
 * The top chrome shared by the setup, voting and result screens: the PikFlix
 * wordmark on the left and the room code + CODE / LINK / SHARE actions on the
 * right. On the voting screen the host passes `onEditFilters` so tapping the
 * room-code chip opens the mid-session filter editor.
 */
export default function RoomCodeBar({
  code,
  tone = 'ink',
  actions = true,
  onEditFilters,
}: RoomCodeBarProps) {
  const [codeCopied, setCodeCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const joinUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/room/${code}/lobby` : ''

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  async function copyLink() {
    track('feature_used', { feature: 'share_link' }, { roomId: code })
    try {
      await navigator.clipboard.writeText(joinUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  async function share() {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        track('feature_used', { feature: 'share_link' }, { roomId: code })
        await navigator.share({ title: 'Join my movie night on PikFlix', url: joinUrl })
        return
      }
      await copyLink()
    } catch {
      /* user dismissed the sheet */
    }
  }

  const inverse = tone === 'inverse'
  const chip =
    'inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors'
  const neutralChip = inverse
    ? `${chip} border-white/30 text-white hover:bg-white/10`
    : `${chip} border-ink/80 text-ink hover:bg-ink hover:text-canvas`
  const codeChip = inverse
    ? `${chip} border-white/30 text-white`
    : `${chip} border-ink/80 text-ink`

  return (
    <div className="flex items-center justify-between gap-3">
      <BrandMark size="sm" tone={tone} />
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {onEditFilters ? (
          <button
            type="button"
            onClick={onEditFilters}
            className={`${codeChip} ${inverse ? 'hover:bg-white/10' : 'hover:bg-ink hover:text-canvas'}`}
            title="Edit filters"
          >
            <PeopleIcon />
            {code}
          </button>
        ) : (
          <span className={codeChip}>
            <PeopleIcon />
            {code}
          </span>
        )}

        {actions && (
          <>
            <button type="button" onClick={copyCode} className={neutralChip}>
              {codeCopied ? 'Copied' : 'Code'}
            </button>
            <button
              type="button"
              onClick={copyLink}
              className={`${chip} border-accent bg-accent text-accent-ink hover:opacity-90`}
            >
              {linkCopied ? 'Copied' : 'Link'}
            </button>
            <button type="button" onClick={share} className={neutralChip}>
              Share
            </button>
          </>
        )}
      </div>
    </div>
  )
}
