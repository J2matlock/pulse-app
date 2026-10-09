/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// The hook listens for macOS menu commands from the main process
const menuListeners: Array<(cmd: unknown) => void> = []
Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn(), on: (_channel: string, cb: (cmd: unknown) => void) => { menuListeners.push(cb); return () => {} } },
  writable: true,
})

// Mock settingsStore
const mockSetFocusModeOpen = vi.fn()
vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ focusModeOpen: false, setFocusModeOpen: mockSetFocusModeOpen }),
  },
}))

// Mock undoStore
const mockUndo = vi.fn().mockResolvedValue(undefined)
const mockRedo = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: {
    getState: () => ({ undo: mockUndo, redo: mockRedo }),
  },
}))

// Mock domHelpers
vi.mock('../../../src/renderer/utils/domHelpers', () => ({
  isEditableElement: (el: Element | null) => {
    if (!el) return false
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  },
}))

import { useGlobalKeyboard } from '../../../src/renderer/hooks/useGlobalKeyboard'
import { setWords, setFeatures, EXISTING_FEATURES } from '../vocabFixture'

beforeEach(() => { setWords() })

describe('useGlobalKeyboard', () => {
  let setCommandPaletteOpen: ReturnType<typeof vi.fn>
  let setShortcutsOpen: ReturnType<typeof vi.fn>
  let setGlobalTaskOpen: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setCommandPaletteOpen = vi.fn()
    setShortcutsOpen = vi.fn()
    setGlobalTaskOpen = vi.fn()
    mockUndo.mockReset()
    mockRedo.mockReset()
    mockSetFocusModeOpen.mockReset()
    // Ensure body is focused (not an input)
    document.body.focus()
  })

  function render() {
    return renderHook(() => useGlobalKeyboard(setCommandPaletteOpen, setShortcutsOpen, setGlobalTaskOpen))
  }

  it('Ctrl+K toggles command palette', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    expect(setCommandPaletteOpen).toHaveBeenCalledWith(expect.any(Function))
  })

  it('? opens keyboard shortcuts when not in input', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
    expect(setShortcutsOpen).toHaveBeenCalledWith(expect.any(Function))
  })

  it('? does NOT open shortcuts when in an input element', () => {
    render()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
    expect(setShortcutsOpen).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })

  it('Ctrl+Z triggers undo when not in editable element', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(mockUndo).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Z does NOT trigger undo when in input', () => {
    render()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(mockUndo).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })

  it('Ctrl+Y triggers redo', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }))
    expect(mockRedo).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Shift+Z triggers redo', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true }))
    expect(mockRedo).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Shift+P navigates to contacts', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    expect(window.location.hash).toBe('#/contacts')
  })

  it('ignores the shortcuts of switched-off features', () => {
    setFeatures({ ...EXISTING_FEATURES, contactsDirectory: false, tasks: false })
    window.location.hash = ''
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true, bubbles: true }))
    expect(window.location.hash).toBe('')
    expect(setGlobalTaskOpen).not.toHaveBeenCalled()
  })

  it('Ctrl+Shift+T opens global task dialog', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true, bubbles: true }))
    expect(setGlobalTaskOpen).toHaveBeenCalledWith(true)
  })

  it('Ctrl+Shift+F toggles focus mode', () => {
    render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }))
    expect(mockSetFocusModeOpen).toHaveBeenCalledWith(true)
  })

  it('runs Pulse undo from the macOS menu bar', () => {
    renderHook(() => useGlobalKeyboard(vi.fn(), vi.fn(), vi.fn()))
    menuListeners.at(-1)!('undo')
    expect(mockUndo).toHaveBeenCalled()
  })
})
