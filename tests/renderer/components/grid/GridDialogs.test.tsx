// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('../../../../src/renderer/components/grid/MoveToGridModal', () => ({
  MoveToGridModal: () => <div data-testid="move-modal" />,
  BulkMoveToGridModal: () => <div data-testid="bulk-move-modal" />,
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
  mustInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { CancelAppointmentsCheckbox, useUpcomingAppointments, trashRows } from '../../../../src/renderer/components/grid/GridDialogs'
import { setWords } from '../../vocabFixture'
import { safeInvoke, mustInvoke } from '../../../../src/renderer/utils/safeInvoke'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import toast from 'react-hot-toast'

beforeEach(() => { setWords(); vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: null } as never) })

// The record Archive and Trash dialogs are gone (Q4): both act at once with an Undo toast.
// What's left here: the appointment helpers the handoff packet uses, and bulk Trash.

function Upcoming({ ids }: { ids: number[] | null }) {
  const n = useUpcomingAppointments(ids)
  const [checked, setChecked] = React.useState(true)
  return <CancelAppointmentsCheckbox count={n} checked={checked} onChange={setChecked} />
}

describe('CancelAppointmentsCheckbox', () => {
  it('shows nothing when there are no upcoming appointments', () => {
    const { container } = render(<Upcoming ids={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('offers to cancel upcoming appointments, ticked by default', async () => {
    vi.mocked(safeInvoke).mockImplementation(async (channel: string) => (channel === 'appointments:upcoming-count' ? { ok: true, data: 6 } : { ok: true, data: null }) as never)
    render(<Upcoming ids={[1]} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(safeInvoke).toHaveBeenCalledWith('appointments:upcoming-count', [1])
    const box = screen.getByLabelText('Also cancel its 6 upcoming appointments') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(box.checked).toBe(false)
  })
})

describe('trashRows (bulk Move to the Trash, no confirm: Q4)', () => {
  it('moves them at once, with one Undo toast step that restores them all (G-34)', async () => {
    useUndoStore.getState().clear()
    expect(await trashRows([4, 5])).toBe(true)
    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith('row:bulk-action', 'delete', [4, 5])
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().undoStack[0]!.description).toBe('Moved 2 clients to the Trash')
    expect(useUndoStore.getState().toast?.description).toBe('Moved 2 clients to the Trash')
    await useUndoStore.getState().undoFromToast()
    expect(vi.mocked(mustInvoke)).toHaveBeenCalledWith('row:bulk-action', 'restore', [4, 5])
  })

  it('a failure says so and leaves no undo step', async () => {
    useUndoStore.getState().clear()
    vi.mocked(safeInvoke).mockResolvedValueOnce({ ok: false, error: "We couldn't save your changes — try again" } as never)
    expect(await trashRows([4])).toBe(false)
    expect(toast.error).toHaveBeenCalled()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})
