// app/admin/page.tsx — Overview. requireAdmin() first, then read-only aggregates.
import { requireAdmin } from '@/lib/admin'
import { getOverviewMetrics, getActiveUsersByDay } from '@/lib/admin-queries'
import MetricCard from '@/components/admin/MetricCard'

export const dynamic = 'force-dynamic'

export default async function AdminOverviewPage() {
  await requireAdmin()
  const [m, byDay] = await Promise.all([getOverviewMetrics(), getActiveUsersByDay()])

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total users" value={m.totalUsers} />
        <MetricCard label="New (7d)" value={m.newUsers7d} />
        <MetricCard label="New (30d)" value={m.newUsers30d} />
        <MetricCard label="Total events" value={m.totalEvents} />
        <MetricCard label="DAU" value={m.dau} hint="distinct users, 24h" />
        <MetricCard label="WAU" value={m.wau} hint="distinct users, 7d" />
        <MetricCard label="Logged-in events (7d)" value={m.loggedInEvents7d} />
        <MetricCard label="Anonymous events (7d)" value={m.anonEvents7d} />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Activation funnel (7d)</h2>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Rooms created" value={m.funnel7d.room_created} />
          <MetricCard label="Rooms started" value={m.funnel7d.room_started} />
          <MetricCard label="Rooms matched" value={m.funnel7d.room_matched} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Active users by day</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-black/10">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">Active users</th>
              <th className="py-1 font-medium">Events</th>
            </tr>
          </thead>
          <tbody>
            {byDay.map((d) => (
              <tr key={d.day.toISOString()} className="border-b border-black/5">
                <td className="py-1">{d.day.toISOString().slice(0, 10)}</td>
                <td className="py-1">{d.activeUsers}</td>
                <td className="py-1">{d.events}</td>
              </tr>
            ))}
            {byDay.length === 0 ? (
              <tr>
                <td className="py-2 opacity-60" colSpan={3}>
                  No activity yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  )
}
