// app/profile/seen/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'
import MovieListClient from '@/components/MovieListClient'

export default async function SeenPage() {
  await requireUserId()
  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <Link href="/profile" className="text-sm text-gray-400 hover:text-gray-200">← Profile</Link>
        <h1 className="text-3xl font-bold">Seen Before</h1>
        <MovieListClient type="seen" />
      </div>
    </main>
  )
}
