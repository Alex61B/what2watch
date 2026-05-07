import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import StreamingServicePicker from '@/components/StreamingServicePicker'

describe('StreamingServicePicker', () => {
  it('renders all 6 streaming services', () => {
    render(<StreamingServicePicker selected={[]} onChange={() => {}} />)
    expect(screen.getByText('Netflix')).toBeInTheDocument()
    expect(screen.getByText('Amazon Prime')).toBeInTheDocument()
    expect(screen.getByText('Disney+')).toBeInTheDocument()
    expect(screen.getByText('HBO Max')).toBeInTheDocument()
    expect(screen.getByText('Hulu')).toBeInTheDocument()
    expect(screen.getByText('Apple TV+')).toBeInTheDocument()
  })

  it('calls onChange with the service added when an unselected service is clicked', () => {
    const handleChange = jest.fn()
    render(<StreamingServicePicker selected={[]} onChange={handleChange} />)
    fireEvent.click(screen.getByText('Netflix'))
    expect(handleChange).toHaveBeenCalledWith(['netflix'])
  })

  it('calls onChange with the service removed when a selected service is clicked', () => {
    const handleChange = jest.fn()
    render(
      <StreamingServicePicker selected={['netflix', 'hulu']} onChange={handleChange} />
    )
    fireEvent.click(screen.getByText('Netflix'))
    expect(handleChange).toHaveBeenCalledWith(['hulu'])
  })

  it('shows aria-pressed="true" for selected services and aria-pressed="false" for unselected', () => {
    render(
      <StreamingServicePicker selected={['netflix', 'disney']} onChange={() => {}} />
    )
    expect(screen.getByText('Netflix').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Disney+').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Hulu').closest('button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('HBO Max').closest('button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Amazon Prime').closest('button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Apple TV+').closest('button')).toHaveAttribute('aria-pressed', 'false')
  })
})
