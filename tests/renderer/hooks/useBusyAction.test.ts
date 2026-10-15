// @vitest-environment jsdom
/**
 * useBusyAction (Q6): busy from the click, a spinner flag only at 300 ms,
 * one run at a time, and a failure clears busy.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBusyAction, useDelayedFlag } from '../../../src/renderer/hooks/useBusyAction'
import { SPINNER_AFTER_MS } from '../../../src/shared/constants'

afterEach(() => { vi.useRealTimers() })

function deferred() {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useBusyAction', () => {
  it('is busy at once and shows the spinner at 300 ms, not 299', async () => {
    vi.useFakeTimers()
    expect(SPINNER_AFTER_MS).toBe(300)
    const d = deferred()
    const { result } = renderHook(() => useBusyAction(() => d.promise))
    let run!: Promise<void>
    act(() => { run = result.current[0]() })
    expect(result.current[1].busy).toBe(true)
    expect(result.current[1].showSpinner).toBe(false)
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current[1].showSpinner).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current[1].showSpinner).toBe(true)
    await act(async () => { d.resolve(); await run })
    expect(result.current[1].busy).toBe(false)
    expect(result.current[1].showSpinner).toBe(false)
  })

  it('runs once when clicked twice while busy', async () => {
    const d = deferred()
    const fn = vi.fn(() => d.promise)
    const { result } = renderHook(() => useBusyAction(fn))
    let first!: Promise<void>
    act(() => { first = result.current[0](); void result.current[0]() })
    expect(fn).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve(); await first })
    act(() => { void result.current[0]() })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('a failure clears busy and goes back to the caller', async () => {
    const d = deferred()
    const { result } = renderHook(() => useBusyAction(() => d.promise))
    let run!: Promise<void>
    act(() => { run = result.current[0]() })
    expect(result.current[1].busy).toBe(true)
    await act(async () => {
      d.reject(new Error('nope'))
      await expect(run).rejects.toThrow('nope')
    })
    expect(result.current[1].busy).toBe(false)
  })

  it('a plain function never sets busy', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useBusyAction(fn))
    act(() => { void result.current[0]() })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(result.current[1].busy).toBe(false)
  })

  it('calls the latest function it was given', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const { result, rerender } = renderHook(({ fn }) => useBusyAction(fn), { initialProps: { fn: a } })
    rerender({ fn: b })
    act(() => { void result.current[0]() })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })
})

describe('useDelayedFlag', () => {
  it('goes false at once when the flag drops', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ on }) => useDelayedFlag(on, 300), { initialProps: { on: true } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe(true)
    rerender({ on: false })
    expect(result.current).toBe(false)
  })
})
