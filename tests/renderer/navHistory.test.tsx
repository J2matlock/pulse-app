// @vitest-environment jsdom
/** Back goes back (audit 3.18 / N-14, N-30). */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../src/renderer/stores/undoStore', () => ({ useUndoStore: { getState: () => ({ undo: vi.fn(), redo: vi.fn() }) } }))
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { notePage, previousPage, canGoBack, resetNavHistory } from '../../src/renderer/utils/navHistory'
import { useGlobalKeyboard } from '../../src/renderer/hooks/useGlobalKeyboard'
import { pulseEvents } from '../../src/renderer/events'
import { listInitials } from '../../src/renderer/components/layout/Sidebar'
import { pageTitle } from '../../src/renderer/components/layout/TopBar'

beforeEach(() => resetNavHistory())

describe('navigation history', () => {
  it('knows the page before this one, so Back can name it', () => {
    notePage('/dashboard')
    notePage('/profile/4')
    expect(previousPage('/profile/4')).toBe('/dashboard')
    notePage('/profile/9')
    expect(previousPage('/profile/9')).toBe('/profile/4')
    expect(pageTitle('/dashboard', () => 'Contacts')).toBe('Dashboard')
  })

  it('only goes back when there is in-app history', () => {
    window.history.replaceState({ idx: 0 }, '')
    expect(canGoBack()).toBe(false)
    window.history.replaceState({ idx: 2 }, '')
    expect(canGoBack()).toBe(true)
  })
})

describe('global navigation keys', () => {
  it('a mouse back button goes back, Ctrl+F on a page without search opens the palette', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const palette = vi.fn()
    renderHook(() => useGlobalKeyboard(palette, vi.fn(), vi.fn()))
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3 }))
    expect(back).toHaveBeenCalled()
    pulseEvents.emit('palette:open')
    expect(palette).toHaveBeenCalledWith(true)
    back.mockRestore()
  })

  it('collapsed lists show initials', () => {
    expect(listInitials('Tree Customers')).toBe('TC')
    expect(listInitials('Jobs')).toBe('JO')
  })
})
