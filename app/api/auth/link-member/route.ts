import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { getAllSessionTokens } from '@/lib/session'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Sessions are now per-room, so a browser may hold memberships in several
  // rooms at once. Link every unlinked one to the signed-in user.
  const sessionTokens = await getAllSessionTokens()
  if (sessionTokens.length === 0) {
    // No room session active — nothing to link, that's fine
    return NextResponse.json({ linked: false })
  }

  const result = await prisma.member.updateMany({
    where: { sessionToken: { in: sessionTokens }, userId: null },
    data: { userId: session.user.id },
  })

  return NextResponse.json({ linked: result.count > 0 })
}
