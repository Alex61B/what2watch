import Link from 'next/link'

interface ProfileHeaderProps {
  /** Page title rendered below the nav row. Omit when the page's client renders its own title. */
  title?: string
  /** Optional "back" link target (e.g. "/profile"). When omitted, only the Home link shows. */
  backHref?: string
  /** Label for the back link (e.g. "← Profile"). */
  backLabel?: string
}

/**
 * Shared header for the profile area: an optional back link on the left and a
 * Home link on the right, with an optional page title underneath. Gives every
 * profile screen an easy way out to the landing page.
 */
export default function ProfileHeader({ title, backHref, backLabel }: ProfileHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {backHref ? (
          <Link href={backHref} className="text-sm text-gray-400 hover:text-gray-200">
            {backLabel ?? '← Back'}
          </Link>
        ) : (
          <span />
        )}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 transition-colors"
        >
          <span aria-hidden>🏠</span> Home
        </Link>
      </div>
      {title && <h1 className="text-3xl font-bold">{title}</h1>}
    </div>
  )
}
