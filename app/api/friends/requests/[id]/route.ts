// app/api/friends/requests/[id]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { respondToRequest, FriendError } from '@/lib/friends'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (body?.action !== 'accept' && body?.action !== 'decline') {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 })
  }

  try {
    await respondToRequest(session.user.id, id, body.action === 'accept')
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof FriendError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 409
      return NextResponse.json({ error: err.code }, { status })
    }
    throw err
  }
}
