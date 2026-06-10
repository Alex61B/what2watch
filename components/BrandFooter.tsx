interface BrandFooterProps {
  className?: string
}

/**
 * The editorial sign-off: "© 2026 PIKFLIX · WHERE DECISIONS GET MADE".
 * Rendered (uppercased via CSS) on the landing and final-result screens.
 */
export default function BrandFooter({ className = '' }: BrandFooterProps) {
  return (
    <p
      className={`text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-faint ${className}`}
    >
      © 2026 PikFlix · Where decisions get made
    </p>
  )
}
