/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'

// Mock gridStore
let mockSelectedRowIds = new Set<number>()
const mockSetSelectedRowIds = vi.fn((updater: Set<number> | ((prev: Set<number>) => Set<number>)) => {
  if (typeof updater === 'function') {
    mockSelectedRowIds = updater(mockSelectedRowIds)
  } else {
    mockSelectedRowIds = updater
  }
})

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}))

vi.mock('../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (selector: (s: { selectedRowIds: Set<number>; setSelectedRowIds: typeof mockSetSelectedRowIds }) => unknown) =>
    selector({ selectedRowIds: mockSelectedRowIds, setSelectedRowIds: mockSetSelectedRowIds }),
}))

import { useGridSelection } from '../../../src/renderer/hooks/useGridSelection'

function createMouseEvent(overrides: Partial<React.MouseEvent> = {}): React.MouseEvent {
  return {
    stopPropagation: vi.fn(),
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  } as unknown as React.MouseEvent
}

describe('useGridSelection', () => {
  const visualRowIdsRef = { current: [10, 20, 30, 40, 50] } as React.RefObject<number[]>

  beforeEach(() => {
    mockSelectedRowIds = new Set()
    mockSetSelectedRowIds.mockClear()
  })

  it('returns selectedRowIds from store', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))
    expect(result.current.selectedRowIds).toBeInstanceOf(Set)
    expect(result.current.selectedRowIds.size).toBe(0)
  })

  it('plain click selects a single row', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))
    const event = createMouseEvent()
    act(() => { result.current.handleToggleRowSelect(event, 20) })
    expect(mockSetSelectedRowIds).toHaveBeenCalled()
    // Verify by calling the updater
    const updater = mockSetSelectedRowIds.mock.calls[0]![0] as (prev: Set<number>) => Set<number>
    const newSet = updater(new Set())
    expect(newSet.has(20)).toBe(true)
    expect(newSet.size).toBe(1)
  })

  it('plain click on selected row (sole selection) deselects it', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))
    const event = createMouseEvent()
    act(() => { result.current.handleToggleRowSelect(event, 20) })
    const updater = mockSetSelectedRowIds.mock.calls[0]![0] as (prev: Set<number>) => Set<number>
    const result1 = updater(new Set([20]))
    expect(result1.has(20)).toBe(false)
  })

  it('ctrl+click toggles individual row selection', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))
    const event = createMouseEvent({ ctrlKey: true })

    act(() => { result.current.handleToggleRowSelect(event, 20) })
    const updater = mockSetSelectedRowIds.mock.calls[0]![0] as (prev: Set<number>) => Set<number>
    // Adding to empty set
    const added = updater(new Set())
    expect(added.has(20)).toBe(true)
    // Removing existing
    const removed = updater(new Set([20]))
    expect(removed.has(20)).toBe(false)
  })

  it('meta+click toggles individual row selection', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))
    const event = createMouseEvent({ metaKey: true })

    act(() => { result.current.handleToggleRowSelect(event, 30) })
    const updater = mockSetSelectedRowIds.mock.calls[0]![0] as (prev: Set<number>) => Set<number>
    const added = updater(new Set())
    expect(added.has(30)).toBe(true)
  })

  it('shift+click selects range between last and current', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))

    // First, plain click to set lastSelectedIndex
    act(() => { result.current.handleToggleRowSelect(createMouseEvent(), 10) })

    // Then shift+click on row 40
    const shiftEvent = createMouseEvent({ shiftKey: true })
    act(() => { result.current.handleToggleRowSelect(shiftEvent, 40) })

    const updater = mockSetSelectedRowIds.mock.calls[1]![0] as (prev: Set<number>) => Set<number>
    const selected = updater(new Set())
    // Should include rows at indices 0..3 (10, 20, 30, 40)
    expect(selected.has(10)).toBe(true)
    expect(selected.has(20)).toBe(true)
    expect(selected.has(30)).toBe(true)
    expect(selected.has(40)).toBe(true)
    expect(selected.has(50)).toBe(false)
  })

  it('stopPropagation is called on click', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))
    const event = createMouseEvent()
    act(() => { result.current.handleToggleRowSelect(event, 10) })
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('exposes the Shift+click starting record, empty at first', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))
    expect(result.current.anchorRowIdRef).toBeDefined()
    expect(result.current.anchorRowIdRef.current).toBeNull()
  })

  it('a Shift+click range starts at the clicked record after a re-sort moves it (AUDIT-131)', () => {
    const ids = { current: [10, 20, 30, 40, 50] } as React.RefObject<number[]>
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef: ids, activeGridId: 1 }))
    act(() => { result.current.handleToggleRowSelect(createMouseEvent(), 20) })
    // A new sort puts record 20 last
    ids.current = [50, 40, 30, 10, 20]
    act(() => { result.current.handleToggleRowSelect(createMouseEvent({ shiftKey: true }), 30) })
    const updater = mockSetSelectedRowIds.mock.calls[1]![0] as (prev: Set<number>) => Set<number>
    expect([...updater(new Set())].sort()).toEqual([10, 20, 30])
  })

  it('switching lists forgets the Shift+click starting point (AUDIT-131)', () => {
    const { result, rerender } = renderHook(({ gridId }) => useGridSelection({ visualRowIdsRef, activeGridId: gridId }), { initialProps: { gridId: 1 } })
    act(() => { result.current.handleToggleRowSelect(createMouseEvent(), 50) })
    rerender({ gridId: 2 })
    act(() => { result.current.handleToggleRowSelect(createMouseEvent({ shiftKey: true }), 20) })
    const updater = mockSetSelectedRowIds.mock.calls[1]![0] as (prev: Set<number>) => Set<number>
    expect([...updater(new Set())]).toEqual([20])
  })

  it('exposes selectedRowIdsRef', () => {
    const { result } = renderHook(() => useGridSelection({ visualRowIdsRef, activeGridId: 1 }))
    expect(result.current.selectedRowIdsRef).toBeDefined()
  })
})
