/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock window.api.copyToClipboard
const mockCopyToClipboard = vi.fn().mockResolvedValue({ ok: true, data: true })
Object.defineProperty(window, 'api', {
  value: { copyToClipboard: mockCopyToClipboard },
  writable: true,
  configurable: true,
})

const toastError = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }))

import { useCopyFeedback, useCopyFeedbackKeyed, COPY_FEEDBACK_MS } from '../../../src/renderer/hooks/useCopyFeedback'

describe('useCopyFeedback (simple)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCopyToClipboard.mockReset().mockResolvedValue({ ok: true, data: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with copied = false', () => {
    const { result } = renderHook(() => useCopyFeedback())
    expect(result.current.copied).toBe(false)
  })

  it('sets copied to true after copyToClipboard', async () => {
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copyToClipboard('hello')
    })

    expect(result.current.copied).toBe(true)
    expect(mockCopyToClipboard).toHaveBeenCalledWith('hello')
  })

  it('resets copied to false after COPY_FEEDBACK_MS', async () => {
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copyToClipboard('test')
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS)
    })
    expect(result.current.copied).toBe(false)
  })

  it('resetCopied immediately clears the copied state', async () => {
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copyToClipboard('test')
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      result.current.resetCopied()
    })
    expect(result.current.copied).toBe(false)
  })

  it('handles clipboard failure gracefully', async () => {
    mockCopyToClipboard.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copyToClipboard('fail')
    })
    // Should remain false since the copy threw
    expect(result.current.copied).toBe(false)
  })

  it('does not say copied, and says why, when main refused the copy', async () => {
    mockCopyToClipboard.mockResolvedValueOnce({ ok: false, error: 'Clipboard content too large' })
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copyToClipboard('x'.repeat(10))
    })
    expect(result.current.copied).toBe(false)
    expect(toastError).toHaveBeenCalledWith('Clipboard content too large')
  })

  it('clears timeout on unmount', async () => {
    const { result, unmount } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copyToClipboard('test')
    })

    unmount()
    // Should not throw when timer fires after unmount
    vi.advanceTimersByTime(COPY_FEEDBACK_MS)
  })
})

describe('useCopyFeedbackKeyed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCopyToClipboard.mockReset().mockResolvedValue({ ok: true, data: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with copiedKey = null', () => {
    const { result } = renderHook(() => useCopyFeedbackKeyed())
    expect(result.current.copiedKey).toBe(null)
  })

  it('tracks which field was copied via key', async () => {
    const { result } = renderHook(() => useCopyFeedbackKeyed<string>())

    await act(async () => {
      await result.current.copyToClipboard('email@test.com', 'email')
    })

    expect(result.current.copiedKey).toBe('email')
  })

  it('resets copiedKey after COPY_FEEDBACK_MS', async () => {
    const { result } = renderHook(() => useCopyFeedbackKeyed<string>())

    await act(async () => {
      await result.current.copyToClipboard('value', 'phone')
    })
    expect(result.current.copiedKey).toBe('phone')

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS)
    })
    expect(result.current.copiedKey).toBe(null)
  })

  it('resetCopied clears the keyed state', async () => {
    const { result } = renderHook(() => useCopyFeedbackKeyed<string>())

    await act(async () => {
      await result.current.copyToClipboard('val', 'name')
    })

    act(() => {
      result.current.resetCopied()
    })
    expect(result.current.copiedKey).toBe(null)
  })
})
