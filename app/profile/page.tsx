// app/profile/page.tsx
import Link from 'next/link'
import { requireUserId } from '@/components/ProfileGuard'

export default async function ProfilePage() {
  await requireUserId()

  const links = [
    { href: '/profile/settings', label: 'Settings / Profile Info' },
    { href: '/profile/friends', label: 'Friends' },
    { href: '/profile/watchlist', label: 'Watch List' },
    { href: '/profile/seen', label: 'Seen Before' },
  ]

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-md mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Your Profile</h1>
        <nav className="space-y-3">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-xl bg-gray-900 hover:bg-gray-800 px-5 py-4 font-medium transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  )
}
