// app/profile/friends/[friendId]/sessions/[roomId]/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import SharedSessionClient from '@/components/SharedSessionClient'

export default async function SharedSessionPage({
  params,
}: {
  params: Promise<{ friendId: string; roomId: string }>
}) {
  await requireUserId()
  const { friendId, roomId } = await params
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Link href={`/profile/friends/${friendId}`} className="text-sm text-gray-400 hover:text-gray-200">← Friend</Link>
        <h1 className="text-3xl font-bold">Shared Yes</h1>
        <SharedSessionClient friendId={friendId} roomId={roomId} />
      </div>
    </main>
  )
}
