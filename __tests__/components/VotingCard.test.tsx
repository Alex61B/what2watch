import type { ImgHTMLAttributes } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import VotingCard from '@/components/VotingCard'

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ fill, priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => <img {...props} />,
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

  it('PIK IT button calls onVote(true)', () => {
    const onVote = jest.fn()
    render(<VotingCard movie={baseMovie} onVote={onVote} />)
    fireEvent.click(screen.getByRole('button', { name: /pik it/i }))
    expect(onVote).toHaveBeenCalledWith(true)
  })

  it('NOPE button calls onVote(false)', () => {
    const onVote = jest.fn()
    render(<VotingCard movie={baseMovie} onVote={onVote} />)
    fireEvent.click(screen.getByRole('button', { name: /nope/i }))
    expect(onVote).toHaveBeenCalledWith(false)
  })

  it('renders "min" when runtime is not null', () => {
    render(<VotingCard movie={{ ...baseMovie, runtime: 118 }} onVote={jest.fn()} />)
    expect(screen.getByText(/118 min/)).toBeInTheDocument()
  })

  it('does not render runtime separator when runtime is null', () => {
    render(<VotingCard movie={{ ...baseMovie, runtime: null }} onVote={jest.fn()} />)
    expect(screen.queryByText(/min/)).toBeNull()
    expect(screen.queryByText(/·/)).toBeNull()
  })

  it('renders fallback when posterUrl is empty string', () => {
    render(<VotingCard movie={{ ...baseMovie, posterUrl: '' }} onVote={jest.fn()} />)
    expect(screen.getByText(/no image/i)).toBeInTheDocument()
  })

  it('renders PIK and NOPE swipe stamps', () => {
    render(<VotingCard movie={baseMovie} onVote={jest.fn()} />)
    expect(screen.getByText(/^pik$/i)).toBeInTheDocument()
    expect(screen.getByText(/^nope$/i)).toBeInTheDocument()
  })

  it('shows the seen-it toggle and fires onToggleSeen', () => {
    const onToggleSeen = jest.fn()
    render(<VotingCard movie={baseMovie} onVote={jest.fn()} onToggleSeen={onToggleSeen} />)
    fireEvent.click(screen.getByRole('button', { name: /seen it/i }))
    expect(onToggleSeen).toHaveBeenCalled()
  })

  it('disables both vote buttons when disabled prop is true', () => {
    const onVote = jest.fn()
    render(<VotingCard movie={baseMovie} onVote={onVote} disabled />)
    const pikBtn = screen.getByRole('button', { name: /pik it/i })
    const nopeBtn = screen.getByRole('button', { name: /nope/i })
    expect(pikBtn).toBeDisabled()
    expect(nopeBtn).toBeDisabled()
    fireEvent.click(pikBtn)
    fireEvent.click(nopeBtn)
    expect(onVote).not.toHaveBeenCalled()
  })
})
