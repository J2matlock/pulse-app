/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useModalManager } from '../../../src/renderer/hooks/useModalManager'

describe('useModalManager', () => {
  it('all modals default to closed/false/null', () => {
    const { result } = renderHook(() => useModalManager())
    expect(result.current.showTour).toBe(false)
    expect(result.current.commandPaletteOpen).toBe(false)
    expect(result.current.shortcutsOpen).toBe(false)
    expect(result.current.whatsNewOpen).toBe(false)
    expect(result.current.miniTourSteps).toBeNull()
    expect(result.current.globalTaskOpen).toBe(false)
  })

  it('setShowTour toggles tour state', () => {
    const { result } = renderHook(() => useModalManager())
    act(() => { result.current.setShowTour(true) })
    expect(result.current.showTour).toBe(true)
    act(() => { result.current.setShowTour(false) })
    expect(result.current.showTour).toBe(false)
  })

  it('the first look starts closed and toggles (UX pass Q7)', () => {
    const { result } = renderHook(() => useModalManager())
    expect(result.current.firstLook).toBe(false)
    act(() => { result.current.setFirstLook(true) })
    expect(result.current.firstLook).toBe(true)
    act(() => { result.current.setFirstLook(false) })
    expect(result.current.firstLook).toBe(false)
  })

  it('setCommandPaletteOpen toggles command palette', () => {
    const { result } = renderHook(() => useModalManager())
    act(() => { result.current.setCommandPaletteOpen(true) })
    expect(result.current.commandPaletteOpen).toBe(true)
  })

  it('setShortcutsOpen toggles shortcuts modal', () => {
    const { result } = renderHook(() => useModalManager())
    act(() => { result.current.setShortcutsOpen(true) })
    expect(result.current.shortcutsOpen).toBe(true)
  })

  it('setWhatsNewOpen toggles whats new modal', () => {
    const { result } = renderHook(() => useModalManager())
    act(() => { result.current.setWhatsNewOpen(true) })
    expect(result.current.whatsNewOpen).toBe(true)
  })

  it('setMiniTourSteps sets tour steps array', () => {
    const { result } = renderHook(() => useModalManager())
    const steps = [{ targetSelector: '.test', title: 'Step 1', content: 'Do this' }]
    act(() => { result.current.setMiniTourSteps(steps) })
    expect(result.current.miniTourSteps).toEqual(steps)
  })

  it('setMiniTourSteps can be cleared back to null', () => {
    const { result } = renderHook(() => useModalManager())
    const steps = [{ targetSelector: '.test', title: 'Step 1', content: 'Do this' }]
    act(() => { result.current.setMiniTourSteps(steps) })
    act(() => { result.current.setMiniTourSteps(null) })
    expect(result.current.miniTourSteps).toBeNull()
  })

  it('setGlobalTaskOpen toggles global task modal', () => {
    const { result } = renderHook(() => useModalManager())
    act(() => { result.current.setGlobalTaskOpen(true) })
    expect(result.current.globalTaskOpen).toBe(true)
    act(() => { result.current.setGlobalTaskOpen(false) })
    expect(result.current.globalTaskOpen).toBe(false)
  })

  it('modals are independent of each other', () => {
    const { result } = renderHook(() => useModalManager())
    act(() => {
      result.current.setShowTour(true)
      result.current.setCommandPaletteOpen(true)
    })
    expect(result.current.showTour).toBe(true)
    expect(result.current.commandPaletteOpen).toBe(true)
    expect(result.current.shortcutsOpen).toBe(false)
    expect(result.current.globalTaskOpen).toBe(false)
  })
})
