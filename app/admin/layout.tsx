// app/admin/layout.tsx
// Admin shell + defense-in-depth guard. requireAdmin() runs here for the whole /admin
// subtree; each page also calls it (the real protection — layouts can be bypassed by
// direct segment requests). No admin link is rendered anywhere in the product UI.
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <div className="min-h-screen bg-canvas text-ink px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center gap-4 border-b border-black/10 pb-3">
          <span className="font-semibold">Admin</span>
          <nav className="flex gap-4 text-sm">
            <Link className="underline" href="/admin">
              Overview
            </Link>
            <Link className="underline" href="/admin/users">
              Users
            </Link>
            <Link className="underline" href="/admin/events">
              Events
            </Link>
          </nav>
        </header>
        {children}
      </div>
    </div>
  )
}
