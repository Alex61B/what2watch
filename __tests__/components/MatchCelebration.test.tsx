import type { ImgHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'
import MatchCelebration from '@/components/MatchCelebration'

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ fill, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img {...props} />,
}))

const baseMovie = {
  title: 'Inception',
  posterUrl: 'https://example.com/inception.jpg',
  year: 2010,
  rating: 8.8,
  overview: 'A thief who steals corporate secrets through dream-sharing technology.',
}

describe('MatchCelebration', () => {
  it('renders "It\'s a Match!" heading', () => {
    render(<MatchCelebration movie={baseMovie} />)
    expect(screen.getByRole('heading', { name: /it's a match!/i })).toBeInTheDocument()
  })

  it('renders movie title', () => {
    render(<MatchCelebration movie={baseMovie} />)
    expect(screen.getByText('Inception')).toBeInTheDocument()
  })

  it('renders a "Find where to watch" fallback link when only watchUrl is provided', () => {
    render(
      <MatchCelebration
        movie={{ ...baseMovie, watchUrl: 'https://www.themoviedb.org/movie/27205/watch' }}
      />,
    )
    const link = screen.getByRole('link', { name: /find where to watch/i })
    expect(link).toHaveAttribute('href', 'https://www.themoviedb.org/movie/27205/watch')
  })

  it('lists providers and a "Watch Now" link when watchProviders are present', () => {
    render(
      <MatchCelebration
        movie={{
          ...baseMovie,
          watchUrl: 'https://www.themoviedb.org/movie/27205/watch',
          watchProviders: {
            providers: [
              { name: 'Netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/netflix.jpg' },
              { name: 'Hulu', logoUrl: 'https://image.tmdb.org/t/p/w92/hulu.jpg' },
            ],
            link: 'https://www.themoviedb.org/movie/27205/watch?locale=US',
          },
        }}
      />,
    )
    expect(screen.getByText(/watch now on/i)).toBeInTheDocument()
    expect(screen.getByText('Netflix')).toBeInTheDocument()
    expect(screen.getByText('Hulu')).toBeInTheDocument()
    // CTA prefers the providers' regional link.
    expect(screen.getByRole('link', { name: /watch now/i })).toHaveAttribute(
      'href',
      'https://www.themoviedb.org/movie/27205/watch?locale=US',
    )
  })

  it('renders no watch CTA when there is no link or provider data', () => {
    render(<MatchCelebration movie={baseMovie} />)
    expect(screen.queryByRole('link', { name: /watch now/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /find where to watch/i })).toBeNull()
  })
})
