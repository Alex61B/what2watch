// app/api/users/search/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { searchUsers } from '@/lib/friends'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q') ?? ''
  const users = await searchUsers(q, session.user.id)
  return NextResponse.json({ users })
}
