// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

vi.mock('../../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, onConfirm, onCancel }: { open: boolean; title: string; onConfirm: () => void; onCancel: () => void }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onCancel}>CancelDialog</button>
      </div>
    ) : null,
}))

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

import { ArchiveDialog, DeleteRowDialog, BulkDeleteDialog } from '../../../../src/renderer/components/grid/GridDialogs'
import { setWords } from '../../vocabFixture'
import { safeInvoke, mustInvoke } from '../../../../src/renderer/utils/safeInvoke'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'

beforeEach(() => { setWords() })

describe('ArchiveDialog', () => {
  it('returns null when archiveTarget is null', () => {
    const { container } = render(
      <ArchiveDialog archiveTarget={null} archiveReason="" setArchiveReason={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders when archiveTarget is set', () => {
    render(
      <ArchiveDialog archiveTarget={1} archiveReason="" setArchiveReason={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByText('Archive client')).toBeTruthy()
    expect(screen.getByLabelText(/Reason/)).toBeTruthy()
  })

  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn()
    render(
      <ArchiveDialog archiveTarget={1} archiveReason="" setArchiveReason={vi.fn()} onConfirm={vi.fn()} onCancel={onCancel} />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('Archive calls onConfirm', () => {
    const onConfirm = vi.fn()
    render(
      <ArchiveDialog archiveTarget={1} archiveReason="" setArchiveReason={vi.fn()} onConfirm={onConfirm} onCancel={vi.fn()} />
    )
    fireEvent.click(screen.getByText('Archive'))
    expect(onConfirm).toHaveBeenCalledWith({ cancelAppointments: false })
  })

  it('offers to cancel upcoming appointments, ticked by default', async () => {
    vi.mocked(safeInvoke).mockImplementation(async (channel: string) => (channel === 'appointments:upcoming-count' ? { ok: true, data: 6 } : { ok: true, data: null }) as never)
    const onConfirm = vi.fn()
    render(
      <ArchiveDialog archiveTarget={1} archiveReason="" setArchiveReason={vi.fn()} onConfirm={onConfirm} onCancel={vi.fn()} />
    )
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(safeInvoke).toHaveBeenCalledWith('appointments:upcoming-count', [1])
    const box = screen.getByLabelText('Also cancel its 6 upcoming appointments') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(screen.getByText('Archive'))
    expect(onConfirm).toHaveBeenLastCalledWith({ cancelAppointments: true })
    fireEvent.click(box)
    fireEvent.click(screen.getByText('Archive'))
    expect(onConfirm).toHaveBeenLastCalledWith({ cancelAppointments: false })
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: null } as never)
  })
})

describe('DeleteRowDialog', () => {
  it('renders ConfirmDialog when deleteTarget is set', () => {
    render(
      <DeleteRowDialog deleteTarget={1} deleteRow={vi.fn()} setDeleteTarget={vi.fn()} setSelectedRowIds={vi.fn()} />
    )
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy()
    expect(screen.getByText('Move this client to the Trash?')).toBeTruthy()
  })
})

describe('BulkDeleteDialog', () => {
  it('renders with correct count in title', () => {
    render(
      <BulkDeleteDialog
        open={true}
        selectedCount={3}
        selectedRowIds={new Set([1, 2, 3])}
        activeGridId={1}
        setSelectedRowIds={vi.fn()}
        setBulkDeleteTarget={vi.fn()}
      />
    )
    expect(screen.getByText('Move 3 clients to the Trash?')).toBeTruthy()
  })

  it('moves to trash with a plain confirm and one Undo that restores them all (G-34)', async () => {
    useUndoStore.getState().clear()
    const setSelected = vi.fn()
    render(
      <BulkDeleteDialog open selectedCount={2} selectedRowIds={new Set([4, 5])} activeGridId={null}
        setSelectedRowIds={setSelected} setBulkDeleteTarget={vi.fn()} />
    )
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => expect(useUndoStore.getState().undoStack).toHaveLength(1))
    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith('row:bulk-action', 'delete', [4, 5])
    expect(useUndoStore.getState().undoStack[0]!.description).toBe('Moved 2 clients to the Trash')
    await useUndoStore.getState().undo()
    expect(vi.mocked(mustInvoke)).toHaveBeenCalledWith('row:bulk-action', 'restore', [4, 5])
  })
})
