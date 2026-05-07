import type { ImgHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'
import MatchCelebration from '@/components/MatchCelebration'

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
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

  it('renders "Watch Now" link when watchUrl is provided', () => {
    render(
      <MatchCelebration
        movie={{ ...baseMovie, watchUrl: 'https://www.netflix.com/watch/inception' }}
      />,
    )
    const link = screen.getByRole('link', { name: /watch now/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://www.netflix.com/watch/inception')
  })

  it('does not render "Watch Now" link when watchUrl is absent', () => {
    render(<MatchCelebration movie={baseMovie} />)
    expect(screen.queryByRole('link', { name: /watch now/i })).toBeNull()
  })
})
