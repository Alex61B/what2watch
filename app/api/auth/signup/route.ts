import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const { email, displayName, password } = await request.json()

  if (!email || !displayName || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const trimmedEmail = (email as string).trim().toLowerCase()
  const trimmedName = (displayName as string).trim()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }
  if (trimmedName.length === 0 || trimmedName.length > 255) {
    return NextResponse.json({ error: 'Display name must be 1–255 characters' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } })
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.user.create({
    data: { email: trimmedEmail, displayName: trimmedName, passwordHash },
  })

  return NextResponse.json({ success: true }, { status: 201 })
}
