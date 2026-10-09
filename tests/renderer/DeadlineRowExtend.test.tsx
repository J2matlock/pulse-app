// @vitest-environment jsdom
/** "Extend…" on a dashboard deadline: new date + reason, one undo step (W05 §4). */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string) => ({ ok: true, data: channel === 'deadlines:extension-revoke' ? { rowId: 4, sysLogId: 8 } : { id: 12, sysLogId: 7 } }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { DeadlineRow } from '../../src/renderer/views/dashboard/DeadlineRow'
import { IPC } from '../../src/shared/ipc-channels'
import { useUndoStore } from '../../src/renderer/stores/undoStore'

const deadline = {
  rowId: 4, clientName: 'Pat', gridId: 1, gridName: 'Caseload', columnId: 9, columnName: 'Annual review', dateValue: '2025-10-01',
  daysUntil: -1, alertRuleId: 2, threshold: null, intervalDays: 365, ruleKind: 'interval' as const, due: '2026-10-01', detail: 'Due Oct 1, 2026',
}

describe('extending a deadline from the dashboard', () => {
  it('needs a date and a reason, then saves and can be undone', async () => {
    render(<MemoryRouter><DeadlineRow deadline={deadline} onMarkDone={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Extend/ }))
    const dialog = screen.getByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Extend' }) as HTMLButtonElement
    fireEvent.change(within(dialog).getByLabelText('New due date'), { target: { value: '2026-10-20' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: ' Waiting on report ' } })
    await act(async () => { fireEvent.click(save) })
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_EXTEND, 4, 9, '2026-10-20', 'Waiting on report')
    await act(async () => { await useUndoStore.getState().undo() })
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_EXTENSION_RESTORE, 12, false)
  })

  it('offers to remove an extension that is in place', async () => {
    render(<MemoryRouter><DeadlineRow deadline={{ ...deadline, extensionId: 12 }} onMarkDone={vi.fn()} /></MemoryRouter>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remove extension/ })) })
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_EXTENSION_REVOKE, 12)
  })
})
