// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridCellNavigation, revealPastFrozen } from '../../../src/renderer/hooks/useGridCellNavigation'
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

  describe('the arrows stop at the edge; Tab wraps (persona study, Mark)', () => {
    it('prev-col with wrap: false at the first column stays put and says so', () => {
      const { result } = setup()
      let moved = true
      act(() => { moved = result.current.navigateCell(20, 1, 'prev-col', { wrap: false }) })
      expect(moved).toBe(false)
      expect(result.current.selectedCell).toBeNull()
    })

    it('next-col with wrap: false at the last column stays put', () => {
      const { result } = setup()
      let moved = true
      act(() => { moved = result.current.navigateCell(10, 3, 'next-col', { wrap: false }) })
      expect(moved).toBe(false)
    })

    it('ArrowLeft and ArrowRight through handleNavigationKey clamp, Shift+Tab still wraps', () => {
      const { result } = setup()
      act(() => { result.current.handleNavigationKey({ key: 'ArrowLeft' } as React.KeyboardEvent, 20, 1) })
      expect(result.current.selectedCell).toBeNull()
      act(() => { result.current.handleNavigationKey({ key: 'Tab', shiftKey: true } as React.KeyboardEvent, 20, 1) })
      expect(result.current.selectedCell).toEqual({ rowId: 10, columnId: 3 })
    })
  })

  describe('focus finds the cell again after the list redraws (persona study, Mark)', () => {
    function cellIn(container: HTMLElement, rowId: number, colId: number): HTMLElement {
      const row = document.createElement('div')
      row.setAttribute('role', 'row')
      const cell = document.createElement('div')
      cell.tabIndex = -1
      cell.setAttribute('data-row-id', String(rowId))
      cell.setAttribute('data-col-id', String(colId))
      row.appendChild(cell)
      container.appendChild(row)
      return cell
    }
    const frame = () => act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))) })

    it('looks the cell up by record and column after a frame, wherever the record moved', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const visualRowIdsRef = { current: [10, 20, 30] }
      const { result } = renderHook(() => useGridCellNavigation({ columns, visualRowIdsRef, containerRef: { current: container } }))
      act(() => { result.current.navigateCell(10, 1, 'next-row') })
      expect(result.current.selectedCell).toEqual({ rowId: 20, columnId: 1 })
      // The save re-sorted the list: 20 is now last, and only drawn there after the move
      visualRowIdsRef.current = [10, 30, 20]
      const moved = cellIn(container, 20, 1)
      await frame()
      await frame()
      expect(document.activeElement).toBe(moved)
      container.remove()
    })

    it('a record scrolled out of the drawn window is brought on screen, then focused', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const scrollTo = vi.fn((rowId: number) => { cellIn(container, rowId, 2) })
      const { result } = renderHook(() => useGridCellNavigation({
        columns, visualRowIdsRef: { current: rowIds }, containerRef: { current: container }, scrollToRowIdRef: { current: scrollTo },
      }))
      act(() => { result.current.focusCell(30, 2) })
      await frame()
      expect(scrollTo).toHaveBeenCalledWith(30)
      await frame()
      expect((document.activeElement as HTMLElement).getAttribute('data-row-id')).toBe('30')
      container.remove()
    })

    it('a cell under the columns kept in view is scrolled out from under them', () => {
      const container = document.createElement('div')
      const row = document.createElement('div')
      row.setAttribute('role', 'row')
      const frozen = document.createElement('div')
      frozen.style.position = 'sticky'
      frozen.getBoundingClientRect = () => ({ left: 0, right: 300 }) as DOMRect
      const cell = document.createElement('div')
      cell.getBoundingClientRect = () => ({ left: 220, right: 370 }) as DOMRect
      row.append(frozen, cell)
      container.appendChild(row)
      container.scrollLeft = 500
      revealPastFrozen(cell, container)
      expect(container.scrollLeft).toBe(420)
    })
  })
})
