// __tests__/components/MovieListClient.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MovieListClient from '@/components/MovieListClient'

// jsdom provides neither `fetch` nor the `Response` global. Provide a minimal
// Fetch-API shim so `new Response(body, { status })` and `jest.spyOn(global, 'fetch')`
// work the same way they would in a browser.
if (typeof (global as { Response?: unknown }).Response === 'undefined') {
  class ShimResponse {
    body: string
    status: number
    ok: boolean
    constructor(body?: string, init?: { status?: number }) {
      this.body = body ?? ''
      this.status = init?.status ?? 200
      this.ok = this.status >= 200 && this.status < 300
    }
    async json() {
      return JSON.parse(this.body)
    }
    async text() {
      return this.body
    }
  }
  ;(global as { Response: unknown }).Response = ShimResponse
}
if (typeof global.fetch === 'undefined') {
  global.fetch = (() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch
}

describe('MovieListClient', () => {
  afterEach(() => jest.restoreAllMocks())

  it('renders the empty state when the list is empty', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ movies: [] }), { status: 200 })
    )
    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument()
  })

  it('renders movies and removes one on click', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        movies: [{ tmdbMovieId: '603', title: 'The Matrix', posterUrl: '', year: 1999, overview: '', rating: 8.2, sourceRoomId: null, addedAt: '2026-01-01' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText('The Matrix')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /remove the matrix/i }))

    await waitFor(() => expect(screen.queryByText('The Matrix')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/user/movies', expect.objectContaining({ method: 'DELETE' }))
  })
})
