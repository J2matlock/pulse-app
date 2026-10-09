// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

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
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { ArchiveDialog, DeleteRowDialog, BulkDeleteDialog } from '../../../../src/renderer/components/grid/GridDialogs'
import { setWords } from '../../vocabFixture'

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
    expect(onConfirm).toHaveBeenCalled()
  })
})

describe('DeleteRowDialog', () => {
  it('renders ConfirmDialog when deleteTarget is set', () => {
    render(
      <DeleteRowDialog deleteTarget={1} deleteRow={vi.fn()} setDeleteTarget={vi.fn()} setSelectedRowIds={vi.fn()} />
    )
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy()
    expect(screen.getByText('Move to trash?')).toBeTruthy()
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
    expect(screen.getByText('Move 3 clients to trash?')).toBeTruthy()
  })
})
