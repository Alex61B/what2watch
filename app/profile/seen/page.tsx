// app/profile/seen/page.tsx
import { requireUserId } from '@/components/ProfileGuard'
import MovieListClient from '@/components/MovieListClient'
import ProfileHeader from '@/components/ProfileHeader'

export default async function SeenPage() {
  await requireUserId()
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <ProfileHeader title="Seen Before" backHref="/profile" backLabel="← Profile" />
        <MovieListClient type="seen" />
      </div>
    </main>
  )
}
