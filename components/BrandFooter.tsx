import Link from 'next/link'
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand'

interface BrandFooterProps {
  className?: string
}

/**
 * The editorial sign-off plus the legal links (Privacy / Terms). Rendered (uppercased via CSS)
 * on the landing, final-result, and legal screens. The legal links also satisfy the requirement
 * that the privacy policy be linked from the homepage.
 */
export default function BrandFooter({ className = '' }: BrandFooterProps) {
  return (
    <footer className={`text-center space-y-2 ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
        © 2026 {BRAND_NAME} · {BRAND_TAGLINE}
      </p>
      <nav className="flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.18em] text-faint">
        <Link href="/privacy" className="hover:text-ink transition-colors">
          Privacy
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/terms" className="hover:text-ink transition-colors">
          Terms
        </Link>
      </nav>
    </footer>
  )
}
