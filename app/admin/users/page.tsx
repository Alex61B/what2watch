// app/admin/users/page.tsx — Users list. requireAdmin() first; newest-account-first.
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { listUsers } from '@/lib/admin-queries'
import Pagination from '@/components/admin/Pagination'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const q = sp.q?.trim() || undefined
  const { rows, total, pageSize } = await listUsers({ page, q })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Users</h1>

      <form className="text-sm" action="/admin/users" method="get">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search email or name"
          className="border rounded px-2 py-1"
        />
      </form>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-black/10">
            <th className="py-1 font-medium">Email</th>
            <th className="py-1 font-medium">Display name</th>
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 font-medium">Joined</th>
            <th className="py-1 font-medium">Last active</th>
            <th className="py-1 font-medium">Events</th>
            <th className="py-1 font-medium">Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-b border-black/5">
              <td className="py-1">
                <Link className="underline" href={`/admin/users/${u.id}`}>
                  {u.email}
                </Link>
              </td>
              <td className="py-1">{u.displayName}</td>
              <td className="py-1">{u.name ?? '—'}</td>
              <td className="py-1">{u.createdAt.toISOString().slice(0, 10)}</td>
              <td className="py-1">{u.lastActivity ? u.lastActivity.toISOString().slice(0, 10) : '—'}</td>
              <td className="py-1">{u.totalEvents}</td>
              <td className="py-1">{u.isActive ? 'active' : '—'}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="py-2 opacity-60" colSpan={7}>
                No users.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <Pagination page={page} total={total} pageSize={pageSize} basePath="/admin/users" query={{ q }} />
    </div>
  )
}
