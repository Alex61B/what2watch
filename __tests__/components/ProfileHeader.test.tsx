import type { AnchorHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'
import ProfileHeader from '@/components/ProfileHeader'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

describe('ProfileHeader', () => {
  it('always renders a Home link to /', () => {
    render(<ProfileHeader title="Your Profile" />)
    const home = screen.getByRole('link', { name: /home/i })
    expect(home).toHaveAttribute('href', '/')
  })

  it('renders the title when provided', () => {
    render(<ProfileHeader title="Watch List" />)
    expect(screen.getByRole('heading', { name: 'Watch List' })).toBeInTheDocument()
  })

  it('omits the title heading when not provided', () => {
    render(<ProfileHeader />)
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('renders an optional back link', () => {
    render(<ProfileHeader title="Settings" backHref="/profile" backLabel="← Profile" />)
    const back = screen.getByRole('link', { name: '← Profile' })
    expect(back).toHaveAttribute('href', '/profile')
  })

  it('renders no back link when backHref is absent', () => {
    render(<ProfileHeader title="Your Profile" />)
    // Only the Home link should be present.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
