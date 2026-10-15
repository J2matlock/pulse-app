// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import { PrimaryButton, SecondaryButton, DangerButton, IconButton } from '../../../../src/renderer/components/ui/Button'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('PrimaryButton / SecondaryButton / DangerButton', () => {
  it('render the shared button classes, compact too', () => {
    render(<>
      <PrimaryButton>Save</PrimaryButton>
      <SecondaryButton>Cancel</SecondaryButton>
      <DangerButton>Delete</DangerButton>
      <PrimaryButton size="compact">Add</PrimaryButton>
      <SecondaryButton size="compact">Filter</SecondaryButton>
      <DangerButton size="compact">Remove</DangerButton>
    </>)
    expect(screen.getByRole('button', { name: 'Save' }).className).toMatch(/(^| )btn-primary( |$)/)
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toMatch(/(^| )btn-secondary( |$)/)
    expect(screen.getByRole('button', { name: 'Delete' }).className).toMatch(/(^| )btn-danger( |$)/)
    expect(screen.getByRole('button', { name: 'Add' }).className).toMatch(/btn-compact-primary/)
    expect(screen.getByRole('button', { name: 'Filter' }).className).toMatch(/btn-compact-secondary/)
    expect(screen.getByRole('button', { name: 'Remove' }).className).toMatch(/btn-compact-danger/)
  })

  it('is type="button" unless told otherwise', () => {
    render(<form><PrimaryButton>One</PrimaryButton><PrimaryButton type="submit">Two</PrimaryButton></form>)
    expect(screen.getByRole('button', { name: 'One' }).getAttribute('type')).toBe('button')
    expect(screen.getByRole('button', { name: 'Two' }).getAttribute('type')).toBe('submit')
  })

  it('passes data-tour, data-testid, id, aria-* and className through, and takes a ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<PrimaryButton ref={ref} data-tour="add-row" data-testid="add" id="add-btn" aria-describedby="hint" className="mt-4">Add</PrimaryButton>)
    const btn = screen.getByTestId('add')
    expect(btn.getAttribute('data-tour')).toBe('add-row')
    expect(btn.id).toBe('add-btn')
    expect(btn.getAttribute('aria-describedby')).toBe('hint')
    expect(btn.className).toMatch(/mt-4/)
    expect(ref.current).toBe(btn)
  })

  it('busy disables the button and says so', () => {
    const onClick = vi.fn()
    render(<PrimaryButton busy onClick={onClick}>Saving</PrimaryButton>)
    const btn = screen.getByRole('button', { name: 'Saving' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('busy shows a spinner only after 300 ms, in place of the icon (Q6)', () => {
    vi.useFakeTimers()
    const { rerender } = render(<PrimaryButton busy icon={<svg data-testid="ic" />}>Save</PrimaryButton>)
    expect(screen.queryByTestId('button-spinner')).toBeNull()
    act(() => { vi.advanceTimersByTime(299) })
    expect(screen.queryByTestId('button-spinner')).toBeNull()
    expect(screen.getByTestId('ic')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByTestId('button-spinner')).toBeTruthy()
    expect(screen.queryByTestId('ic')).toBeNull()
    // Hidden from screen readers (aria-busy says it), and still at rest under reduced motion
    expect(screen.getByTestId('button-spinner').closest('[aria-hidden="true"]')).toBeTruthy()
    expect(screen.getByTestId('button-spinner').getAttribute('class')).toMatch(/motion-reduce:animate-none/)
    rerender(<PrimaryButton icon={<svg data-testid="ic" />}>Save</PrimaryButton>)
    expect(screen.queryByTestId('button-spinner')).toBeNull()
    expect(screen.getByTestId('ic')).toBeTruthy()
  })

  it('a busy button without an icon puts the spinner before its words', () => {
    vi.useFakeTimers()
    render(<SecondaryButton busy>Saving…</SecondaryButton>)
    act(() => { vi.advanceTimersByTime(300) })
    const btn = screen.getByRole('button', { name: 'Saving…' })
    expect(btn.firstElementChild!.contains(screen.getByTestId('button-spinner'))).toBe(true)
  })

  it('hides the icon from screen readers', () => {
    render(<SecondaryButton icon={<svg data-testid="ic" />}>Print</SecondaryButton>)
    expect(screen.getByTestId('ic').parentElement!.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
  })

  it('inverse tone changes the secondary look for dark bars', () => {
    render(<SecondaryButton tone="inverse">Clear</SecondaryButton>)
    expect(screen.getByRole('button', { name: 'Clear' }).className).toMatch(/bg-white\/10/)
  })
})

describe('IconButton', () => {
  it('uses the label as its name, not a native title', () => {
    render(<IconButton label="Close" icon={<svg />} />)
    const btn = screen.getByRole('button', { name: 'Close' })
    expect(btn.getAttribute('title')).toBeNull()
    expect(btn.getAttribute('type')).toBe('button')
  })

  it('shows the label and shortcut in a tooltip on focus', () => {
    vi.useFakeTimers()
    // jsdom's rects are all zero, which the tooltip reads as "no box"
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 44, height: 44, top: 50, right: 44, bottom: 94, left: 0, toJSON: () => ({}) })
    render(<IconButton label="Find" shortcut="Ctrl+F" icon={<svg />} />)
    fireEvent.focus(screen.getByRole('button', { name: 'Find' }))
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip').textContent).toBe('Find (Ctrl+F)')
  })

  it('is 44 px, or 36 px inside a 44 px click area when compact', () => {
    render(<><IconButton label="A" icon={<svg />} /><IconButton label="B" size="compact" icon={<svg />} /></>)
    expect(screen.getByRole('button', { name: 'A' }).className).toMatch(/w-11 h-11/)
    expect(screen.getByRole('button', { name: 'B' }).className).toMatch(/w-9 h-9 hit-44/)
  })

  it('draws a 3 px focus ring', () => {
    render(<IconButton label="A" icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'A' }).className).toMatch(/focus-visible:ring-3/)
  })
})
