// @vitest-environment jsdom
/**
 * One record per Add, and a new record nobody filled doesn't stay (persona study R3):
 * a double-click on Add made two records (Joe); Add then Esc, or Add then walking
 * away, left a nameless record that was counted (Karen, Mark, Candy).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
;(window as unknown as Record<string, unknown>).api = { invoke: mockInvoke }
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }))

import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'
import { useGridEditing } from '../../../src/renderer/hooks/useGridEditing'
import { looksUntouched } from '../../../src/renderer/stores/gridRowSlice'
import { IPC } from '../../../src/shared/ipc-channels'
import type { GridRow, Column } from '../../../src/shared/types'

function row(id: number, extra: Partial<GridRow> = {}): GridRow {
  return { row_id: id, position: id, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00', ...extra }
}
const col = (id: number, column_type: string, extra: Partial<Column> = {}) =>
  ({ id, grid_id: 1, name: `C${id}`, column_type, width: 200, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', ...extra }) as Column
const NAME = col(1, 'text', { is_name_column: 1 })
const NUMBER = col(2, 'auto_number')

let nextId = 100
let discardAnswer = true
const calls = (ch: string) => mockInvoke.mock.calls.filter(c => c[0] === ch)
const ids = () => useGridStore.getState().rows.map(r => r.row_id)

beforeEach(() => {
  nextId = 100
  discardAnswer = true
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((ch: string) => {
    if (ch === IPC.ROW_CREATE) return Promise.resolve({ ok: true, data: nextId++ })
    if (ch === IPC.ROW_GET) return Promise.resolve({ ok: true, data: null })
    if (ch === IPC.ROW_DISCARD_IF_EMPTY) return Promise.resolve({ ok: true, data: discardAnswer })
    if (ch === IPC.GRID_GET_FULL) return Promise.resolve({ ok: false, error: 'not in this test' })
    return Promise.resolve({ ok: true, data: null })
  })
  window.location.hash = '#/grid'
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null })
  useSettingsStore.setState({ isLocked: false })
  useGridStore.setState({
    activeGridId: 1, showArchived: false, rows: [row(1, { col_1: 'Peterson home' })], columns: [NAME, NUMBER], hiddenColumns: [],
    rowTagsMap: new Map(), lastAddedRowId: null, pinnedRowId: null, freshRow: null, addingRow: false, selectedRowIds: new Set(),
  })
})
afterEach(() => { vi.useRealTimers() })

/** What DataGrid does 50 ms after an Add: opens the name and lets go of lastAddedRowId */
function settleAdd() { useGridStore.setState({ lastAddedRowId: null }) }

async function ticks() { await act(async () => { await new Promise(r => setTimeout(r, 30)) }) }

describe('one record per Add', () => {
  it('two Adds at once (a double-click, Ctrl+N twice) make one record', async () => {
    await Promise.all([useGridStore.getState().addRow(), useGridStore.getState().addRow()])
    expect(calls(IPC.ROW_CREATE)).toHaveLength(1)
    expect(ids()).toEqual([1, 100])
  })

  it('Add again while the new record is still empty goes back to its name instead of making another', async () => {
    await useGridStore.getState().addRow()
    settleAdd()
    await useGridStore.getState().addRow()
    expect(calls(IPC.ROW_CREATE)).toHaveLength(1)
    expect(useGridStore.getState().lastAddedRowId).toBe(100)
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('once the new record has a name, Add makes the next one', async () => {
    await useGridStore.getState().addRow()
    settleAdd()
    await useGridStore.getState().updateCell(100, 1, 'Hendricks place')
    await useGridStore.getState().addRow()
    expect(calls(IPC.ROW_CREATE)).toHaveLength(2)
    expect(ids()).toEqual([1, 100, 101])
  })
})

describe('an untouched new record does not stay', () => {
  function editor() {
    return renderHook(() => useGridEditing({ onCellUpdate: (r, c, v) => useGridStore.getState().updateCell(r, c, v) }))
  }

  it('Add, then Esc on its name: the record and its undo step go', async () => {
    const { result } = editor()
    await useGridStore.getState().addRow()
    settleAdd()
    act(() => result.current.setEditingCell({ rowId: 100, columnId: 1 }))
    expect(useGridStore.getState().freshRow?.editing).toBe(true)
    act(() => result.current.setEditingCell(null))
    await waitFor(() => expect(ids()).toEqual([1]))
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toEqual([[IPC.ROW_DISCARD_IF_EMPTY, 100]])
    expect(useUndoStore.getState().undoStack).toEqual([])
    expect(useGridStore.getState().freshRow).toBeNull()
  })

  it('Add, type a name, Enter: it stays', async () => {
    const { result } = editor()
    await useGridStore.getState().addRow()
    settleAdd()
    act(() => result.current.setEditingCell({ rowId: 100, columnId: 1 }))
    await act(async () => { await result.current.handleCellSave(100, 1, 'Bergstrom home') })
    await ticks()
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toEqual([])
    expect(ids()).toEqual([1, 100])
    expect(useGridStore.getState().freshRow).toBeNull()
  })

  it('Tab past the empty name to the next cell of the same record keeps it', async () => {
    const { result } = editor()
    await useGridStore.getState().addRow()
    settleAdd()
    const next = document.createElement('div')
    next.tabIndex = 0
    next.setAttribute('data-row-id', '100')
    next.setAttribute('data-col-id', '3')
    document.body.appendChild(next)
    act(() => result.current.setEditingCell({ rowId: 100, columnId: 1 }))
    act(() => { result.current.setEditingCell(null); next.focus() })
    await ticks()
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toEqual([])
    expect(ids()).toEqual([1, 100])
    next.remove()
  })

  it('Add, then switch lists: it goes before the other list loads', async () => {
    await useGridStore.getState().addRow()
    settleAdd()
    await useGridStore.getState().loadGrid(2)
    const order = mockInvoke.mock.calls.map(c => c[0])
    expect(order.indexOf(IPC.ROW_DISCARD_IF_EMPTY)).toBeGreaterThan(-1)
    expect(order.indexOf(IPC.ROW_DISCARD_IF_EMPTY)).toBeLessThan(order.indexOf(IPC.GRID_GET_FULL))
  })

  it('a reload while one of its cells is open leaves it alone', async () => {
    const { result } = editor()
    await useGridStore.getState().addRow()
    settleAdd()
    act(() => result.current.setEditingCell({ rowId: 100, columnId: 1 }))
    await useGridStore.getState().loadGrid(1)
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toEqual([])
  })

  it('Add, then go to another page: it goes when the grid closes', async () => {
    const { result, unmount } = editor()
    await useGridStore.getState().addRow()
    settleAdd()
    act(() => result.current.setEditingCell({ rowId: 100, columnId: 1 }))
    window.location.hash = '#/settings'
    unmount()
    await waitFor(() => expect(ids()).toEqual([1]))
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toHaveLength(1)
  })

  it('opening its own page keeps it (what is put in there is not in the grid yet)', async () => {
    const { unmount } = editor()
    await useGridStore.getState().addRow()
    settleAdd()
    window.location.hash = '#/profile/100?gridId=1'
    unmount()
    await ticks()
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toEqual([])
    expect(ids()).toEqual([1, 100])
  })

  it('locking leaves it for the reload after unlock (the database is closing)', async () => {
    const { unmount } = editor()
    await useGridStore.getState().addRow()
    settleAdd()
    useSettingsStore.setState({ isLocked: true })
    unmount()
    await ticks()
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toEqual([])
    expect(useGridStore.getState().freshRow?.rowId).toBe(100)
    // Unlocked: the list is read again, and the empty record goes first
    useSettingsStore.setState({ isLocked: false })
    useGridStore.setState({ rows: [] })
    await useGridStore.getState().loadGrid(1)
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toHaveLength(1)
  })

  it('a record with a note (which the grid cannot see) stays: main says no', async () => {
    discardAnswer = false
    await useGridStore.getState().addRow()
    settleAdd()
    expect(await useGridStore.getState().discardIfUntouched(100)).toBe(false)
    expect(ids()).toEqual([1, 100])
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('only the record Add just made is ever removed', async () => {
    expect(await useGridStore.getState().discardIfUntouched(1)).toBe(false)
    expect(calls(IPC.ROW_DISCARD_IF_EMPTY)).toEqual([])
  })
})

describe('looksUntouched', () => {
  const s = { columns: [NAME, NUMBER, col(3, 'deadline'), col(4, 'age_from_dob')], hiddenColumns: [col(5, 'text')], rowTagsMap: new Map<number, string[]>() }
  it('an auto number or a worked-out age is not something put in', () => {
    expect(looksUntouched(row(9, { col_2: '17', col_4: '3' }), s)).toBe(true)
  })
  it('a typed value (hidden columns too), a deadline done date, a star, a priority or a tag is', () => {
    expect(looksUntouched(row(9, { col_1: 'x' }), s)).toBe(false)
    expect(looksUntouched(row(9, { col_5: 'x' }), s)).toBe(false)
    expect(looksUntouched(row(9, { col_3: '2026-10-01' }), s)).toBe(false)
    expect(looksUntouched(row(9, { is_starred: 1 }), s)).toBe(false)
    expect(looksUntouched(row(9, { acuity_level_id: 2 }), s)).toBe(false)
    expect(looksUntouched(row(9), { ...s, rowTagsMap: new Map([[9, ['Urgent']]]) })).toBe(false)
  })
  it('blank space is empty', () => {
    expect(looksUntouched(row(9, { col_1: '   ' }), s)).toBe(true)
  })
})
