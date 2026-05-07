import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { getSessionToken } from '@/lib/session'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const sessionToken = await getSessionToken()
  if (!sessionToken) {
    // No room session active — nothing to link, that's fine
    return NextResponse.json({ linked: false })
  }

  const member = await prisma.member.findUnique({ where: { sessionToken } })
  if (!member) {
    return NextResponse.json({ linked: false })
  }

  // Link the member to the user account
  await prisma.member.update({
    where: { id: member.id },
    data: { userId: session.user.id },
  })

  return NextResponse.json({ linked: true })
}
