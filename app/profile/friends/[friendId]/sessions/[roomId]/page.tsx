// app/profile/friends/[friendId]/sessions/[roomId]/page.tsx
import { requireUserId } from '@/components/ProfileGuard'
import SharedSessionClient from '@/components/SharedSessionClient'
import ProfileHeader from '@/components/ProfileHeader'

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ friendId: string; roomId: string }>
}) {
  await requireUserId()
  const { friendId, roomId } = await params
  return (
    <main className="min-h-screen bg-canvas text-ink px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <ProfileHeader title="Shared Yes" backHref={`/profile/friends/${friendId}`} backLabel="← Friend" />
        <SharedSessionClient friendId={friendId} roomId={roomId} />
      </div>
    </main>
  )
}
