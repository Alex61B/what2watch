/**
 * WP6 / audit C1 — the legal surface. Asserts the privacy & terms pages render their required
 * sections, the footer links to them, and both auth pages show the consent line. next/link is
 * stubbed to a plain anchor (mirrors ProfileHeader.test.tsx); the client auth pages get their
 * next/navigation + next-auth/react hooks stubbed so they render in jsdom.
 */
import type { AnchorHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('next-auth/react', () => ({
  signIn: jest.fn(),
  useSession: () => ({ status: 'unauthenticated' }),
}))

import PrivacyPage from '@/app/privacy/page'
import TermsPage from '@/app/terms/page'
import BrandFooter from '@/components/BrandFooter'
import SignUpPage from '@/app/auth/signup/page'
import SignInPage from '@/app/auth/signin/page'

const present = (re: RegExp) => expect(screen.getAllByText(re).length).toBeGreaterThan(0)

describe('Privacy Policy page', () => {
  beforeEach(() => render(<PrivacyPage />))

  it('names the data controller (Alexander Smith)', () => present(/Alexander Smith/))
  it('discloses the analytics opt-out', () => present(/Analytics opt-out/i))
  it('states the 90-day analytics retention', () => present(/90 days/))
  it('covers GDPR and CCPA rights', () => {
    present(/GDPR/)
    present(/CCPA/)
  })
  it('shows the centralized contact placeholder', () => present(/\[PRIVACY_CONTACT_EMAIL\]/))
})

describe('Terms of Service page', () => {
  beforeEach(() => render(<TermsPage />))

  it('sets Florida governing law', () => present(/Florida/))
  it('states a 13+ minimum age', () => present(/13 years old/))
  it('describes account deletion / termination', () => present(/delete your account/i))
})

describe('BrandFooter legal links', () => {
  it('links to /privacy and /terms', () => {
    render(<BrandFooter />)
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms')
  })
})

describe('signup consent', () => {
  it('shows consent text linking Terms and Privacy', () => {
    render(<SignUpPage />)
    present(/agree to our/i)
    expect(screen.getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: /^privacy policy$/i })).toHaveAttribute('href', '/privacy')
  })
})

describe('signin consent', () => {
  it('shows consent text linking Terms and Privacy', () => {
    render(<SignInPage />)
    present(/agree to our/i)
    expect(screen.getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: /^privacy policy$/i })).toHaveAttribute('href', '/privacy')
  })
})
