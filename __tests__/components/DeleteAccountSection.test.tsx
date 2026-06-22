/**
 * WP6/M9 — the account-deletion danger zone. The destructive button stays disabled until the user
 * types the confirm word; on confirm it calls DELETE /api/account and then signs out. next-auth's
 * signOut and fetch (absent in jsdom) are mocked.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DeleteAccountSection from '@/components/DeleteAccountSection'
import { signOut } from 'next-auth/react'

jest.mock('next-auth/react', () => ({ signOut: jest.fn() }))
const signOutMock = signOut as jest.Mock

beforeEach(() => signOutMock.mockReset())
afterEach(() => jest.restoreAllMocks())

const deleteButton = () => screen.getByRole('button', { name: /delete my account/i })
const confirmInput = () => screen.getByLabelText(/type/i)

test('the delete button is disabled until the confirm word is typed (case-insensitive)', () => {
  render(<DeleteAccountSection />)
  expect(deleteButton()).toBeDisabled()
  fireEvent.change(confirmInput(), { target: { value: 'delete' } })
  expect(deleteButton()).toBeEnabled()
})

test('a wrong confirm value keeps the button disabled', () => {
  render(<DeleteAccountSection />)
  fireEvent.change(confirmInput(), { target: { value: 'remove' } })
  expect(deleteButton()).toBeDisabled()
})

test('on confirm it calls DELETE /api/account, then signs out', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200 })) as unknown as typeof fetch
  render(<DeleteAccountSection />)
  fireEvent.change(confirmInput(), { target: { value: 'DELETE' } })
  fireEvent.click(deleteButton())

  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith('/api/account', expect.objectContaining({ method: 'DELETE' })),
  )
  await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/' }))
})

test('shows an error and does NOT sign out when the request fails', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 })) as unknown as typeof fetch
  render(<DeleteAccountSection />)
  fireEvent.change(confirmInput(), { target: { value: 'DELETE' } })
  fireEvent.click(deleteButton())

  await waitFor(() => expect(screen.getByText(/could not delete your account/i)).toBeInTheDocument())
  expect(signOutMock).not.toHaveBeenCalled()
})
