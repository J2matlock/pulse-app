// @vitest-environment jsdom
/** Files storage, trash and count column (W09 commit 4). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: toast }))
const trashed = [{ id: 7, row_id: 4, case_log_id: null, file_name: 'old-scan.pdf', mime_type: 'application/pdf', size_bytes: 245_760, sha256: 'x', description: null, created_at: '2026-09-01 10:00:00', deleted_at: '2026-10-01 10:00:00', record_name: 'Jane Smith' }]
let trash = trashed
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'attachments:usage') return { ok: true, data: { count: 12, bytes: 300 * 1024 * 1024, limitBytes: 500 * 1024 * 1024 } }
  if (channel === 'attachments:trash-list') return { ok: true, data: trash }
  if (channel === 'attachments:purge') return { ok: true, data: 3 }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { FilesStorageSection } from '../../src/renderer/components/settings/FilesStorageSection'
import { TrashFiles } from '../../src/renderer/components/shared/TrashFiles'
import { CellDisplay } from '../../src/renderer/components/grid/CellDisplay'
import type { Column } from '../../src/shared/types'
import { setWords } from './vocabFixture'
import { useUndoStore } from '../../src/renderer/stores/undoStore'
import type { UndoItem } from '../../src/renderer/stores/undoStore'

const removeStep = (): UndoItem => ({ id: 'f1', description: 'Removed a file', timestamp: Date.now(), category: 'structural', icon: 'trash', undo: vi.fn(), redo: vi.fn() })

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
beforeEach(() => { setWords(); invoke.mockClear(); toast.error.mockClear(); toast.success.mockClear(); trash = trashed })

describe('files storage settings', () => {
  it('shows how much room files use and saves a new limit within range', async () => {
    render(<FilesStorageSection />)
    await tick()
    expect(screen.getByText(/12 files using 300 MB of 500 MB/)).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('60')
    const input = screen.getByLabelText(/Room for files/) as HTMLInputElement
    expect(input.value).toBe('500')
    fireEvent.change(input, { target: { value: '50' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/between 100 and 4000/))
    fireEvent.change(input, { target: { value: '1000' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(invoke).toHaveBeenCalledWith('settings:update', 'attachments_max_mb', '1000')
  })

  it('empties the files trash', async () => {
    render(<FilesStorageSection />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remove files in the Trash now/ })) })
    expect(invoke).toHaveBeenCalledWith('attachments:purge')
    expect(toast.success).toHaveBeenCalledWith('Removed 3 files from the Trash')
  })

  it('emptying the files trash forgets undo steps that would bring a file back (Q-045)', async () => {
    useUndoStore.setState({ undoStack: [removeStep()], redoStack: [] })
    render(<FilesStorageSection />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remove files in the Trash now/ })) })
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})

describe('trash files', () => {
  it('lists removed files with their record, restores and deletes for good', async () => {
    render(<TrashFiles />)
    await tick()
    expect(screen.getByText('old-scan.pdf')).toBeTruthy()
    expect(screen.getByText(/240 KB · Client: Jane Smith/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Restore/ })) })
    expect(invoke).toHaveBeenCalledWith('attachments:restore', 7)
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Delete forever/ })) })
    expect(invoke).toHaveBeenCalledWith('attachments:purge', 7)
  })

  it('deleting a file for good forgets undo steps that would bring it back (Q-045)', async () => {
    render(<TrashFiles />)
    await tick()
    useUndoStore.setState({ undoStack: [removeStep()], redoStack: [] })
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Delete forever/ })) })
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('shows nothing when no files are in the trash', async () => {
    trash = []
    const { container } = render(<TrashFiles />)
    await tick()
    expect(container.textContent).toBe('')
  })
})

describe('files count cell', () => {
  const col = { id: 3, grid_id: 1, name: 'Files', column_type: 'file_count', position: 1, config: null } as unknown as Column
  it('shows how many files, or a dash for none', () => {
    const { rerender, container } = render(<CellDisplay column={col} value={'2'} />)
    expect(container.textContent).toBe('2 files')
    rerender(<CellDisplay column={col} value={'1'} />)
    expect(container.textContent).toBe('1 file')
    rerender(<CellDisplay column={col} value={null} />)
    expect(container.textContent).toBe('—')
  })
})
