import type { ImgHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import MatchResult from '@/components/MatchResult'

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ fill, priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => <img {...props} />,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))

const members = [
  { id: 'u1', displayName: 'Jordan', isHost: true },
  { id: 'u2', displayName: 'Priya', isHost: false },
  { id: 'u3', displayName: 'Marcus', isHost: false },
  { id: 'u4', displayName: 'Sofia', isHost: false },
]

const baseMovie = {
  title: 'Parasite',
  posterUrl: 'https://example.com/parasite.jpg',
  year: 2019,
  rating: 8.5,
  runtime: 132,
  overview: 'A poor family schemes to become employed by a wealthy household.',
  genreIds: [53, 18], // Thriller, Drama
  watchUrl: 'https://www.themoviedb.org/movie/496243',
  streamingService: 'netflix',
}

describe('MatchResult', () => {
  it('renders the movie title and the result heading', () => {
    render(<MatchResult code="PFLX-42" movie={baseMovie} members={members} />)
    expect(screen.getByText('Parasite')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /tonight's/i })).toBeInTheDocument()
  })

  it('shows the full matched count and the room roster', () => {
    render(<MatchResult code="PFLX-42" movie={baseMovie} members={members} />)
    expect(screen.getByText(/4\/4 matched/i)).toBeInTheDocument()
    expect(screen.getByText('Jordan')).toBeInTheDocument()
    expect(screen.getByText('Sofia')).toBeInTheDocument()
  })

  it('maps genre ids to genre chips', () => {
    render(<MatchResult code="PFLX-42" movie={baseMovie} members={members} />)
    expect(screen.getByText('Thriller')).toBeInTheDocument()
    expect(screen.getByText('Drama')).toBeInTheDocument()
  })

  it('renders a "watch on" CTA that prefers the providers regional link', () => {
    render(
      <MatchResult
        code="PFLX-42"
        movie={{
          ...baseMovie,
          watchProviders: {
            providers: [{ name: 'Netflix', logoUrl: '' }],
            link: 'https://www.themoviedb.org/movie/496243/watch?locale=US',
          },
        }}
        members={members}
      />
    )
    const cta = screen.getByRole('link', { name: /watch on netflix/i })
    expect(cta).toHaveAttribute('href', 'https://www.themoviedb.org/movie/496243/watch?locale=US')
  })

  it('falls back to the watchUrl when no provider link is present', () => {
    render(<MatchResult code="PFLX-42" movie={baseMovie} members={members} />)
    const cta = screen.getByRole('link', { name: /watch on netflix/i })
    expect(cta).toHaveAttribute('href', 'https://www.themoviedb.org/movie/496243')
  })

  it('offers a "pik again" link home', () => {
    render(<MatchResult code="PFLX-42" movie={baseMovie} members={members} />)
    expect(screen.getByRole('link', { name: /pik again/i })).toHaveAttribute('href', '/')
  })
})
