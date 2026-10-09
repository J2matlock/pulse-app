/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock react-router-dom's useBlocker — factory must not reference outer variables
vi.mock('react-router-dom', () => ({
  useBlocker: vi.fn().mockReturnValue({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() }),
}))

import { useUnsavedChanges } from '../../../src/renderer/hooks/useUnsavedChanges'
import { useBlocker } from 'react-router-dom'

describe('useUnsavedChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useBlocker).mockReturnValue({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() } as never)
  })

  it('returns a blocker object', () => {
    const { result } = renderHook(() => useUnsavedChanges(false))
    expect(result.current.blocker).toBeDefined()
  })

  it('calls useBlocker with a function', () => {
    renderHook(() => useUnsavedChanges(true))
    expect(useBlocker).toHaveBeenCalledWith(expect.any(Function))
  })

  it('blocker function blocks when dirty and paths differ', () => {
    renderHook(() => useUnsavedChanges(true))
    const blockerFn = vi.mocked(useBlocker).mock.calls[0]![0] as (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => boolean
    const shouldBlock = blockerFn({
      currentLocation: { pathname: '/grid/1' },
      nextLocation: { pathname: '/grid/2' },
    })
    expect(shouldBlock).toBe(true)
  })

  it('blocker function does not block when not dirty', () => {
    renderHook(() => useUnsavedChanges(false))
    const blockerFn = vi.mocked(useBlocker).mock.calls[0]![0] as (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => boolean
    const shouldBlock = blockerFn({
      currentLocation: { pathname: '/grid/1' },
      nextLocation: { pathname: '/grid/2' },
    })
    expect(shouldBlock).toBe(false)
  })

  it('blocker function does not block when paths are the same', () => {
    renderHook(() => useUnsavedChanges(true))
    const blockerFn = vi.mocked(useBlocker).mock.calls[0]![0] as (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => boolean
    const shouldBlock = blockerFn({
      currentLocation: { pathname: '/grid/1' },
      nextLocation: { pathname: '/grid/1' },
    })
    expect(shouldBlock).toBe(false)
  })

  it('registers beforeunload listener when dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedChanges(true))
    const beforeunloadCalls = addSpy.mock.calls.filter(c => c[0] === 'beforeunload')
    expect(beforeunloadCalls.length).toBe(1)
    addSpy.mockRestore()
  })

  it('does not register beforeunload listener when not dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedChanges(false))
    const beforeunloadCalls = addSpy.mock.calls.filter(c => c[0] === 'beforeunload')
    expect(beforeunloadCalls.length).toBe(0)
    addSpy.mockRestore()
  })

  it('removes beforeunload listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useUnsavedChanges(true))
    unmount()
    const removedEvents = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload')
    expect(removedEvents.length).toBe(1)
    removeSpy.mockRestore()
  })

  it('beforeunload handler calls preventDefault', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedChanges(true))
    const handler = addSpy.mock.calls.find(c => c[0] === 'beforeunload')![1] as EventListener
    const event = new Event('beforeunload') as BeforeUnloadEvent
    Object.defineProperty(event, 'returnValue', { writable: true, value: '' })
    const preventSpy = vi.spyOn(event, 'preventDefault')
    handler(event)
    expect(preventSpy).toHaveBeenCalled()
    addSpy.mockRestore()
  })
})
