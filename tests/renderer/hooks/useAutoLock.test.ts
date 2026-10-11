/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock window.api before importing the hook
const mockInvoke = vi.fn().mockResolvedValue(undefined)
const mockOn = vi.fn().mockReturnValue(() => {/* unsub */})
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
})

// Mock settingsStore
const mockLock = vi.fn()
const mockSetLocked = vi.fn()
let passwordSetup = true
vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ lock: mockLock, setLocked: mockSetLocked, isPasswordSetup: passwordSetup }),
  },
}))

import { useAutoLock } from '../../../src/renderer/hooks/useAutoLock'

describe('useAutoLock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockLock.mockReset()
    mockSetLocked.mockReset()
    mockInvoke.mockClear()
    mockOn.mockClear()
    passwordSetup = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls lock after autoLockMinutes of inactivity', () => {
    renderHook(() => useAutoLock(false, true, 5))

    // Advance past 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(mockLock).toHaveBeenCalledTimes(1)
  })

  it('does not lock when already locked', () => {
    renderHook(() => useAutoLock(true, true, 5))

    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(mockLock).not.toHaveBeenCalled()
  })

  it('does not lock when password is not set up', () => {
    renderHook(() => useAutoLock(false, false, 5))

    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(mockLock).not.toHaveBeenCalled()
  })

  it('does not lock when autoLockMinutes is 0 (disabled)', () => {
    renderHook(() => useAutoLock(false, true, 0))

    vi.advanceTimersByTime(60 * 60 * 1000)

    expect(mockLock).not.toHaveBeenCalled()
  })

  it('resets timer on mousedown activity', () => {
    renderHook(() => useAutoLock(false, true, 5))

    // Advance 4 minutes
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(mockLock).not.toHaveBeenCalled()

    // Trigger activity
    window.dispatchEvent(new Event('mousedown'))

    // Advance 4 more minutes (timer should have reset)
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(mockLock).not.toHaveBeenCalled()

    // Advance past the full 5 minutes from the reset
    vi.advanceTimersByTime(1 * 60 * 1000)
    expect(mockLock).toHaveBeenCalledTimes(1)
  })

  it('resets timer on keydown activity', () => {
    renderHook(() => useAutoLock(false, true, 5))

    vi.advanceTimersByTime(4 * 60 * 1000)
    window.dispatchEvent(new Event('keydown'))

    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(mockLock).not.toHaveBeenCalled()
  })

  it('Ctrl+L triggers lock immediately', () => {
    renderHook(() => useAutoLock(false, true, 5))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))

    expect(mockLock).toHaveBeenCalled()
    expect(mockSetLocked).toHaveBeenCalledWith(true)
  })

  it('Ctrl+L does nothing before a password exists (audit F-33)', () => {
    passwordSetup = false
    renderHook(() => useAutoLock(false, false, 5))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))
    expect(mockLock).not.toHaveBeenCalled()
  })

  it('keeps the main-process timer from firing during password setup (audit F-33)', () => {
    renderHook(() => useAutoLock(false, false, 5))
    expect(mockInvoke).toHaveBeenCalledWith('auth:activity-ping')
    mockInvoke.mockClear()
    vi.advanceTimersByTime(31_000)
    window.dispatchEvent(new MouseEvent('mousedown'))
    expect(mockInvoke).toHaveBeenCalledWith('auth:activity-ping')
    expect(mockLock).not.toHaveBeenCalled()
  })

  it('cleans up listeners on unmount', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useAutoLock(false, true, 5))

    unmount()

    // Should have removed mousedown, keydown, touchstart, wheel, pointermove, and Ctrl+L keydown
    const removedEvents = removeListenerSpy.mock.calls.map(c => c[0])
    expect(removedEvents).toContain('mousedown')
    expect(removedEvents).toContain('keydown')
    expect(removedEvents).toContain('pointermove')
    removeListenerSpy.mockRestore()
  })

  it('saves pending edits and answers when the main process is about to close the database', async () => {
    const { pulseEvents } = await import('../../../src/renderer/events')
    const locking = vi.fn()
    const off = pulseEvents.on('app:locking', locking)
    renderHook(() => useAutoLock(false, true, 5))
    const call = mockOn.mock.calls.find(c => c[0] === 'app:flush-pending')
    expect(call).toBeDefined()

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const blurred = vi.fn()
    input.addEventListener('blur', blurred)

    mockInvoke.mockClear()
    ;(call![1] as () => void)()
    expect(blurred).toHaveBeenCalledTimes(1)
    expect(locking).toHaveBeenCalledTimes(1)
    expect(mockInvoke).not.toHaveBeenCalledWith('app:flush-done')
    vi.advanceTimersByTime(200)
    expect(mockInvoke).toHaveBeenCalledWith('app:flush-done')
    off()
    input.remove()
  })
})
