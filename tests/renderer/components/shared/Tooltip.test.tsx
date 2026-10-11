// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Tooltip } from '../../../../src/renderer/components/shared/Tooltip'

// Mock motion/react
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { variants, initial, animate, exit, ...rest } = props as Record<string, unknown>
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom returns all-zero rects by default; stub a real bounding rect
    // so the Tooltip's early-return guard (width===0 && height===0) is bypassed.
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, width: 100, height: 40, top: 50, right: 100, bottom: 90, left: 0, toJSON: () => {},
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders children', () => {
    render(
      <Tooltip content="Help text">
        <button>Hover me</button>
      </Tooltip>
    )
    expect(screen.getByText('Hover me')).toBeDefined()
  })

  it('does not show tooltip initially', () => {
    render(
      <Tooltip content="Help text">
        <button>Hover me</button>
      </Tooltip>
    )
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows tooltip content after hover and delay', () => {
    render(
      <Tooltip content="Help text" delay={100}>
        <button>Hover me</button>
      </Tooltip>
    )
    const wrapper = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(wrapper)
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByRole('tooltip')).toBeDefined()
    expect(screen.getByText('Help text')).toBeDefined()
  })

  it('hides tooltip on mouse leave', () => {
    render(
      <Tooltip content="Help text" delay={100}>
        <button>Hover me</button>
      </Tooltip>
    )
    const wrapper = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(wrapper)
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByRole('tooltip')).toBeDefined()

    fireEvent.mouseLeave(wrapper)
    // A short grace period lets the pointer move onto the tooltip (WCAG 1.4.13)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('stays while the pointer moves onto the tooltip, then hides when it leaves (WCAG 1.4.13)', () => {
    render(
      <Tooltip content="Help text" delay={100}>
        <button>Hover me</button>
      </Tooltip>
    )
    const wrapper = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(wrapper)
    act(() => { vi.advanceTimersByTime(150) })
    fireEvent.mouseLeave(wrapper)
    fireEvent.mouseEnter(screen.getByRole('tooltip'))
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip')).toBeDefined()
    fireEvent.mouseLeave(screen.getByRole('tooltip'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('Escape hides a showing tooltip (WCAG 1.4.13)', () => {
    render(
      <Tooltip content="Help text" delay={100}>
        <button>Hover me</button>
      </Tooltip>
    )
    fireEvent.focus(screen.getByText('Hover me'))
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByRole('tooltip')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('links the showing hint to its trigger with aria-describedby', () => {
    render(
      <Tooltip content="Click to sort" delay={100}>
        <button>Name</button>
      </Tooltip>
    )
    const btn = screen.getByRole('button', { name: 'Name' })
    expect(btn.getAttribute('aria-describedby')).toBeNull()
    fireEvent.focus(btn)
    act(() => { vi.advanceTimersByTime(150) })
    expect(btn.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
  })

  it('does not show tooltip if mouse leaves before delay', () => {
    render(
      <Tooltip content="Help text" delay={400}>
        <button>Hover me</button>
      </Tooltip>
    )
    const wrapper = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(wrapper)
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.mouseLeave(wrapper)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows tooltip on focus', () => {
    render(
      <Tooltip content="Focus tip" delay={100}>
        <button>Focus me</button>
      </Tooltip>
    )
    const wrapper = screen.getByText('Focus me').parentElement!
    fireEvent.focus(wrapper)
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByText('Focus tip')).toBeDefined()
  })
})
