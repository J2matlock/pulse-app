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

  it('CTA button is the shared 44 px primary button', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Go', onClick }}
      />
    )
    const btn = screen.getByText('Go')
    expect(btn.className).toMatch(/(^| )btn-primary( |$)/)
    expect(btn.getAttribute('style')).toBeNull()
  })

  it('draws a secondary action as a link-style button next to the main one', () => {
    const onClick = vi.fn()
    render(<EmptyState title="Empty" action={{ label: 'Add', onClick: vi.fn() }} secondaryAction={{ label: 'Import', onClick }} />)
    const link = screen.getByRole('button', { name: 'Import' })
    expect(link.className).not.toMatch(/btn-primary/)
    fireEvent.click(link)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('page size puts the icon in a circle; inline size drops it', () => {
    const { container, rerender } = render(<EmptyState title="Empty" icon={<svg data-testid="ic" />} />)
    expect(screen.getByTestId('ic').parentElement!.className).toMatch(/rounded-full/)
    rerender(<EmptyState title="Empty" size="inline" icon={<svg data-testid="ic" />} />)
    expect(container.querySelector('[data-testid="ic"]')).toBeNull()
  })
})
