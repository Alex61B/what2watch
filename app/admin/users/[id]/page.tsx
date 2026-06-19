// app/admin/users/[id]/page.tsx — Single user: safe profile fields + event history.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/admin'
import { getUserDetail, listUserEvents } from '@/lib/admin-queries'
import Pagination from '@/components/admin/Pagination'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)

  const detail = await getUserDetail(id)
  if (!detail) notFound()
  const { user, eventsByType, totalEvents } = detail
  const { events, total, pageSize } = await listUserEvents(id, page)

  return (
    <div className="space-y-4">
      <Link className="text-sm underline" href="/admin/users">
        ← Users
      </Link>
      <h1 className="text-xl font-semibold">{user.displayName}</h1>

      <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 max-w-md">
        <dt className="opacity-60">Email</dt>
        <dd>{user.email}</dd>
        <dt className="opacity-60">Name</dt>
        <dd>{user.name ?? '—'}</dd>
        <dt className="opacity-60">Joined</dt>
        <dd>{user.createdAt.toISOString().slice(0, 10)}</dd>
        <dt className="opacity-60">Total events</dt>
        <dd>{totalEvents}</dd>
      </dl>

      <section>
        <h2 className="text-sm font-semibold mb-1">Events by type</h2>
        <ul className="text-sm">
          {eventsByType.map((e) => (
            <li key={e.type}>
              {e.type}: {e.count}
            </li>
          ))}
          {eventsByType.length === 0 ? <li className="opacity-60">None.</li> : null}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-1">Recent events</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-black/10">
              <th className="py-1 font-medium">When</th>
              <th className="py-1 font-medium">Type</th>
              <th className="py-1 font-medium">Room</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-black/5">
                <td className="py-1">{e.ts.toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="py-1">{e.type}</td>
                <td className="py-1">{e.roomId ?? '—'}</td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td className="py-2 opacity-60" colSpan={3}>
                  No events.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <Pagination page={page} total={total} pageSize={pageSize} basePath={`/admin/users/${id}`} />
      </section>
    </div>
  )
}
