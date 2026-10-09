/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridClipboard } from '../../../src/renderer/hooks/useGridClipboard'

describe('useGridClipboard', () => {
  it('starts with null clipboard', () => {
    const { result } = renderHook(() => useGridClipboard())
    expect(result.current.clipboard).toBeNull()
    expect(result.current.clipboardRef.current).toBeNull()
  })

  it('setClipboard updates clipboard value', () => {
    const { result } = renderHook(() => useGridClipboard())
    act(() => { result.current.setClipboard('hello') })
    expect(result.current.clipboard).toBe('hello')
  })

  it('clipboardRef stays in sync with clipboard state', () => {
    const { result } = renderHook(() => useGridClipboard())
    act(() => { result.current.setClipboard('test-value') })
    expect(result.current.clipboardRef.current).toBe('test-value')
  })

  it('setClipboard back to null clears clipboard', () => {
    const { result } = renderHook(() => useGridClipboard())
    act(() => { result.current.setClipboard('data') })
    expect(result.current.clipboard).toBe('data')
    act(() => { result.current.setClipboard(null) })
    expect(result.current.clipboard).toBeNull()
    expect(result.current.clipboardRef.current).toBeNull()
  })

  it('handles empty string as a valid clipboard value', () => {
    const { result } = renderHook(() => useGridClipboard())
    act(() => { result.current.setClipboard('') })
    expect(result.current.clipboard).toBe('')
  })

  it('multiple updates keep ref in sync', () => {
    const { result } = renderHook(() => useGridClipboard())
    act(() => { result.current.setClipboard('first') })
    act(() => { result.current.setClipboard('second') })
    act(() => { result.current.setClipboard('third') })
    expect(result.current.clipboard).toBe('third')
    expect(result.current.clipboardRef.current).toBe('third')
  })
})
