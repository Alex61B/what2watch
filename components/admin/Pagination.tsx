// components/admin/Pagination.tsx
// Server-rendered pager. Builds Prev/Next links that preserve existing query params, so the
// admin pages need no client JS to paginate or filter.
import Link from 'next/link'

export default function Pagination({
  page,
  total,
  pageSize,
  basePath,
  query,
}: {
  page: number
  total: number
  pageSize: number
  basePath: string
  query?: Record<string, string | undefined>
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const href = (p: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v)
    params.set('page', String(p))
    return `${basePath}?${params.toString()}`
  }
  return (
    <nav className="flex items-center justify-between mt-4 text-sm">
      <span className="opacity-60">
        Page {page} of {lastPage} · {total} total
      </span>
      <span className="flex gap-3">
        {page > 1 ? (
          <Link className="underline" href={href(page - 1)}>
            ← Prev
          </Link>
        ) : (
          <span className="opacity-30">← Prev</span>
        )}
        {page < lastPage ? (
          <Link className="underline" href={href(page + 1)}>
            Next →
          </Link>
        ) : (
          <span className="opacity-30">Next →</span>
        )}
      </span>
    </nav>
  )
}
