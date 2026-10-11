// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridEditing } from '../../../src/renderer/hooks/useGridEditing'

describe('useGridEditing', () => {
  it('starts with no editing cell and isEditing=false', () => {
    const { result } = renderHook(() =>
      useGridEditing({ onCellUpdate: vi.fn() })
    )
    expect(result.current.editingCell).toBeNull()
    expect(result.current.isEditing).toBe(false)
  })

  it('startEditing sets editingCell', () => {
    const { result } = renderHook(() =>
      useGridEditing({ onCellUpdate: vi.fn() })
    )
    act(() => result.current.startEditing(1, 2))
    expect(result.current.editingCell).toEqual({ rowId: 1, columnId: 2 })
    expect(result.current.isEditing).toBe(true)
  })

  it('stopEditing clears editingCell', () => {
    const { result } = renderHook(() =>
      useGridEditing({ onCellUpdate: vi.fn() })
    )
    act(() => result.current.startEditing(1, 2))
    act(() => result.current.stopEditing())
    expect(result.current.editingCell).toBeNull()
    expect(result.current.isEditing).toBe(false)
  })

  it('handleCellSave calls onCellUpdate then clears editing', async () => {
    const onCellUpdate = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGridEditing({ onCellUpdate })
    )

    act(() => result.current.startEditing(5, 10))

    await act(async () => {
      await result.current.handleCellSave(5, 10, 'new value')
    })

    expect(onCellUpdate).toHaveBeenCalledWith(5, 10, 'new value')
    expect(result.current.editingCell).toBeNull()
    expect(result.current.isEditing).toBe(false)
  })

  it('handleCellSave does not clear editing if a different cell is active', async () => {
    const onCellUpdate = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGridEditing({ onCellUpdate })
    )

    act(() => result.current.startEditing(5, 10))
    // Simulate user clicking another cell before save completes
    act(() => result.current.startEditing(6, 11))

    await act(async () => {
      await result.current.handleCellSave(5, 10, 'old value')
    })

    // Should still be editing cell (6, 11)
    expect(result.current.editingCell).toEqual({ rowId: 6, columnId: 11 })
  })

  it('editingCellRef reflects current state', () => {
    const { result } = renderHook(() =>
      useGridEditing({ onCellUpdate: vi.fn() })
    )
    expect(result.current.editingCellRef.current).toBeNull()

    act(() => result.current.startEditing(3, 7))
    expect(result.current.editingCellRef.current).toEqual({ rowId: 3, columnId: 7 })
  })
})
