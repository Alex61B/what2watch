interface BrandMarkProps {
  /** Display size of the wordmark. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** `ink` = on light surfaces; `inverse` = on the dark result hero. */
  tone?: 'ink' | 'inverse'
  className?: string
}

const SIZES: Record<NonNullable<BrandMarkProps['size']>, string> = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-3xl',
}

/**
 * The PikFlix wordmark: serif "Pik" in ink (or white on the dark hero) with a
 * red "Flix". Used in every top bar and the landing hero.
 */
export default function BrandMark({ size = 'md', tone = 'ink', className = '' }: BrandMarkProps) {
  const base = tone === 'inverse' ? 'text-white' : 'text-ink'
  return (
    <span className={`font-serif font-bold tracking-tight ${SIZES[size]} ${base} ${className}`}>
      Pik<span className="text-accent">Flix</span>
    </span>
  )
}
