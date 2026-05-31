// app/profile/settings/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import { prisma } from '@/lib/prisma'
import SettingsClient from '@/components/SettingsClient'

export default async function SettingsPage() {
  const userId = await requireUserId()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true },
  })

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-md mx-auto space-y-6">
        <Link href="/profile" className="text-sm text-gray-400 hover:text-gray-200">← Profile</Link>
        <h1 className="text-3xl font-bold">Settings</h1>
        <SettingsClient email={user?.email ?? ''} initialName={user?.displayName ?? ''} />
      </div>
    </main>
  )
}
