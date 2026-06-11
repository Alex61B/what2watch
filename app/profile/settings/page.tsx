// app/profile/settings/page.tsx
import { requireUserId } from '@/components/ProfileGuard'
import { prisma } from '@/lib/prisma'
import SettingsClient from '@/components/SettingsClient'
import ProfileHeader from '@/components/ProfileHeader'
import { redirect } from 'next/navigation'

export default async function SettingsPage() {
  const userId = await requireUserId()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true },
  })
  // A valid JWT can outlive its user row (deleted account / dev DB reset) — send the
  // dead session back to sign-in instead of rendering blank settings.
  if (!user) redirect('/auth/signin')

  return (
    <main className="min-h-screen bg-canvas text-ink px-4 py-12">
      <div className="w-full max-w-md mx-auto space-y-6">
        <ProfileHeader title="Settings" backHref="/profile" backLabel="← Profile" />
        <SettingsClient email={user.email} initialName={user.displayName} />
      </div>
    </main>
  )
}
