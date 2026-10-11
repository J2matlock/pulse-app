// @vitest-environment jsdom
/** Stage moves in the window (W06 §4): one undo step that puts everything back; table edits go the same way. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'stages:move') return { ok: true, data: { previous: 'Estimate', changed: true, sysLogIds: [31, 32], checklistItemIds: [7, 8], stamped: { columnId: 3, previous: '2026-01-02' } } }
  if (channel === 'cell:update') return { ok: true, data: { sysLogId: null } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useUndoStore } from '../../src/renderer/stores/undoStore'
import { IPC } from '../../src/shared/ipc-channels'
import { localDateString } from '../../src/shared/dates'
import type { Column, GridRow } from '../../src/shared/types'
import { setWords } from './vocabFixture'

const stageCol = { id: 2, grid_id: 1, name: 'Status', column_type: 'status', config: JSON.stringify({ options: [{ label: 'Estimate' }, { label: 'Done' }], stage: { options: [{ value: 'Estimate' }, { value: 'Done' }] } }) } as Column
const calls = (channel: string) => invoke.mock.calls.filter(c => c[0] === channel).map(c => c.slice(1))

beforeEach(() => {
  setWords(); invoke.mockClear(); useUndoStore.getState().clear()
  useGridStore.setState({ activeGridId: 1, columns: [{ id: 1, grid_id: 1, name: 'Job', column_type: 'text', is_name_column: 1, config: '{}' } as Column, stageCol, { id: 3, grid_id: 1, name: 'Picked up', column_type: 'date', config: '{}' } as Column],
    rows: [{ row_id: 9, col_1: 'J-0042', col_2: 'Estimate', col_3: '2026-01-02' } as unknown as GridRow], grids: [] } as never)
})

describe('stage moves', () => {
  it('route table edits of the stage column through STAGE_MOVE, then undo everything at once', async () => {
    await act(async () => { await useGridStore.getState().updateCell(9, 2, 'Done') })
    expect(calls(IPC.STAGE_MOVE)).toEqual([[9, 2, 'Done']])
    expect(calls(IPC.CELL_UPDATE)).toEqual([])
    expect(useGridStore.getState().rows[0]).toMatchObject({ col_2: 'Done', col_3: localDateString() })
    expect(useUndoStore.getState().undoStack[0]?.description).toBe('Moved J-0042 to Done')

    await act(async () => { await useUndoStore.getState().undo() })
    // One call undoes it in main, removing the move's notes, history and checklist (audit S-16)
    expect(calls(IPC.STAGE_UNDO)).toEqual([[9, 2, expect.objectContaining({ previous: 'Estimate', sysLogIds: [31, 32], checklistItemIds: [7, 8] })]])
    expect(calls(IPC.CELL_UPDATE)).toEqual([])
    expect(useGridStore.getState().rows[0]).toMatchObject({ col_2: 'Estimate', col_3: '2026-01-02' })
  })
})
