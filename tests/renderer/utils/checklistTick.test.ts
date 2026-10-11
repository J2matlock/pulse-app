/**
 * Ticking a checklist item off outside the record page (Tasks, Focus mode,
 * Dashboard): undo and redo match the record page's checklist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke } }
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { tickChecklistItem } from '../../../src/renderer/utils/checklistTick'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'

const item = { id: 3, title: 'Monthly home visit', client_name: 'Maria', row_id: 9 }

beforeEach(() => {
  invoke.mockReset()
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
})

describe('tickChecklistItem', () => {
  it('puts a repeating item back on its old due date, silently, and voids the note', async () => {
    invoke.mockResolvedValue({ ok: true, data: { sysLogId: 41, repeat: { previousDue: '2026-10-01', nextDue: '2026-11-01' } } })
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    expect(await tickChecklistItem(item, { onUndo, onRedo })).toBe(true)
    expect(invoke).toHaveBeenCalledWith('checklist:update-item', 3, expect.objectContaining({ is_completed: 1 }))
    expect(useUndoStore.getState().undoStack[0]!.sideEffects).toEqual([{ type: 'void_case_log', caseLogId: 41 }])

    invoke.mockClear()
    invoke.mockResolvedValue({ ok: true, data: { sysLogId: null, repeat: null } })
    await useUndoStore.getState().undo()
    expect(invoke).toHaveBeenCalledWith('case-log:void', 41, 'Undone action')
    expect(invoke).toHaveBeenCalledWith('checklist:update-item', 3, { is_completed: 0, completed_at: null, due_date: '2026-10-01' }, { silent: true })
    expect(onUndo).toHaveBeenCalled()

    invoke.mockClear()
    await useUndoStore.getState().redo()
    expect(invoke).toHaveBeenCalledWith('case-log:unvoid', 41)
    expect(invoke).toHaveBeenCalledWith('checklist:update-item', 3, { is_completed: 0, completed_at: null, completed_by: null, due_date: '2026-11-01' }, { silent: true })
    expect(onRedo).toHaveBeenCalled()
  })

  it('reopens a one-off item without writing a "Reopened" note', async () => {
    invoke.mockResolvedValue({ ok: true, data: { sysLogId: null, repeat: null } })
    await tickChecklistItem(item)
    invoke.mockClear()
    await useUndoStore.getState().undo()
    expect(invoke).toHaveBeenCalledWith('checklist:update-item', 3, { is_completed: 0, completed_at: null }, { silent: true })
  })

  it('says so and pushes nothing when the tick fails', async () => {
    invoke.mockResolvedValue({ ok: false, error: 'nope' })
    expect(await tickChecklistItem(item)).toBe(false)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})
