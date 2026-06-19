// lib/login-event.ts
// Best-effort login tracking. Called from NextAuth's `events.signIn` hook (auth.ts) on a
// successful sign-in; writes a single `login` Event so the admin dashboard can show "most
// recent activity" and active status. Server-emitted, so anonId is 'server'. A write
// failure is swallowed — login tracking must NEVER block or break sign-in.
import { prisma } from '@/lib/prisma'

interface SignInLike {
  user?: { id?: string | null } | null
  account?: { provider?: string | null } | null
}

export async function recordLoginEvent({ user, account }: SignInLike): Promise<void> {
  const userId = user?.id
  if (!userId) return
  try {
    await prisma.event.create({
      data: {
        type: 'login',
        anonId: 'server',
        userId,
        props: { provider: account?.provider ?? null },
      },
    })
  } catch {
    // best-effort telemetry; never surface to the sign-in flow
  }
}
