// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingSpinner, LoadingOverlay } from '../../../../src/renderer/components/shared/LoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders with role=status', () => {
    render(<LoadingSpinner />)
    expect(screen.getByRole('status')).toBeDefined()
  })

  it('has default aria-label "Loading..."', () => {
    render(<LoadingSpinner />)
    const spinner = screen.getByRole('status')
    expect(spinner.getAttribute('aria-label')).toContain('Loading')
  })

  it('shows custom label in sr-only text', () => {
    render(<LoadingSpinner label="Saving data..." />)
    expect(screen.getByText('Saving data...')).toBeDefined()
  })

  it('applies small size class', () => {
    const { container } = render(<LoadingSpinner size="sm" />)
    const inner = container.querySelector('.w-4')
    expect(inner).not.toBeNull()
  })

  it('applies large size class', () => {
    const { container } = render(<LoadingSpinner size="lg" />)
    const inner = container.querySelector('.w-10')
    expect(inner).not.toBeNull()
  })

  it('applies medium size class by default', () => {
    const { container } = render(<LoadingSpinner />)
    const inner = container.querySelector('.w-6')
    expect(inner).not.toBeNull()
  })

  it('passes custom className', () => {
    render(<LoadingSpinner className="my-custom" />)
    const spinner = screen.getByRole('status')
    expect(spinner.className).toContain('my-custom')
  })
})

describe('LoadingOverlay', () => {
  it('renders spinner and visible label text', () => {
    render(<LoadingOverlay label="Please wait..." />)
    // The label appears both as sr-only inside spinner AND as visible text
    const matches = screen.getAllByText('Please wait...')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders with default label', () => {
    render(<LoadingOverlay />)
    const matches = screen.getAllByText(/Loading/)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders a large spinner inside overlay', () => {
    const { container } = render(<LoadingOverlay />)
    const large = container.querySelector('.w-10')
    expect(large).not.toBeNull()
  })
})
