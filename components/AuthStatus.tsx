'use client'
import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'

export default function AuthStatus() {
  const { data: session, status } = useSession()

  if (status === 'loading') return null

  if (session?.user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-400">{session.user.name ?? session.user.email}</span>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <Link
      href="/auth/signin"
      className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
    >
      Sign in
    </Link>
  )
}
