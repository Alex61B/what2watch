// components/ProfileGuard.tsx
import { redirect } from 'next/navigation'
import { auth } from '@/auth'

/** Returns the signed-in user id, or redirects to sign-in. Server components only. */
export async function requireUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')
  return session.user.id
}
