// app/api/account/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/rate-limit-db'
import { logServerError, serverError } from '@/lib/api-error'

/**
 * DELETE /api/account — self-serve account deletion / right to erasure (audit M9).
 *
 * Acts ONLY on the authenticated session user (never an id from the request body) so it cannot
 * become an account-deletion IDOR. A single transaction, ordered so no PII is left behind:
 *   1. scrub `Event.userId` → null — analytics rows are KEPT but de-identified (Event has no FK
 *      to User, so a plain delete/cascade would otherwise leave the user link for up to 90 days).
 *   2. delete the user's `Member` rows — these carry the per-room `displayName` and cascade
 *      Vote / WatchedMovie / MemberQueue. MUST precede the user delete, else `Member.userId`'s
 *      default `SetNull` would orphan them (verified 2026-06-21).
 *   3. delete the `User` — cascades `Account` (Google OAuth tokens), `Friendship` (both sides),
 *      `UserMoviePreference`. `deleteMany` (not `delete`) so a re-delete / already-gone account is
 *      idempotent (never throws P2025).
 *
 * Deleting a user who hosts or solely occupies an active room is safe: the room simply becomes
 * inert (host-only actions 403) and the cron cleanup removes it by `expiresAt` (≤48h). The client
 * signs out after a 200.
 */
export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  // Fail-OPEN throttle (see lib/rate-limit-db RATE_LIMITS.accountDelete): a limiter-store outage
  // must not block a legitimate erasure; the cap only curbs accidental rapid re-submits.
  const rl = await checkRateLimit('account-delete', userId, RATE_LIMITS.accountDelete)
  if (!rl.ok) return tooManyRequests(rl.retryAfterSeconds)

  try {
    await prisma.$transaction([
      prisma.event.updateMany({ where: { userId }, data: { userId: null } }),
      prisma.member.deleteMany({ where: { userId } }),
      prisma.user.deleteMany({ where: { id: userId } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (err) {
    logServerError('[account-delete]', { userId }, err)
    return serverError(500)
  }
}
