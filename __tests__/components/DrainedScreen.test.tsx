import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DrainedScreen from '@/components/DrainedScreen'

describe('DrainedScreen', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders the out-of-movies header', () => {
    render(<DrainedScreen isHost={true} code="ABCD-12" />)
    expect(screen.getByText(/out of movies/i)).toBeInTheDocument()
  })

  it('host can deal more movies — clicking calls the requeue route', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ requeued: true }) })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<DrainedScreen isHost={true} code="ABCD-12" />)
    const button = screen.getByRole('button', { name: /deal more movies/i })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/rooms/ABCD-12/requeue', { method: 'POST' })
    )
  })

  it('messages the host when no fresh movies match the filters', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ requeued: false }) })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<DrainedScreen isHost={true} code="ABCD-12" />)
    fireEvent.click(screen.getByRole('button', { name: /deal more movies/i }))
    expect(await screen.findByText(/no fresh movies match/i)).toBeInTheDocument()
  })

  it('does not show the deal-more button for non-hosts', () => {
    render(<DrainedScreen isHost={false} code="ABCD-12" />)
    expect(screen.queryByRole('button', { name: /deal more movies/i })).toBeNull()
    expect(screen.getByText(/waiting for the host/i)).toBeInTheDocument()
  })

  it('renders a back-to-lobby link that points at the room code', () => {
    render(<DrainedScreen isHost={false} code="ABCD-12" />)
    const link = screen.getByRole('link', { name: /back to lobby/i })
    expect(link).toHaveAttribute('href', '/room/ABCD-12/lobby')
  })
})
