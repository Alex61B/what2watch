import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsClient from '@/components/SettingsClient'

// jsdom has no fetch — mock it wholesale (see memory reference-jest-jsdom-no-fetch).
function lastPutBody(): Record<string, unknown> | null {
  const calls = (global.fetch as jest.Mock).mock.calls
  const put = calls.find(([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT')
  return put ? JSON.parse((put[1] as RequestInit).body as string) : null
}

afterEach(() => jest.restoreAllMocks())

test('does NOT send savedServices before the saved prefs load — cannot wipe services', async () => {
  // GET hangs (still loading) → services were never loaded.
  global.fetch = jest.fn((_url: string, opts?: RequestInit) => {
    if (opts?.method === 'PUT') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
    return new Promise(() => {}) // GET never resolves
  }) as unknown as typeof fetch

  render(<SettingsClient email="a@test.dev" initialName="Alice" />)
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

  await waitFor(() => expect(lastPutBody()).not.toBeNull())
  const body = lastPutBody()!
  expect(body.displayName).toBe('Alice')
  // omitted entirely so the PUT route leaves saved services untouched
  expect(body).not.toHaveProperty('savedServices')
})

test('sends the loaded savedServices once they have loaded', async () => {
  global.fetch = jest.fn((_url: string, opts?: RequestInit) => {
    if (opts?.method === 'PUT') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ savedServices: ['netflix'] }) })
  }) as unknown as typeof fetch

  render(<SettingsClient email="a@test.dev" initialName="Alice" />)
  // wait until the GET-loaded service is reflected as selected
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /netflix/i })).toHaveAttribute('aria-pressed', 'true'),
  )
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

  await waitFor(() => expect(lastPutBody()).not.toBeNull())
  expect(lastPutBody()!.savedServices).toEqual(['netflix'])
})
