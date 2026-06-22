// app/privacy/page.tsx
// Privacy Policy (WP6 / audit C1). Static server component — no data fetching, so it renders in
// jsdom for tests. Identity/contact come from lib/legal (single source); brand from lib/brand.
import type { Metadata } from 'next'
import Link from 'next/link'
import BrandFooter from '@/components/BrandFooter'
import { BRAND_NAME } from '@/lib/brand'
import { DATA_CONTROLLER, PRIVACY_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from '@/lib/legal'

export const metadata: Metadata = {
  title: `Privacy Policy · ${BRAND_NAME}`,
  description: `How ${BRAND_NAME} collects, uses, and protects your personal data.`,
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-canvas text-ink px-4 py-12">
      <article className="w-full max-w-3xl mx-auto space-y-8">
        <header className="space-y-2">
          <Link href="/" className="text-sm text-muted hover:text-ink transition-colors">
            ← Home
          </Link>
          <h1 className="font-serif text-3xl">Privacy Policy</h1>
          <p className="text-sm text-muted">Last updated: {LEGAL_LAST_UPDATED}</p>
        </header>

        <section className="space-y-3">
          <p className="text-muted">
            This Privacy Policy explains how {BRAND_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;)
            collects, uses, and protects your personal data. The data controller is{' '}
            <strong className="text-ink">{DATA_CONTROLLER}</strong>. If you have any questions or
            wish to exercise your rights, contact us at{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">1. Data we collect</h2>
          <ul className="list-disc pl-5 space-y-2 text-muted">
            <li>
              <strong className="text-ink">Account data:</strong> your email address and display
              name. If you sign up with a password, we store only a salted bcrypt hash — never the
              password itself.
            </li>
            <li>
              <strong className="text-ink">Google sign-in:</strong> if you choose &ldquo;Continue
              with Google&rdquo;, we receive your basic Google profile (name, email, profile image)
              and store the OAuth tokens needed to keep you signed in. We request only the basic
              <em> openid</em>, <em>email</em>, and <em>profile</em> scopes.
            </li>
            <li>
              <strong className="text-ink">Activity data:</strong> the display name you use in a
              room, your swipes/votes, your watch list and &ldquo;seen before&rdquo; list, and your
              friends.
            </li>
            <li>
              <strong className="text-ink">First-party analytics:</strong> pseudonymous usage events
              (for example page views and feature use) tied to a random analytics ID stored in your
              browser. <strong className="text-ink">We do not store your IP address</strong> and do
              not log your user-agent for analytics. See &ldquo;Cookies&rdquo; below for how to opt
              out.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">2. How and why we use your data</h2>
          <p className="text-muted">
            We use your data to provide the service (creating rooms, matching movies, syncing your
            lists and friends), to keep your account secure, and to understand and improve how the
            app is used. Our legal bases under the GDPR are: <em>performance of a contract</em> (to
            run the service you signed up for), <em>legitimate interests</em> (security and
            privacy-friendly product analytics), and <em>consent</em> where it applies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">3. Cookies &amp; local storage</h2>
          <p className="text-muted">
            We use strictly necessary cookies only — a signed session cookie to keep you logged in
            and a per-room cookie to track your membership. We also keep a theme preference and a
            pseudonymous analytics ID in your browser&rsquo;s local storage. We do not use any
            third-party advertising or cross-site tracking cookies.
          </p>
          <p className="text-muted">
            <strong className="text-ink">Analytics opt-out:</strong> you can turn off first-party
            analytics for your device at any time from{' '}
            <Link href="/profile/settings" className="text-indigo-400 hover:text-indigo-300">
              Settings
            </Link>
            . The preference is stored on your device and persists across reloads.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">4. Who we share data with (sub-processors)</h2>
          <ul className="list-disc pl-5 space-y-2 text-muted">
            <li><strong className="text-ink">Supabase</strong> — our hosted PostgreSQL database (stores all of the above).</li>
            <li><strong className="text-ink">Vercel</strong> — application hosting and scheduled jobs.</li>
            <li><strong className="text-ink">Google</strong> — only if you use Google sign-in.</li>
            <li>
              <strong className="text-ink">The Movie Database (TMDB)</strong> — we fetch movie data
              from TMDB; we do not send TMDB any of your personal data. This product uses the TMDB
              API but is not endorsed or certified by TMDB.
            </li>
          </ul>
          <p className="text-muted">We do not sell or rent your personal data to anyone.</p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">5. How long we keep it (retention)</h2>
          <ul className="list-disc pl-5 space-y-2 text-muted">
            <li>Account, list, and friend data: until you delete your account.</li>
            <li>Rooms and their votes: rooms expire automatically and are deleted within roughly 24 hours of expiry.</li>
            <li>Analytics events: automatically deleted after <strong className="text-ink">90 days</strong>.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">6. Your rights</h2>
          <p className="text-muted">
            If you are in the European Economic Area or the UK, you have the right under the{' '}
            <strong className="text-ink">GDPR</strong> to access, rectify, erase, restrict, or object
            to the processing of your data, to data portability, to withdraw consent, and to lodge a
            complaint with your data-protection supervisory authority.
          </p>
          <p className="text-muted">
            If you are a California resident, the <strong className="text-ink">CCPA/CPRA</strong>{' '}
            gives you the right to know, delete, and correct your personal information, the right to
            opt out of the sale or sharing of personal information (we do not sell or share it), and
            the right not to be discriminated against for exercising these rights.
          </p>
          <p className="text-muted">
            <strong className="text-ink">To delete your account and data</strong>, use the
            self-serve deletion in{' '}
            <Link href="/profile/settings" className="text-indigo-400 hover:text-indigo-300">
              Settings
            </Link>
            , or email{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
              {PRIVACY_CONTACT_EMAIL}
            </a>
            . When you delete your account we remove your account, lists, friends, votes, and room
            memberships, and we de-identify any retained analytics events.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">7. Children</h2>
          <p className="text-muted">
            {BRAND_NAME} is not directed to children under 13, and we do not knowingly collect data
            from them. You must be at least 13 years old to use the service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">8. International transfers &amp; security</h2>
          <p className="text-muted">
            Our infrastructure providers may process and store data in the United States. We protect
            your data with industry-standard measures, including bcrypt password hashing and
            HTTP-only, same-site session cookies served over HTTPS.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl">9. Changes &amp; contact</h2>
          <p className="text-muted">
            We may update this policy from time to time; we will revise the &ldquo;Last updated&rdquo;
            date above. Questions or requests:{' '}
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
