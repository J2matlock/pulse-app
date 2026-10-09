/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock settingsStore — use a mutable object so tests can change uiScale
const mockState = { uiScale: 100 }
vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mockState,
  },
}))

// Mock domHelpers
vi.mock('../../../src/renderer/utils/domHelpers', () => ({
  isEditableElement: (el: Element | null) => {
    if (!el) return false
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  },
}))

import { useZoom } from '../../../src/renderer/hooks/useZoom'

describe('useZoom', () => {
  let setUiScale: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setUiScale = vi.fn()
    mockState.uiScale = 100
    document.body.focus()
  })

  function render() {
    return renderHook(() => useZoom(setUiScale))
  }

  it('Ctrl+= increases zoom by 5', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true }))
    expect(setUiScale).toHaveBeenCalledWith(105)
  })

  it('Ctrl+- decreases zoom by 5', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true }))
    expect(setUiScale).toHaveBeenCalledWith(95)
  })

  it('Ctrl+0 resets zoom to 100', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true }))
    expect(setUiScale).toHaveBeenCalledWith(100)
  })

  it('does not exceed max zoom of 150', () => {
    mockState.uiScale = 150

    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true }))
    expect(setUiScale).toHaveBeenCalledWith(150) // clamped at max
  })

  it('does not go below min zoom of 80', () => {
    mockState.uiScale = 80

    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true }))
    expect(setUiScale).toHaveBeenCalledWith(80) // clamped at min
  })

  it('does nothing without ctrlKey', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true }))
    expect(setUiScale).not.toHaveBeenCalled()
  })

  it('does nothing when focus is in an input element', () => {
    render()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true }))
    expect(setUiScale).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })

  it('cleans up listener on unmount', () => {
    const spy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render()
    unmount()

    const removedEvents = spy.mock.calls.map(c => c[0])
    expect(removedEvents).toContain('keydown')
    spy.mockRestore()
  })
})
