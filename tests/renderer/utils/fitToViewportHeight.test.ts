/**
 * @vitest-environment jsdom
 */
/** Pop-ups scroll instead of running off the bottom of a short (200% zoom) window (AUDIT-055). */
import { describe, it, expect, afterEach } from 'vitest'
import { fitToViewportHeight } from '../../../src/renderer/utils/domHelpers'

function panel(top: number, height: number): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON: () => ({}) })
  Object.defineProperty(el, 'offsetHeight', { value: height })
  return el
}

const realHeight = window.innerHeight
afterEach(() => { Object.defineProperty(window, 'innerHeight', { value: realHeight, configurable: true }) })

describe('fitToViewportHeight', () => {
  it('caps a panel taller than the room below it and lets it scroll', () => {
    Object.defineProperty(window, 'innerHeight', { value: 384, configurable: true })
    const el = panel(150, 400)
    fitToViewportHeight(el)
    expect(el.style.maxHeight).toBe('226px')
    expect(el.style.overflowY).toBe('auto')
  })

  it('leaves a panel that fits alone', () => {
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
    const el = panel(150, 300)
    fitToViewportHeight(el)
    expect(el.style.maxHeight).toBe('')
    expect(el.style.overflowY).toBe('')
  })

  it('never shrinks a panel below 120px, even with almost no room', () => {
    Object.defineProperty(window, 'innerHeight', { value: 384, configurable: true })
    const el = panel(340, 300)
    fitToViewportHeight(el)
    expect(el.style.maxHeight).toBe('120px')
  })
})
