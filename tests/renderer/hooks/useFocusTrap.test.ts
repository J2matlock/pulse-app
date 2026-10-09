/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'

import { useFocusTrap } from '../../../src/renderer/hooks/useFocusTrap'

function createContainer(): HTMLDivElement {
  const container = document.createElement('div')
  const btn1 = document.createElement('button')
  btn1.textContent = 'First'
  const btn2 = document.createElement('button')
  btn2.textContent = 'Second'
  const btn3 = document.createElement('button')
  btn3.textContent = 'Third'
  container.appendChild(btn1)
  container.appendChild(btn2)
  container.appendChild(btn3)
  document.body.appendChild(container)
  return container
}

describe('useFocusTrap', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = createContainer()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    if (container.parentNode) {
      document.body.removeChild(container)
    }
  })

  it('focuses first focusable element when active', () => {
    const ref = { current: container }
    renderHook(() => useFocusTrap(ref as React.RefObject<HTMLElement | null>, true))

    // requestAnimationFrame is used to focus
    vi.advanceTimersByTime(20)

    const buttons = container.querySelectorAll('button')
    expect(document.activeElement).toBe(buttons[0])
  })

  it('does nothing when not active', () => {
    const outsideBtn = document.createElement('button')
    document.body.appendChild(outsideBtn)
    outsideBtn.focus()

    const ref = { current: container }
    renderHook(() => useFocusTrap(ref as React.RefObject<HTMLElement | null>, false))

    vi.advanceTimersByTime(20)
    expect(document.activeElement).toBe(outsideBtn)

    document.body.removeChild(outsideBtn)
  })

  it('Tab on last element wraps to first', () => {
    const ref = { current: container }
    renderHook(() => useFocusTrap(ref as React.RefObject<HTMLElement | null>, true))
    vi.advanceTimersByTime(20)

    const buttons = container.querySelectorAll('button')
    // Focus the last button
    buttons[2]!.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(preventSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(buttons[0])
  })

  it('Shift+Tab on first element wraps to last', () => {
    const ref = { current: container }
    renderHook(() => useFocusTrap(ref as React.RefObject<HTMLElement | null>, true))
    vi.advanceTimersByTime(20)

    const buttons = container.querySelectorAll('button')
    buttons[0]!.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(preventSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(buttons[2])
  })

  it('Tab in the middle does NOT prevent default (normal tab behavior)', () => {
    const ref = { current: container }
    renderHook(() => useFocusTrap(ref as React.RefObject<HTMLElement | null>, true))
    vi.advanceTimersByTime(20)

    const buttons = container.querySelectorAll('button')
    buttons[1]!.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    // Middle element, should not wrap
    expect(preventSpy).not.toHaveBeenCalled()
  })

  it('returns focus to previous element on unmount', () => {
    const outsideBtn = document.createElement('button')
    outsideBtn.textContent = 'Outside'
    document.body.appendChild(outsideBtn)
    outsideBtn.focus()
    expect(document.activeElement).toBe(outsideBtn)

    const ref = { current: container }
    const { unmount } = renderHook(() => useFocusTrap(ref as React.RefObject<HTMLElement | null>, true))
    vi.advanceTimersByTime(20)

    // Focus should be inside the trap now
    const buttons = container.querySelectorAll('button')
    expect(document.activeElement).toBe(buttons[0])

    unmount()

    // Focus should return to the outside button
    expect(document.activeElement).toBe(outsideBtn)

    document.body.removeChild(outsideBtn)
  })

  it('handles container with no focusable elements', () => {
    const emptyContainer = document.createElement('div')
    document.body.appendChild(emptyContainer)
    const ref = { current: emptyContainer }

    renderHook(() => useFocusTrap(ref as React.RefObject<HTMLElement | null>, true))
    vi.advanceTimersByTime(20)

    // Tab should be prevented (no focusable elements)
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)
    expect(preventSpy).toHaveBeenCalled()

    document.body.removeChild(emptyContainer)
  })
})
