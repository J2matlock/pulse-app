// @vitest-environment jsdom
/** Deleted columns in List settings (audit 5.2): restore, or delete forever with a typed confirmation. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const deletedAt = new Date(Date.now() - 2 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
const invoke = vi.fn(async (channel: string) => channel === 'column:deleted-list'
  ? { ok: true, data: [{ id: 3, grid_id: 1, column_id: 9, name: 'Gate code', column_type: 'text', deleted_at: deletedAt, values: 4 }] }
  : { ok: true, data: { columnId: 9, gridId: 1 } })
Object.defineProperty(window, 'api', { value: { invoke }, writable: true, configurable: true })

import { DeletedColumnsSection } from '../../../../src/renderer/components/grid/DeletedColumnsSection'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import type { UndoItem } from '../../../../src/renderer/stores/undoStore'

const step = (): UndoItem => ({ id: 's1', description: 'Deleted column', timestamp: Date.now(), category: 'structural', icon: 'trash', undo: vi.fn(), redo: vi.fn() })

beforeEach(() => invoke.mockClear())

describe('DeletedColumnsSection', () => {
  it('shows what is kept and restores a column', async () => {
    render(<DeletedColumnsSection gridId={1} />)
    await waitFor(() => expect(screen.getByText('Gate code')).toBeTruthy())
    expect(screen.getByText(/4 values · 28 days left/)).toBeTruthy()
    fireEvent.click(screen.getByText('Restore'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('column:restore', 3))
  })

  it('asks for the name before deleting forever', async () => {
    render(<DeletedColumnsSection gridId={1} />)
    await waitFor(() => expect(screen.getByText('Gate code')).toBeTruthy())
    fireEvent.click(screen.getByText('Delete forever'))
    expect(screen.getByText('Delete "Gate code" forever?')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Gate code' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete forever' }).at(-1)!)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('column:purge', 3))
  })

  it('forgets undo steps after deleting forever or restoring by hand: they point at the Trash entry that is gone (Q-045)', async () => {
    useUndoStore.setState({ undoStack: [step()], redoStack: [] })
    render(<DeletedColumnsSection gridId={1} />)
    await waitFor(() => expect(screen.getByText('Gate code')).toBeTruthy())
    fireEvent.click(screen.getByText('Delete forever'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Gate code' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete forever' }).at(-1)!)
    await waitFor(() => expect(useUndoStore.getState().undoStack).toHaveLength(0))

    useUndoStore.setState({ undoStack: [step()], redoStack: [] })
    fireEvent.click(screen.getByText('Restore'))
    await waitFor(() => expect(useUndoStore.getState().undoStack).toHaveLength(0))
  })
})
