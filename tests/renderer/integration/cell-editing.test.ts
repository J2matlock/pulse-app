// @vitest-environment jsdom
/**
 * Integration tests for the cell editing state machine (useGridEditing hook).
 * Addresses recurring regression pattern — 5/20 recent commits fixed cell editing.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridEditing, type CellUpdateFn } from '../../../src/renderer/hooks/useGridEditing'

function setup(opts: { onCellUpdate?: CellUpdateFn } = {}) {
  const onCellUpdate = opts.onCellUpdate ?? vi.fn<CellUpdateFn>()
  return renderHook(() =>
    useGridEditing({
      onCellUpdate,
    }),
  )
}

describe('cell editing state machine', () => {
  // --- Scenario 1: Single click selects cell (no edit mode) ---
  describe('selection without editing', () => {
    it('starts with no cell editing', () => {
      const { result } = setup()
      expect(result.current.editingCell).toBeNull()
      expect(result.current.isEditing).toBe(false)
    })

    it('setEditingCell(null) keeps no edit state (simulates single-click select)', () => {
      const { result } = setup()
      act(() => result.current.setEditingCell(null))
      expect(result.current.editingCell).toBeNull()
      expect(result.current.isEditing).toBe(false)
    })
  })

  // --- Scenario 2: Double click enters edit mode ---
  describe('double click enters edit mode', () => {
    it('setEditingCell with coord enters edit mode', () => {
      const { result } = setup()
      act(() => result.current.setEditingCell({ rowId: 1, columnId: 10 }))
      expect(result.current.editingCell).toEqual({ rowId: 1, columnId: 10 })
      expect(result.current.isEditing).toBe(true)
    })
  })

  // --- Scenario 3: F2 enters edit mode on selected cell ---
  describe('F2 enters edit mode (startEditing)', () => {
    it('startEditing sets the editing cell', () => {
      const { result } = setup()
      act(() => result.current.startEditing(5, 20))
      expect(result.current.editingCell).toEqual({ rowId: 5, columnId: 20 })
      expect(result.current.isEditing).toBe(true)
    })

  })

  // --- Scenario 4: Escape cancels edit (reverts value) ---
  describe('escape cancels edit (stopEditing)', () => {
    it('stopEditing clears editing cell without calling onCellUpdate', () => {
      const onCellUpdate = vi.fn()
      const { result } = setup({ onCellUpdate })
      act(() => result.current.startEditing(1, 2))
      expect(result.current.isEditing).toBe(true)

      act(() => result.current.stopEditing())
      expect(result.current.editingCell).toBeNull()
      expect(result.current.isEditing).toBe(false)
      expect(onCellUpdate).not.toHaveBeenCalled()
    })
  })

  // --- Scenario 5: Tab during edit saves and moves to next cell ---
  describe('tab saves and moves to next cell', () => {
    it('handleCellSave saves current cell then startEditing moves to next', async () => {
      const onCellUpdate = vi.fn<CellUpdateFn>()
      const { result } = setup({ onCellUpdate })

      act(() => result.current.startEditing(1, 10))
      expect(result.current.isEditing).toBe(true)

      // Simulate Tab: save current cell
      await act(async () => {
        await result.current.handleCellSave(1, 10, 'saved value')
      })
      expect(onCellUpdate).toHaveBeenCalledWith(1, 10, 'saved value')
      expect(result.current.editingCell).toBeNull()

      // Then move to next cell (Tab handler would call startEditing)
      act(() => result.current.startEditing(1, 11))
      expect(result.current.editingCell).toEqual({ rowId: 1, columnId: 11 })
    })
  })

  // --- Scenario 6: Enter during edit saves and moves down ---
  describe('enter saves and moves down', () => {
    it('handleCellSave saves then startEditing moves to next row', async () => {
      const onCellUpdate = vi.fn<CellUpdateFn>()
      const { result } = setup({ onCellUpdate })

      act(() => result.current.startEditing(1, 5))

      // Save current
      await act(async () => {
        await result.current.handleCellSave(1, 5, 'new val')
      })
      expect(onCellUpdate).toHaveBeenCalledWith(1, 5, 'new val')
      expect(result.current.editingCell).toBeNull()

      // Move down (Enter handler calls startEditing on next row)
      act(() => result.current.startEditing(2, 5))
      expect(result.current.editingCell).toEqual({ rowId: 2, columnId: 5 })
    })
  })

  // --- Scenario 7: Click outside during edit saves ---
  describe('click outside during edit saves', () => {
    it('handleCellSave clears editing state (click-outside handler)', async () => {
      const onCellUpdate = vi.fn<CellUpdateFn>()
      const { result } = setup({ onCellUpdate })

      act(() => result.current.startEditing(3, 7))
      expect(result.current.isEditing).toBe(true)

      await act(async () => {
        await result.current.handleCellSave(3, 7, 'auto-saved')
      })
      expect(onCellUpdate).toHaveBeenCalledWith(3, 7, 'auto-saved')
      expect(result.current.editingCell).toBeNull()
      expect(result.current.isEditing).toBe(false)
    })
  })

  // --- Additional edge cases ---
  describe('edge cases', () => {

    it('handleCellSave does not clear editing if a different cell is now active (race guard)', async () => {
      const onCellUpdate = vi.fn<CellUpdateFn>()
      const { result } = setup({ onCellUpdate })

      act(() => result.current.startEditing(1, 1))

      // User clicks another cell before save completes
      act(() => result.current.startEditing(2, 2))
      expect(result.current.editingCell).toEqual({ rowId: 2, columnId: 2 })

      // Old save resolves — should NOT clear the new cell
      await act(async () => {
        await result.current.handleCellSave(1, 1, 'old value')
      })
      expect(onCellUpdate).toHaveBeenCalledWith(1, 1, 'old value')
      // Cell 2,2 should still be editing
      expect(result.current.editingCell).toEqual({ rowId: 2, columnId: 2 })
      expect(result.current.isEditing).toBe(true)
    })

    it('editingCellRef always reflects current editing cell', () => {
      const { result } = setup()
      expect(result.current.editingCellRef.current).toBeNull()

      act(() => result.current.startEditing(10, 20))
      expect(result.current.editingCellRef.current).toEqual({ rowId: 10, columnId: 20 })

      act(() => result.current.stopEditing())
      expect(result.current.editingCellRef.current).toBeNull()
    })

    it('rapid edit-save-edit cycle works correctly', async () => {
      const onCellUpdate = vi.fn<CellUpdateFn>()
      const { result } = setup({ onCellUpdate })

      // Edit cell A
      act(() => result.current.startEditing(1, 1))
      await act(async () => {
        await result.current.handleCellSave(1, 1, 'a')
      })
      expect(result.current.isEditing).toBe(false)

      // Immediately edit cell B
      act(() => result.current.startEditing(1, 2))
      await act(async () => {
        await result.current.handleCellSave(1, 2, 'b')
      })
      expect(result.current.isEditing).toBe(false)

      // Immediately edit cell C
      act(() => result.current.startEditing(1, 3))
      expect(result.current.editingCell).toEqual({ rowId: 1, columnId: 3 })

      expect(onCellUpdate).toHaveBeenCalledTimes(2)
    })
  })
})
