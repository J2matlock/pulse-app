/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridContextMenu } from '../../../src/renderer/hooks/useGridContextMenu'

describe('useGridContextMenu', () => {
  it('starts with null contextMenu', () => {
    const { result } = renderHook(() => useGridContextMenu())
    expect(result.current.contextMenu).toBeNull()
  })

  it('handleCellContextMenu sets context menu state', () => {
    const { result } = renderHook(() => useGridContextMenu())
    const mockEvent = {
      preventDefault: () => {},
      clientX: 100,
      clientY: 200,
    } as React.MouseEvent

    act(() => { result.current.handleCellContextMenu(mockEvent, 5, 10) })
    expect(result.current.contextMenu).toEqual({ x: 100, y: 200, rowId: 5, colId: 10 })
  })

  it('handleCellContextMenu calls preventDefault', () => {
    const { result } = renderHook(() => useGridContextMenu())
    const preventDefault = vi.fn()
    const mockEvent = { preventDefault, clientX: 0, clientY: 0 } as unknown as React.MouseEvent

    act(() => { result.current.handleCellContextMenu(mockEvent, 1, 2) })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('closeContextMenu resets to null', () => {
    const { result } = renderHook(() => useGridContextMenu())
    const mockEvent = { preventDefault: () => {}, clientX: 50, clientY: 60 } as React.MouseEvent

    act(() => { result.current.handleCellContextMenu(mockEvent, 3, 4) })
    expect(result.current.contextMenu).not.toBeNull()

    act(() => { result.current.closeContextMenu() })
    expect(result.current.contextMenu).toBeNull()
  })

  it('setContextMenu allows direct state manipulation', () => {
    const { result } = renderHook(() => useGridContextMenu())

    act(() => { result.current.setContextMenu({ x: 10, y: 20, rowId: 1, colId: 2 }) })
    expect(result.current.contextMenu).toEqual({ x: 10, y: 20, rowId: 1, colId: 2 })

    act(() => { result.current.setContextMenu(null) })
    expect(result.current.contextMenu).toBeNull()
  })

  it('opening a new context menu replaces the old one', () => {
    const { result } = renderHook(() => useGridContextMenu())
    const event1 = { preventDefault: () => {}, clientX: 10, clientY: 20 } as React.MouseEvent
    const event2 = { preventDefault: () => {}, clientX: 30, clientY: 40 } as React.MouseEvent

    act(() => { result.current.handleCellContextMenu(event1, 1, 1) })
    act(() => { result.current.handleCellContextMenu(event2, 2, 2) })
    expect(result.current.contextMenu).toEqual({ x: 30, y: 40, rowId: 2, colId: 2 })
  })
})
