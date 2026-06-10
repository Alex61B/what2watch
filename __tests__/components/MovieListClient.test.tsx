// __tests__/components/MovieListClient.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

function movie(over: Partial<{ tmdbMovieId: string; title: string; year: number; rating: number; addedAt: string }>) {
  return {
    tmdbMovieId: '0', title: 'Untitled', posterUrl: '', year: 2000, overview: '', rating: 5,
    sourceRoomId: null, addedAt: '2026-01-01', ...over,
  }
}

function mockList(movies: ReturnType<typeof movie>[]) {
  jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ movies }), { status: 200 })
  )
}

const SAMPLE = [
  movie({ tmdbMovieId: '1', title: 'The Matrix', year: 1999, rating: 8.2, addedAt: '2026-01-03' }),
  movie({ tmdbMovieId: '2', title: 'Parasite', year: 2019, rating: 8.5, addedAt: '2026-01-02' }),
  movie({ tmdbMovieId: '3', title: 'Dune', year: 2021, rating: 7.9, addedAt: '2026-01-01' }),
]

describe('MovieListClient', () => {
  afterEach(() => jest.restoreAllMocks())

  it('renders the empty state when the list is empty', async () => {
    mockList([])
    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument()
  })

  it('renders movies and removes one on click', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        movies: [movie({ tmdbMovieId: '603', title: 'The Matrix', year: 1999, rating: 8.2 })],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText('The Matrix')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /remove the matrix/i }))

    await waitFor(() => expect(screen.queryByText('The Matrix')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/user/movies', expect.objectContaining({ method: 'DELETE' }))
  })

  it('keeps the sort/rating/year controls behind a Filters toggle', async () => {
    mockList(SAMPLE)
    render(<MovieListClient type="watchlist" />)
    await screen.findByText('The Matrix')

    // Search stays visible; the filter controls are collapsed by default.
    expect(screen.getByLabelText(/search by title/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/minimum rating/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/release year/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /filters/i }))
    expect(screen.getByLabelText(/minimum rating/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/release year/i)).toBeInTheDocument()
  })

  it('search narrows the list by title', async () => {
    mockList(SAMPLE)
    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText('The Matrix')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/search by title/i), 'para')
    expect(screen.getByText('Parasite')).toBeInTheDocument()
    expect(screen.queryByText('The Matrix')).not.toBeInTheDocument()
    expect(screen.queryByText('Dune')).not.toBeInTheDocument()
  })

  it('minimum-rating slider hides lower-rated movies', async () => {
    mockList(SAMPLE)
    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText('Parasite')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /filters/i }))
    fireEvent.change(screen.getByLabelText(/minimum rating/i), { target: { value: '8.3' } })
    expect(screen.getByText('Parasite')).toBeInTheDocument() // 8.5
    expect(screen.queryByText('The Matrix')).not.toBeInTheDocument() // 8.2
    expect(screen.queryByText('Dune')).not.toBeInTheDocument() // 7.9
  })

  it('release-year filter keeps only movies from the chosen decade', async () => {
    mockList(SAMPLE)
    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText('Dune')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /filters/i }))
    await userEvent.selectOptions(screen.getByLabelText(/release year/i), '2020')
    expect(screen.getByText('Dune')).toBeInTheDocument() // 2021
    expect(screen.queryByText('Parasite')).not.toBeInTheDocument() // 2019
    expect(screen.queryByText('The Matrix')).not.toBeInTheDocument() // 1999
  })

  it('shows a no-match message when filters exclude everything', async () => {
    mockList(SAMPLE)
    render(<MovieListClient type="watchlist" />)
    expect(await screen.findByText('The Matrix')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/search by title/i), 'zzz no such movie')
    expect(screen.getByText(/no movies match your filters/i)).toBeInTheDocument()
  })
})
