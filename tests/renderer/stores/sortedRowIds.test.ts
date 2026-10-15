/**
 * setSortedRowIds keeps the stored array when the list shows the same records
 * in the same order, so the record page, the counts and GridView don't redraw
 * after every edit (DataGrid stores a fresh array whenever its rows change).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

;(globalThis as Record<string, unknown>).window = { api: { invoke: vi.fn() } }
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))

import { useGridStore } from '../../../src/renderer/stores/gridStore'

beforeEach(() => { useGridStore.setState({ sortedRowIds: [] }) })

describe('setSortedRowIds', () => {
  it('equal ids keep the same array, and subscribers hear nothing', () => {
    const first = [3, 1, 2]
    useGridStore.getState().setSortedRowIds(first)
    const heard = vi.fn()
    const off = useGridStore.subscribe(heard)
    useGridStore.getState().setSortedRowIds([3, 1, 2])
    off()
    expect(useGridStore.getState().sortedRowIds).toBe(first)
    expect(heard).not.toHaveBeenCalled()
  })

  it('a different order replaces it', () => {
    useGridStore.getState().setSortedRowIds([3, 1, 2])
    const next = [1, 2, 3]
    useGridStore.getState().setSortedRowIds(next)
    expect(useGridStore.getState().sortedRowIds).toBe(next)
  })

  it('a record more or fewer replaces it', () => {
    useGridStore.getState().setSortedRowIds([1, 2])
    useGridStore.getState().setSortedRowIds([1, 2, 3])
    expect(useGridStore.getState().sortedRowIds).toEqual([1, 2, 3])
    useGridStore.getState().setSortedRowIds([1, 2])
    expect(useGridStore.getState().sortedRowIds).toEqual([1, 2])
  })
})
