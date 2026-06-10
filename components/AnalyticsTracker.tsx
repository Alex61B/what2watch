'use client'
// components/AnalyticsTracker.tsx
// Mounted once in the root layout. Fires `session_start` (once per tab session) and a
// `page_view` on every real client navigation. The lastUrl ref makes page_view
// idempotent under React strict mode's dev double-invoke (exactly one event per URL).
import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { track } from '@/lib/analytics'

function PageView() {
  const pathname = usePathname()
  const search = useSearchParams()
  const lastUrl = useRef<string | null>(null)
  useEffect(() => {
    const query = search?.toString()
    const url = query ? `${pathname}?${query}` : pathname
    if (url === lastUrl.current) return // dedupe: real navigation only
    lastUrl.current = url
    track('page_view', { path: url })
  }, [pathname, search])
  return null
}

export default function AnalyticsTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem('pikflix_session_started')) return
    sessionStorage.setItem('pikflix_session_started', '1')
    track('session_start')
  }, [])
  // useSearchParams() requires a Suspense boundary (matches the signin/page.tsx pattern).
  return (
    <Suspense fallback={null}>
      <PageView />
    </Suspense>
  )
}
