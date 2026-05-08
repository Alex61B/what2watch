'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: 'There is a problem with the server configuration.',
  AccessDenied: 'You do not have permission to sign in.',
  Verification: 'The verification link may have expired or already been used.',
  OAuthSignin: 'Could not start the sign-in flow. Please try again.',
  OAuthCallback: 'Could not complete sign-in. Please try again.',
  OAuthCreateAccount: 'Could not create your account. Please try again.',
  OAuthAccountNotLinked: 'This email is already associated with another sign-in method.',
  Default: 'An error occurred during sign-in. Please try again.',
}

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error') ?? 'Default'
  const message = ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Sign-in error</h1>
        <p className="text-gray-400">{message}</p>
        <Link
          href="/auth/signin"
          className="inline-block rounded-xl bg-indigo-600 hover:bg-indigo-500 px-6 py-3 font-semibold transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <AuthErrorContent />
    </Suspense>
  )
}
