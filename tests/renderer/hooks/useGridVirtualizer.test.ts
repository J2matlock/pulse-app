// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGridVirtualizer } from '../../../src/renderer/hooks/useGridVirtualizer'

function makeParentRef() {
  const div = document.createElement('div')
  // Give it dimensions so the virtualizer can compute
  Object.defineProperty(div, 'clientHeight', { value: 500 })
  Object.defineProperty(div, 'scrollHeight', { value: 500 })
  Object.defineProperty(div, 'getBoundingClientRect', {
    value: () => ({ top: 0, left: 0, bottom: 500, right: 800, width: 800, height: 500 }),
  })
  return { current: div }
}

describe('useGridVirtualizer', () => {
  it('returns a virtualizer object with expected properties', () => {
    const parentRef = makeParentRef()
    const { result } = renderHook(() =>
      useGridVirtualizer({ parentRef, count: 100, rowHeight: 44 })
    )
    expect(result.current.virtualizer).toBeDefined()
    expect(result.current.totalSize).toBe(100 * 44)
    expect(typeof result.current.scrollToRow).toBe('function')
    expect(typeof result.current.paddingTop).toBe('number')
    expect(typeof result.current.paddingBottom).toBe('number')
  })

  it('returns empty virtualRows when count is 0', () => {
    const parentRef = makeParentRef()
    const { result } = renderHook(() =>
      useGridVirtualizer({ parentRef, count: 0, rowHeight: 44 })
    )
    expect(result.current.virtualRows).toHaveLength(0)
    expect(result.current.totalSize).toBe(0)
    expect(result.current.paddingTop).toBe(0)
    expect(result.current.paddingBottom).toBe(0)
  })

  it('uses correct estimateSize based on rowHeight', () => {
    const parentRef = makeParentRef()
    const { result } = renderHook(() =>
      useGridVirtualizer({ parentRef, count: 10, rowHeight: 60 })
    )
    // totalSize = count * rowHeight
    expect(result.current.totalSize).toBe(10 * 60)
  })

  it('enabled=false results in no virtualization', () => {
    const parentRef = makeParentRef()
    const { result } = renderHook(() =>
      useGridVirtualizer({ parentRef, count: 100, rowHeight: 44, enabled: false })
    )
    // When disabled, count passed to virtualizer is 0
    expect(result.current.virtualRows).toHaveLength(0)
    expect(result.current.totalSize).toBe(0)
  })
})

describe('items of different heights (AUDIT-132)', () => {
  it('adds up each item at its own height, and again when the heights move', () => {
    const parentRef = makeParentRef()
    const headersAt = (set: Set<number>) => (i: number) => set.has(i) ? 44 : 52
    const { result, rerender } = renderHook(({ sizeOf }) =>
      useGridVirtualizer({ parentRef, count: 10, rowHeight: 52, sizeOf }),
    { initialProps: { sizeOf: headersAt(new Set([0, 5])) } })
    expect(result.current.totalSize).toBe(2 * 44 + 8 * 52)
    rerender({ sizeOf: headersAt(new Set([0, 3, 6])) })
    expect(result.current.totalSize).toBe(3 * 44 + 7 * 52)
  })

  it('counts the space above the list without padding it twice', () => {
    const parentRef = makeParentRef()
    Object.defineProperty(parentRef.current, 'offsetHeight', { value: 500 })
    Object.defineProperty(parentRef.current, 'offsetWidth', { value: 800 })
    const { result } = renderHook(() =>
      useGridVirtualizer({ parentRef, count: 100, rowHeight: 44, scrollMargin: 37 }),
    )
    expect(result.current.totalSize).toBe(100 * 44)
    expect(result.current.virtualRows[0]?.start).toBe(37)
    expect(result.current.paddingTop).toBe(0)
  })
})
