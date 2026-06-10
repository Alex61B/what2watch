import { render, screen } from '@testing-library/react'
import MatchCelebration from '@/components/MatchCelebration'

describe('MatchCelebration (interstitial)', () => {
  it('renders the "It\'s a match." heading', () => {
    render(<MatchCelebration />)
    expect(screen.getByRole('heading', { name: /it's a match/i })).toBeInTheDocument()
  })

  it('teases the upcoming pick', () => {
    render(<MatchCelebration />)
    expect(screen.getByText(/cueing up tonight's pick/i)).toBeInTheDocument()
  })
})
