'use client'
import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'

const CHIP =
  'inline-flex items-center border border-ink px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink transition-colors hover:bg-ink hover:text-canvas'

export default function AuthStatus() {
  const { data: session, status } = useSession()

  if (status === 'loading') return null

  if (session?.user) {
    return (
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]">
        <Link href="/profile" className={CHIP}>
          Profile
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="font-semibold text-faint transition-colors hover:text-ink"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <Link href="/auth/signin" className={CHIP}>
      ⇥ Sign in
    </Link>
  )
}
