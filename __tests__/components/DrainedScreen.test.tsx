import { render, screen } from '@testing-library/react'
import DrainedScreen from '@/components/DrainedScreen'

describe('DrainedScreen', () => {
  it('renders the no-more-movies header', () => {
    render(<DrainedScreen isHost={true} code="ABCD-12" />)
    expect(screen.getByText(/No more movies/i)).toBeInTheDocument()
  })

  it('shows the disabled "Deal more movies" button for the host', () => {
    render(<DrainedScreen isHost={true} code="ABCD-12" />)
    const button = screen.getByRole('button', { name: /Deal more movies/i })
    expect(button).toBeInTheDocument()
    expect(button).toBeDisabled()
  })

  it('does not show the deal-more button for non-hosts', () => {
    render(<DrainedScreen isHost={false} code="ABCD-12" />)
    expect(screen.queryByRole('button', { name: /Deal more movies/i })).toBeNull()
    expect(screen.getByText(/Waiting for the host/i)).toBeInTheDocument()
  })

  it('renders a back-to-lobby link that points at the room code', () => {
    render(<DrainedScreen isHost={false} code="ABCD-12" />)
    const link = screen.getByRole('link', { name: /Back to Lobby/i })
    expect(link).toHaveAttribute('href', '/room/ABCD-12/lobby')
  })
})
