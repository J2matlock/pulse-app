// @vitest-environment jsdom
/**
 * Bug sweep S2: ticking a repeating checklist item on the Dashboard keeps it on
 * the list at its next due date instead of dropping it until the next visit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { ChecklistDueRow } from '../../../../src/renderer/views/dashboard/ChecklistDueRow'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import type { ChecklistDueItem } from '../../../../src/shared/types'

const item = {
  id: 3, row_id: 9, title: 'Monthly home visit', client_name: 'Maria', grid_id: 1, grid_name: 'Caseload',
  due_date: '2026-10-01', priority: 'normal', is_completed: 0, recurrence_rule: '{"type":"monthly","interval":1}',
} as unknown as ChecklistDueItem

beforeEach(() => {
  invoke.mockReset()
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
})

function renderRow() {
  const onComplete = vi.fn()
  const onRestore = vi.fn()
  render(<MemoryRouter><ChecklistDueRow item={item} daysUntil={-3} onComplete={onComplete} onRestore={onRestore} /></MemoryRouter>)
  return { onComplete, onRestore }
}

describe('Done on a Dashboard checklist item', () => {
  it('a repeating one comes back at its next date, and undo puts the old date back', async () => {
    invoke.mockResolvedValue({ ok: true, data: { sysLogId: null, repeat: { previousDue: '2026-10-01', nextDue: '2026-11-01' } } })
    const { onComplete, onRestore } = renderRow()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /complete/i })) })
    expect(onComplete).toHaveBeenCalledWith(3)
    expect(onRestore).toHaveBeenLastCalledWith({ ...item, due_date: '2026-11-01' })

    await act(async () => { await useUndoStore.getState().undo() })
    expect(onRestore).toHaveBeenLastCalledWith({ ...item, due_date: '2026-10-01' })
  })

  it('a one-off one just leaves the list', async () => {
    invoke.mockResolvedValue({ ok: true, data: { sysLogId: null, repeat: null } })
    const { onComplete, onRestore } = renderRow()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /complete/i })) })
    expect(onComplete).toHaveBeenCalledWith(3)
    expect(onRestore).not.toHaveBeenCalled()
  })
})
