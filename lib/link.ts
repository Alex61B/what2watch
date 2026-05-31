// lib/link.ts
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

/**
 * Resolves the NextAuth user id for a room member, linking the member to the
 * signed-in user on the fly if it is not yet linked. Returns null for anonymous
 * (not-signed-in) members so callers can skip user-scoped side effects.
 */
export async function resolveMemberUserId(
  member: { id: string; userId: string | null }
): Promise<string | null> {
  if (member.userId) return member.userId
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null
  await prisma.member.update({ where: { id: member.id }, data: { userId } })
  return userId
}
