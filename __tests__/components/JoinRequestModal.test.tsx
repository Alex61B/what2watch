import { render, screen, fireEvent } from '@testing-library/react'
import JoinRequestModal from '@/components/JoinRequestModal'

const onApprove = jest.fn()

afterEach(() => {
  onApprove.mockClear()
})

describe('JoinRequestModal', () => {
  it('renders nothing when there are no pending members', () => {
    const { container } = render(
      <JoinRequestModal pendingMembers={[]} onApprove={onApprove} approvingId={null} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows each pending member with Accept and Deny actions', () => {
    render(
      <JoinRequestModal
        pendingMembers={[
          { id: 'm1', displayName: 'Priya' },
          { id: 'm2', displayName: 'Marcus' },
        ]}
        onApprove={onApprove}
        approvingId={null}
      />
    )
    expect(screen.getByText('Priya')).toBeInTheDocument()
    expect(screen.getByText('Marcus')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /accept/i })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /deny/i })).toHaveLength(2)
    expect(screen.getByText(/2 want to join/i)).toBeInTheDocument()
  })

  it('calls onApprove with accept / reject for the right member', () => {
    render(
      <JoinRequestModal
        pendingMembers={[{ id: 'm1', displayName: 'Priya' }]}
        onApprove={onApprove}
        approvingId={null}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    expect(onApprove).toHaveBeenCalledWith('m1', 'accept')

    fireEvent.click(screen.getByRole('button', { name: /deny/i }))
    expect(onApprove).toHaveBeenCalledWith('m1', 'reject')
  })

  it('disables the actions while an approval is in flight', () => {
    render(
      <JoinRequestModal
        pendingMembers={[{ id: 'm1', displayName: 'Priya' }]}
        onApprove={onApprove}
        approvingId="m1"
      />
    )
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /deny/i })).toBeDisabled()
  })

  it('"Not now" collapses to a re-open pill, which reopens the modal', () => {
    render(
      <JoinRequestModal
        pendingMembers={[{ id: 'm1', displayName: 'Priya' }]}
        onApprove={onApprove}
        approvingId={null}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    // Modal hidden; the member's Accept button is gone, the pill is shown.
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument()
    const pill = screen.getByRole('button', { name: /waiting to join/i })
    expect(pill).toBeInTheDocument()

    fireEvent.click(pill)
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
  })

  it('re-opens automatically when a brand-new request arrives after dismissal', () => {
    const { rerender } = render(
      <JoinRequestModal
        pendingMembers={[{ id: 'm1', displayName: 'Priya' }]}
        onApprove={onApprove}
        approvingId={null}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument()

    rerender(
      <JoinRequestModal
        pendingMembers={[
          { id: 'm1', displayName: 'Priya' },
          { id: 'm2', displayName: 'Marcus' },
        ]}
        onApprove={onApprove}
        approvingId={null}
      />
    )
    expect(screen.getByText('Marcus')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /accept/i }).length).toBeGreaterThan(0)
  })
})
