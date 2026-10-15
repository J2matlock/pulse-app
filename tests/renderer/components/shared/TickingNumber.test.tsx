// @vitest-environment jsdom
/**
 * TickingNumber (Q6): a number that changes ticks; the first number, and the
 * first after a placeholder ("—" while loading), just shows.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TickingNumber } from '../../../../src/renderer/components/shared/TickingNumber'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
})

afterEach(cleanup)

describe('TickingNumber', () => {
  it('a placeholder is plain text, and the number after it shows without animating in', () => {
    const { container, rerender } = render(<TickingNumber value="—" />)
    expect(container.textContent).toBe('—')
    expect(container.querySelector('[data-testid="ticking-number"]')).toBeNull()
    rerender(<TickingNumber value={12} />)
    const span = container.querySelector('[data-testid="ticking-number"] span') as HTMLElement
    expect(span.textContent).toBe('12')
    // Mounted at rest: no entry offset
    expect(span.style.opacity === '' || span.style.opacity === '1').toBe(true)
  })

  it('a changed number is the new one, in tabular digits', () => {
    const { container, rerender } = render(<TickingNumber value={5} className="text-2xl" />)
    rerender(<TickingNumber value={4} className="text-2xl" />)
    const host = container.querySelector('[data-testid="ticking-number"]') as HTMLElement
    expect(host.className).toMatch(/tabular-nums/)
    expect(host.className).toMatch(/text-2xl/)
    expect(host.textContent).toContain('4')
  })
})
