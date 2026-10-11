// @vitest-environment jsdom
/** Profile Files (W09 §7): list with thumbnails, add, drop, rename, delete with undo; files on notes. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const file = (id: number, name: string, mime: string, extra: Record<string, unknown> = {}) => ({ id, row_id: 4, case_log_id: null, file_name: name, mime_type: mime, size_bytes: 245_760, sha256: 'x', description: null, created_at: '2026-10-01 10:00:00', deleted_at: null, ...extra })
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'attachments:list') return { ok: true, data: [file(1, 'court-order.pdf', 'application/pdf'), file(2, 'damage.png', 'image/png', { case_log_id: 9 })] }
  if (channel === 'attachments:preview') return { ok: true, data: { dataUrl: 'data:image/png;base64,AAAA' } }
  if (channel === 'attachments:add' || channel === 'attachments:add-paths') return { ok: true, data: { added: [file(3, 'new.pdf', 'application/pdf')], duplicates: [] } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {}, pathForFile: (f: File) => `/home/me/${f.name}` }, writable: true, configurable: true })

import { RecordFiles } from '../../src/renderer/components/profile/RecordFiles'
import { NoteFiles } from '../../src/renderer/components/profile/NoteFiles'
import { useUndoStore } from '../../src/renderer/stores/undoStore'
import { setWords } from './vocabFixture'

beforeEach(() => { setWords(); invoke.mockClear(); useUndoStore.getState().clear() })

describe('profile files', () => {
  it('lists files with sizes, a thumbnail for pictures, and which came with a note', async () => {
    render(<RecordFiles rowId={4} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByText('court-order.pdf')).toBeTruthy()
    expect(screen.getAllByText(/240 KB · Oct 1, 2026/)).toHaveLength(2)
    expect(screen.getByText(/with a/)).toBeTruthy()
    expect(document.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('adds files from the dialog or by dropping them', async () => {
    render(<RecordFiles rowId={4} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add files/ })) })
    expect(invoke).toHaveBeenCalledWith('attachments:add', 4, {})
    const zone = screen.getByText(/Drop files here/).closest('div')!.parentElement!
    await act(async () => { fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'scan.pdf')], types: ['Files'] } }) })
    expect(invoke).toHaveBeenCalledWith('attachments:add-paths', 4, ['/home/me/scan.pdf'], {})
  })

  it('renames and removes with undo', async () => {
    render(<RecordFiles rowId={4} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.click(screen.getByRole('button', { name: 'Rename or describe court-order.pdf' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Signed' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(invoke).toHaveBeenCalledWith('attachments:describe', 1, { fileName: 'court-order.pdf', description: 'Signed' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove court-order.pdf' })) })
    expect(invoke).toHaveBeenCalledWith('attachments:delete', 1)
    await act(async () => { await useUndoStore.getState().undo() })
    expect(invoke).toHaveBeenCalledWith('attachments:restore', 1)
  })
})

describe('files on a note', () => {
  it('lists them and attaches more to that note', async () => {
    render(<NoteFiles rowId={4} noteId={9} files={[file(2, 'damage.png', 'image/png', { case_log_id: 9 }) as never]} canAttach />)
    expect(screen.getByRole('button', { name: /damage.png \(240 KB\)/ })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Attach a file to this /  })) })
    expect(invoke).toHaveBeenCalledWith('attachments:add', 4, { caseLogId: 9 })
  })
})
