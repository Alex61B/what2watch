// lib/admin.ts
// Server-side admin authorization. V1 uses an ADMIN_EMAILS allowlist (no isAdmin column).
// requireAdmin() is the single gate for every /admin page: unauthorized callers (anonymous
// or signed-in non-admins) get notFound() so the admin area is indistinguishable from a
// route that doesn't exist. Swapping to a DB-backed check later is a one-function change.
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

/** Parse ADMIN_EMAILS into a normalized set. Unset/empty ⇒ empty set ⇒ everyone denied. */
export function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? ''
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return getAdminEmails().has(email.trim().toLowerCase())
}

/**
 * Returns the signed-in admin's identity, or calls notFound() (404). Server components and
 * server-side admin code only. Reads the canonical email from the DB rather than trusting
 * the JWT claim.
 */
export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user || !isAdminEmail(user.email)) notFound()

  return { userId, email: user.email }
}
