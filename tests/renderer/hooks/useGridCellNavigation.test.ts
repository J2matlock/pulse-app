// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridCellNavigation } from '../../../src/renderer/hooks/useGridCellNavigation'
import type { Column } from '../../../src/shared/types'

function makeColumn(id: number): Column {
  return {
    id,
    grid_id: 1,
    name: `Col ${id}`,
    column_type: 'text',
    width: 100,
    position: id,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: 0,
    default_value: null,
    description: null,
    config: '{}',
    conditional_format: '[]',
    created_at: '2026-01-01',
  } as Column
}

const columns = [makeColumn(1), makeColumn(2), makeColumn(3)]
const rowIds = [10, 20, 30]

function setup() {
  const visualRowIdsRef = { current: rowIds }
  const containerRef = { current: document.createElement('div') }
  return renderHook(() =>
    useGridCellNavigation({ columns, visualRowIdsRef, containerRef })
  )
}

describe('useGridCellNavigation', () => {
  it('selectCell sets selection', () => {
    const { result } = setup()
    expect(result.current.selectedCell).toBeNull()

    act(() => result.current.selectCell(10, 1))
    expect(result.current.selectedCell).toEqual({ rowId: 10, columnId: 1 })
  })

  it('clearSelection clears selection', () => {
    const { result } = setup()
    act(() => result.current.selectCell(10, 1))
    act(() => result.current.clearSelection())
    expect(result.current.selectedCell).toBeNull()
  })

  it('navigateCell next-col moves right', () => {
    const { result } = setup()
    act(() => result.current.navigateCell(10, 1, 'next-col'))
    expect(result.current.selectedCell).toEqual({ rowId: 10, columnId: 2 })
  })

  it('navigateCell prev-col moves left', () => {
    const { result } = setup()
    act(() => result.current.navigateCell(10, 2, 'prev-col'))
    expect(result.current.selectedCell).toEqual({ rowId: 10, columnId: 1 })
  })

  it('navigateCell next-row moves down', () => {
    const { result } = setup()
    act(() => result.current.navigateCell(10, 1, 'next-row'))
    expect(result.current.selectedCell).toEqual({ rowId: 20, columnId: 1 })
  })

  it('navigateCell prev-row moves up', () => {
    const { result } = setup()
    act(() => result.current.navigateCell(20, 1, 'prev-row'))
    expect(result.current.selectedCell).toEqual({ rowId: 10, columnId: 1 })
  })

  it('wraps to next row when next-col at end of row', () => {
    const { result } = setup()
    // At col 3 (last), next-col should wrap to col 1, row 20
    act(() => result.current.navigateCell(10, 3, 'next-col'))
    expect(result.current.selectedCell).toEqual({ rowId: 20, columnId: 1 })
  })

  it('wraps to prev row when prev-col at start of row', () => {
    const { result } = setup()
    // At col 1 (first), prev-col should wrap to col 3, row 10
    act(() => result.current.navigateCell(20, 1, 'prev-col'))
    expect(result.current.selectedCell).toEqual({ rowId: 10, columnId: 3 })
  })

  it('clamps at grid boundaries (does not navigate past first/last row)', () => {
    const { result } = setup()
    // prev-row at first row — should not change
    act(() => result.current.navigateCell(10, 1, 'prev-row'))
    expect(result.current.selectedCell).toBeNull()
  })

  it('Home navigates to first column', () => {
    const { result } = setup()
    act(() => result.current.navigateCell(20, 3, 'first-col'))
    expect(result.current.selectedCell).toEqual({ rowId: 20, columnId: 1 })
  })

  it('End navigates to last column', () => {
    const { result } = setup()
    act(() => result.current.navigateCell(20, 1, 'last-col'))
    expect(result.current.selectedCell).toEqual({ rowId: 20, columnId: 3 })
  })

  it('handleNavigationKey handles Tab and Shift+Tab', () => {
    const { result } = setup()

    const tabEvent = { key: 'Tab', shiftKey: false } as React.KeyboardEvent
    let handled: boolean
    act(() => { handled = result.current.handleNavigationKey(tabEvent, 10, 1) })
    expect(handled!).toBe(true)
    expect(result.current.selectedCell).toEqual({ rowId: 10, columnId: 2 })

    const shiftTabEvent = { key: 'Tab', shiftKey: true } as React.KeyboardEvent
    act(() => { handled = result.current.handleNavigationKey(shiftTabEvent, 10, 2) })
    expect(handled!).toBe(true)
    expect(result.current.selectedCell).toEqual({ rowId: 10, columnId: 1 })
  })

  it('handleNavigationKey returns false for unhandled keys', () => {
    const { result } = setup()
    const event = { key: 'a', shiftKey: false } as React.KeyboardEvent
    let handled: boolean
    act(() => { handled = result.current.handleNavigationKey(event, 10, 1) })
    expect(handled!).toBe(false)
  })
})
