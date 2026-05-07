import { render, screen } from '@testing-library/react'
import MemberList from '@/components/MemberList'

const members = [
  { id: 'u1', displayName: 'Alex', isHost: true },
  { id: 'u2', displayName: 'Jordan', isHost: false },
  { id: 'u3', displayName: 'Sam', isHost: false },
]

describe('MemberList', () => {
  it('renders all member display names', () => {
    render(<MemberList members={members} currentMemberId="u2" />)
    expect(screen.getByText(/Alex/)).toBeInTheDocument()
    expect(screen.getByText(/Jordan/)).toBeInTheDocument()
    expect(screen.getByText(/Sam/)).toBeInTheDocument()
  })

  it('shows "(Host)" for the host member', () => {
    render(<MemberList members={members} currentMemberId="u2" />)
    expect(screen.getByText(/\(Host\)/)).toBeInTheDocument()
  })

  it('shows "(You)" for the current member', () => {
    render(<MemberList members={members} currentMemberId="u2" />)
    expect(screen.getByText(/\(You\)/)).toBeInTheDocument()
  })

  it('shows the correct member count', () => {
    render(<MemberList members={members} currentMemberId="u2" />)
    expect(screen.getByText(/3 members/i)).toBeInTheDocument()
  })
})
