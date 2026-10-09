// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '../../../../src/renderer/components/shared/EmptyState'

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No clients yet" />)
    expect(screen.getByText('No clients yet')).toBeDefined()
  })

  it('renders description when provided', () => {
    render(<EmptyState title="No clients yet" description="Add your first client to get started." />)
    expect(screen.getByText('Add your first client to get started.')).toBeDefined()
  })

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<svg data-testid="custom-icon" />} />)
    expect(screen.getByTestId('custom-icon')).toBeDefined()
  })

  it('renders CTA button that calls action.onClick', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="No clients"
        action={{ label: 'Add Client', onClick }}
      />
    )
    const btn = screen.getByText('Add Client')
    expect(btn).toBeDefined()
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders without CTA gracefully', () => {
    const { container } = render(<EmptyState title="Nothing here" />)
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBe(0)
  })

  it('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />)
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs.length).toBe(0)
  })

  it('CTA button has correct minimum height styling', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Go', onClick }}
      />
    )
    const btn = screen.getByText('Go')
    expect(btn.style.minHeight).toBe('44px')
  })
})
