// app/profile/friends/[friendId]/page.tsx
import { requireUserId } from '@/components/ProfileGuard'
import FriendDetailClient from '@/components/FriendDetailClient'
import ProfileHeader from '@/components/ProfileHeader'

export default async function FriendDetailPage({
  params,
}: {
  params: Promise<{ friendId: string }>
}) {
  await requireUserId()
  const { friendId } = await params
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <ProfileHeader backHref="/profile/friends" backLabel="← Friends" />
        <FriendDetailClient friendId={friendId} />
      </div>
    </main>
  )
}
