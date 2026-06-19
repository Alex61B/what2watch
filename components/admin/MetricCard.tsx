// components/admin/MetricCard.tsx
// Presentational metric tile for the admin overview. No data access.
export default function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15 p-4">
      <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs opacity-50">{hint}</div> : null}
    </div>
  )
}
