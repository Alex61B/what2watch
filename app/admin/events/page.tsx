// app/admin/events/page.tsx — Global events feed. requireAdmin() first; type + identity filters.
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { listEvents } from '@/lib/admin-queries'
import Pagination from '@/components/admin/Pagination'

export const dynamic = 'force-dynamic'

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string; identity?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const type = sp.type?.trim() || undefined
  const identity = sp.identity === 'loggedin' || sp.identity === 'anon' ? sp.identity : undefined
  const { rows, total, pageSize } = await listEvents({ page, type, identity })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Events</h1>

      <form className="text-sm flex gap-2" action="/admin/events" method="get">
        <input name="type" defaultValue={type ?? ''} placeholder="type" className="border rounded px-2 py-1" />
        <select name="identity" defaultValue={identity ?? ''} className="border rounded px-2 py-1">
          <option value="">all</option>
          <option value="loggedin">logged-in</option>
          <option value="anon">anonymous</option>
        </select>
        <button type="submit" className="border rounded px-2 py-1">
          Filter
        </button>
      </form>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-black/10">
            <th className="py-1 font-medium">When</th>
            <th className="py-1 font-medium">Type</th>
            <th className="py-1 font-medium">User</th>
            <th className="py-1 font-medium">Room</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-black/5">
              <td className="py-1">{e.ts.toISOString().slice(0, 16).replace('T', ' ')}</td>
              <td className="py-1">{e.type}</td>
              <td className="py-1">
                {e.user ? (
                  <Link className="underline" href={`/admin/users/${e.user.id}`}>
                    {e.user.email}
                  </Link>
                ) : (
                  <span className="opacity-50">anon</span>
                )}
              </td>
              <td className="py-1">{e.roomId ?? '—'}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="py-2 opacity-60" colSpan={4}>
                No events.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <Pagination
        page={page}
        total={total}
        pageSize={pageSize}
        basePath="/admin/events"
        query={{ type, identity }}
      />
    </div>
  )
}
