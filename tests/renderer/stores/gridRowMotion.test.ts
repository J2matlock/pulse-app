// @vitest-environment jsdom
/**
 * Records that arrive and leave (Q6): archive and Trash mark the record as
 * leaving before the save is back, take it out once the save is done and the
 * closing-up has had its 180 ms, and bring it back if the save fails. Under
 * reduced motion it goes as soon as the save is back. A new record, and one
 * Undo brings back, lights up for 1.2 s.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockInvoke = vi.fn()
;(window as unknown as Record<string, unknown>).api = { invoke: mockInvoke }
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }))

let reduce = false
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
})

import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import { ROW_LEAVE_MS, ROW_FLASH_MS } from '../../../src/renderer/utils/reducedMotion'
import { IPC } from '../../../src/shared/ipc-channels'
import type { GridRow, Column } from '../../../src/shared/types'

function row(id: number): GridRow {
  return { row_id: id, position: id, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' }
}
const name = { id: 1, grid_id: 1, name: 'Name', column_type: 'text', width: 200, position: 0, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 1, default_value: null, description: null, config: '{}' } as Column

function deferred() {
  let resolve!: (v: unknown) => void
  let reject!: (e: Error) => void
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const ids = () => useGridStore.getState().rows.map(r => r.row_id)
const leaving = () => [...useGridStore.getState().leavingRowIds]

beforeEach(() => {
  vi.useFakeTimers()
  reduce = false
  document.documentElement.classList.remove('reduce-motion')
  mockInvoke.mockReset()
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null })
  useGridStore.setState({ activeGridId: 1, showArchived: false, rows: [row(1), row(2), row(3)], columns: [name], leavingRowIds: new Set(), flashRowId: null })
})
afterEach(() => { vi.useRealTimers() })

describe('a record leaving', () => {
  it('archive marks it leaving before the save is back, and removes it after both the save and 180 ms', async () => {
    const save = deferred()
    mockInvoke.mockImplementation((ch: string) => ch === IPC.ROW_ARCHIVE ? save.promise : Promise.resolve({ ok: true, data: null }))
    const done = useGridStore.getState().archiveRow(2)
    expect(leaving()).toEqual([2])
    expect(ids()).toEqual([1, 2, 3])
    save.resolve({ ok: true, data: true })
    await vi.advanceTimersByTimeAsync(ROW_LEAVE_MS - 20)
    expect(ids()).toEqual([1, 2, 3])
    await vi.advanceTimersByTimeAsync(20)
    await done
    expect(ids()).toEqual([1, 3])
    expect(leaving()).toEqual([])
  })

  it('a slow save keeps it until the save is back', async () => {
    const save = deferred()
    mockInvoke.mockImplementation((ch: string) => ch === IPC.ROW_DELETE ? save.promise : Promise.resolve({ ok: true, data: null }))
    const done = useGridStore.getState().deleteRow(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(ids()).toEqual([1, 2, 3])
    expect(leaving()).toEqual([3])
    save.resolve({ ok: true, data: true })
    await vi.advanceTimersByTimeAsync(0)
    await done
    expect(ids()).toEqual([1, 2])
    expect(leaving()).toEqual([])
  })

  it('a failed save brings it back', async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: 'nope' })
    await useGridStore.getState().deleteRow(1)
    expect(ids()).toEqual([1, 2, 3])
    expect(leaving()).toEqual([])
    mockInvoke.mockResolvedValue({ ok: false, error: 'nope' })
    await useGridStore.getState().archiveRow(1)
    expect(ids()).toEqual([1, 2, 3])
    expect(leaving()).toEqual([])
  })

  it('under reduced motion it goes as soon as the save is back', async () => {
    document.documentElement.classList.add('reduce-motion')
    mockInvoke.mockResolvedValue({ ok: true, data: true })
    await useGridStore.getState().archiveRow(2)
    expect(ids()).toEqual([1, 3])
    reduce = true
    document.documentElement.classList.remove('reduce-motion')
    await useGridStore.getState().deleteRow(3)
    expect(ids()).toEqual([1])
  })

  it('with archived records shown, an archived one stays (greyed) and never leaves', async () => {
    useGridStore.setState({ showArchived: true })
    mockInvoke.mockResolvedValue({ ok: true, data: true })
    const done = useGridStore.getState().archiveRow(2)
    expect(leaving()).toEqual([])
    await done
    expect(ids()).toEqual([1, 2, 3])
  })
})

describe('a record arriving', () => {
  it('a new record lights up for 1.2 s', async () => {
    mockInvoke.mockImplementation((ch: string) => Promise.resolve({ ok: true, data: ch === IPC.ROW_CREATE ? 9 : null }))
    await useGridStore.getState().addRow()
    expect(useGridStore.getState().flashRowId).toBe(9)
    vi.advanceTimersByTime(ROW_FLASH_MS - 1)
    expect(useGridStore.getState().flashRowId).toBe(9)
    vi.advanceTimersByTime(1)
    expect(useGridStore.getState().flashRowId).toBeNull()
  })

  it('Undo of a Trash brings the record back lit', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: true })
    const trashed = useGridStore.getState().deleteRow(2)
    await vi.advanceTimersByTimeAsync(ROW_LEAVE_MS)
    await trashed
    expect(ids()).toEqual([1, 3])
    // The reload after Undo brings it back
    const loadGrid = vi.fn(async () => { useGridStore.setState({ rows: [row(1), row(2), row(3)] }) })
    useGridStore.setState({ loadGrid })
    await useUndoStore.getState().undoFromToast()
    expect(loadGrid).toHaveBeenCalled()
    expect(useGridStore.getState().flashRowId).toBe(2)
  })
})
