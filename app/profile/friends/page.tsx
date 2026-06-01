// app/profile/friends/page.tsx
import { requireUserId } from '@/components/ProfileGuard'
import FriendsClient from '@/components/FriendsClient'
import ProfileHeader from '@/components/ProfileHeader'

export default async function FriendsPage() {
  await requireUserId()
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <ProfileHeader title="Friends" backHref="/profile" backLabel="← Profile" />
        <FriendsClient />
      </div>
    </main>
  )
}
