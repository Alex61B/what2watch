/**
 * Brief full-screen interstitial shown the moment a match is found, before the
 * final result page. Intentionally minimal and on-brand.
 */
export default function MatchCelebration() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center text-ink">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-faint">
        The votes agree
      </p>
      <h1 className="mt-3 font-serif text-6xl font-bold leading-none sm:text-7xl">
        It&apos;s a <span className="italic text-accent">match.</span>
      </h1>
      <p className="mt-5 text-sm text-muted">Cueing up tonight&apos;s pick…</p>
    </main>
  )
}
