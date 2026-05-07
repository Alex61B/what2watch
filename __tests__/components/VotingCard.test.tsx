import { render, screen, fireEvent } from '@testing-library/react'
import VotingCard from '@/components/VotingCard'

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}))

const baseMovie = {
  tmdbId: '123',
  title: 'Dune',
  overview: 'A noble family becomes embroiled in a war for control over the galaxy.',
  posterUrl: 'https://example.com/dune.jpg',
  year: 2021,
  rating: 7.9,
  runtime: 155,
  genreIds: [878, 12],
}

describe('VotingCard', () => {
  it('renders movie title', () => {
    render(<VotingCard movie={baseMovie} onVote={jest.fn()} />)
    expect(screen.getByText('Dune')).toBeInTheDocument()
  })

  it('renders year and rating', () => {
    render(<VotingCard movie={baseMovie} onVote={jest.fn()} />)
    expect(screen.getByText(/2021/)).toBeInTheDocument()
    expect(screen.getByText(/7\.9/)).toBeInTheDocument()
  })

  it('YES button calls onVote(true)', () => {
    const onVote = jest.fn()
    render(<VotingCard movie={baseMovie} onVote={onVote} />)
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    expect(onVote).toHaveBeenCalledWith(true)
  })

  it('NO button calls onVote(false)', () => {
    const onVote = jest.fn()
    render(<VotingCard movie={baseMovie} onVote={onVote} />)
    fireEvent.click(screen.getByRole('button', { name: /no/i }))
    expect(onVote).toHaveBeenCalledWith(false)
  })

  it('renders "min" when runtime is not null', () => {
    render(<VotingCard movie={{ ...baseMovie, runtime: 118 }} onVote={jest.fn()} />)
    expect(screen.getByText(/118 min/)).toBeInTheDocument()
  })
})
