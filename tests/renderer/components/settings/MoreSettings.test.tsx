// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MoreSettings } from '../../../../src/renderer/components/settings/MoreSettings'

afterEach(() => cleanup())

function details(): HTMLDetailsElement {
  return screen.getByText('More settings').closest('details') as HTMLDetailsElement
}

/** jsdom doesn't toggle <details> on a summary click; do what the browser does */
function clickSummary(): void {
  const d = details()
  d.open = !d.open
  fireEvent(d, new Event('toggle'))
}

describe('MoreSettings', () => {
  it('is a native disclosure with a 44 px summary, 15 px text and a 3 px focus ring', () => {
    render(<MoreSettings changed={false}><label>Density <input /></label></MoreSettings>)
    const summary = screen.getByText('More settings')
    expect(summary.tagName).toBe('SUMMARY')
    expect(summary.parentElement!.tagName).toBe('DETAILS')
    expect(summary.className).toMatch(/hit-44/)
    expect(summary.className).toMatch(/min-h-11/)
    expect(summary.className).toMatch(/text-base/)
    expect(summary.className).toMatch(/focus-visible:ring-3/)
  })

  it('starts closed at the defaults; what is inside is still there by label', () => {
    render(<MoreSettings changed={false}><label>Density <input /></label></MoreSettings>)
    expect(details().open).toBe(false)
    expect(screen.getByLabelText('Density')).toBeTruthy()
  })

  it('starts open when something inside was changed', () => {
    render(<MoreSettings changed><span>Density</span></MoreSettings>)
    expect(details().open).toBe(true)
  })

  it('turns its chevron with the open state', () => {
    render(<MoreSettings changed={false}><span>Density</span></MoreSettings>)
    const chevron = () => details().querySelector('summary svg')!
    expect(chevron().getAttribute('class')).not.toMatch(/rotate-90/)
    clickSummary()
    expect(chevron().getAttribute('class')).toMatch(/rotate-90/)
  })

  it('opens when a changed value arrives after the first render', () => {
    const { rerender } = render(<MoreSettings changed={false}><span>Density</span></MoreSettings>)
    expect(details().open).toBe(false)
    rerender(<MoreSettings changed><span>Density</span></MoreSettings>)
    expect(details().open).toBe(true)
  })

  it('then follows the person: closing it keeps it closed, and going back to the default does not close it', () => {
    const { rerender } = render(<MoreSettings changed><span>Density</span></MoreSettings>)
    clickSummary()
    expect(details().open).toBe(false)
    rerender(<MoreSettings changed><span>Density</span></MoreSettings>)
    expect(details().open).toBe(false)

    cleanup()
    const second = render(<MoreSettings changed><span>Density</span></MoreSettings>)
    second.rerender(<MoreSettings changed={false}><span>Density</span></MoreSettings>)
    expect(details().open).toBe(true)
  })

  it('a value changed after the person opened and closed it does not reopen it', () => {
    const { rerender } = render(<MoreSettings changed={false}><span>Density</span></MoreSettings>)
    clickSummary()
    clickSummary()
    rerender(<MoreSettings changed><span>Density</span></MoreSettings>)
    expect(details().open).toBe(false)
  })

  it('takes its own label', () => {
    render(<MoreSettings label="More words" changed={false}><span>x</span></MoreSettings>)
    expect(screen.getByText('More words').tagName).toBe('SUMMARY')
  })
})
