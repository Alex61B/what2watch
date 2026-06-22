// app/terms/page.tsx
// Terms of Service (WP6 / audit C1). Static server component — no data fetching, so it renders in
// jsdom for tests. Governing law / contact from lib/legal (single source); brand from lib/brand.
import type { Metadata } from 'next'
import Link from 'next/link'
import BrandFooter from '@/components/BrandFooter'
import { BRAND_NAME } from '@/lib/brand'
import { GOVERNING_LAW, PRIVACY_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from '@/lib/legal'

export const metadata: Metadata = {
  title: `Terms of Service · ${BRAND_NAME}`,
  description: `The terms that govern your use of ${BRAND_NAME}.`,
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-canvas text-ink px-4 py-12">
      <article className="w-full max-w-3xl mx-auto space-y-8">
        <header className="space-y-2">
          <Link href="/" className="text-sm text-muted hover:text-ink transition-colors">
            ← Home
          </Link>
          <h1 className="font-serif text-3xl">Terms of Service</h1>
          <p className="text-sm text-muted">Last updated: {LEGAL_LAST_UPDATED}</p>
        </header>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">1. Acceptance</h2>
          <p className="text-muted">
            By creating an account or otherwise using {BRAND_NAME} (the &ldquo;Service&rdquo;), you
            agree to these Terms of Service and to our{' '}
            <Link href="/privacy" className="text-indigo-400 hover:text-indigo-300">Privacy Policy</Link>.
            If you do not agree, do not use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">2. The Service</h2>
          <p className="text-muted">
            {BRAND_NAME} helps groups decide what to watch together by creating shared rooms, voting
            on titles, and surfacing matches. The Service is provided for personal, non-commercial
            use.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">3. Eligibility</h2>
          <p className="text-muted">
            You must be at least <strong className="text-ink">13 years old</strong> to use the
            Service. By using {BRAND_NAME} you represent that you meet this requirement.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">4. Your account</h2>
          <p className="text-muted">
            You are responsible for keeping your account credentials secure and for activity that
            happens under your account. Provide accurate information and keep it up to date.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">5. Acceptable use</h2>
          <p className="text-muted">
            Do not misuse the Service: no unlawful, abusive, or infringing activity; no attempts to
            disrupt, probe, or overload the Service or to access data that isn&rsquo;t yours.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">6. Your content</h2>
          <p className="text-muted">
            You retain ownership of the choices and content you contribute (such as votes and lists).
            You grant us a limited license to process that content solely to operate the Service for
            you and the people you share rooms with.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">7. Third-party services</h2>
          <p className="text-muted">
            Movie data is provided by The Movie Database (TMDB). This product uses the TMDB API but
            is not endorsed or certified by TMDB. Links to streaming services are provided for
            convenience; {BRAND_NAME} is not affiliated with, and does not endorse, any streaming
            provider, and we do not control their content or availability.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">8. Disclaimers &amp; limitation of liability</h2>
          <p className="text-muted">
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
            warranties of any kind. To the maximum extent permitted by law, {BRAND_NAME} and its
            operator are not liable for any indirect, incidental, or consequential damages arising
            from your use of the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">9. Termination &amp; account deletion</h2>
          <p className="text-muted">
            You may stop using the Service at any time and may{' '}
            <strong className="text-ink">delete your account</strong> — and the personal data
            associated with it — from{' '}
            <Link href="/profile/settings" className="text-indigo-400 hover:text-indigo-300">
              Settings
            </Link>
            , or by emailing{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            . We may suspend or terminate access that violates these Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">10. Governing law</h2>
          <p className="text-muted">
            These Terms are governed by the laws of the{' '}
            <strong className="text-ink">{GOVERNING_LAW}</strong>, without regard to its conflict-of-
            laws rules. Any disputes will be subject to the exclusive jurisdiction of the state and
            federal courts located in Florida.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">11. Changes &amp; contact</h2>
          <p className="text-muted">
            We may update these Terms from time to time; continued use after an update means you
            accept the revised Terms. Questions:{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <div className="pt-6">
          <BrandFooter />
        </div>
      </article>
    </main>
  )
}
