import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { savedServices: true, savedFilters: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    savedServices: user.savedServices,
    savedFilters: user.savedFilters,
  })
}

export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const data: { displayName?: string; savedServices?: string[] } = {}

  if (typeof body?.displayName === 'string') {
    const name = body.displayName.trim()
    if (name.length === 0 || name.length > 255) {
      return NextResponse.json({ error: 'Display name must be 1–255 characters' }, { status: 400 })
    }
    data.displayName = name
  }
  if (Array.isArray(body?.savedServices) && body.savedServices.every((s: unknown) => typeof s === 'string')) {
    data.savedServices = body.savedServices
  }

  await prisma.user.update({ where: { id: session.user.id }, data })
  return NextResponse.json({ ok: true })
}
