// @vitest-environment jsdom
/** The link picker (W04 §7.2): search, link with undo (restoring a replaced link), unlink, create, keyboard. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const results = [
  { row_id: 11, grid_id: 2, display_name: 'Jane Smith', is_active: 1 },
  { row_id: 12, grid_id: 2, display_name: 'Bob Lee', is_active: 0 },
]
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'links:search') return { ok: true, data: results }
  if (channel === 'links:add') return { ok: true, data: { added: { typeId: 7, fromRowId: 5, toRowId: 12 }, removed: [{ typeId: 7, fromRowId: 5, toRowId: 11 }], sysLogIds: [], rowIds: [5, 11, 12] } }
  if (channel === 'links:remove') return { ok: true, data: { added: null, removed: [{ typeId: 7, fromRowId: 5, toRowId: 11 }], sysLogIds: [], rowIds: [5, 11] } }
  if (channel === 'links:create-record') return { ok: true, data: { rowId: 99, change: { added: { typeId: 7, fromRowId: 5, toRowId: 99 }, removed: [], sysLogIds: [], rowIds: [5, 99] } } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { LinkPicker } from '../../src/renderer/components/links/LinkPicker'
import { useUndoStore } from '../../src/renderer/stores/undoStore'
import { IPC } from '../../src/shared/ipc-channels'
import type { LinkType } from '../../src/shared/links'
import { setWords } from './vocabFixture'

const type: LinkType = { id: 7, from_grid_id: 3, to_grid_id: 2, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one', created_at: '', from_grid_name: 'Vehicles', to_grid_name: 'Customers' }
const calls = (channel: string) => invoke.mock.calls.filter(c => c[0] === channel).map(c => c.slice(1))

beforeEach(() => { setWords(); invoke.mockClear(); useUndoStore.getState().clear() })

async function open(onClose = vi.fn()) {
  render(<LinkPicker type={type} direction="forward" rowId={5} chips={[{ rowId: 11, name: 'Jane Smith' }]} onClose={onClose} />)
  await act(async () => { await new Promise(r => setTimeout(r, 150)) })
  return onClose
}

describe('the link picker', () => {
  it('lists matches, marks what is linked, and replaces the owner with undo', async () => {
    const onClose = await open()
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Jane Smith', 'Bob Leearchived'])
    await act(async () => { fireEvent.click(screen.getAllByRole('option')[1]!) })
    expect(calls(IPC.RECORD_LINK_ADD)).toEqual([[7, 5, 12]])
    // A side that holds one closes after picking
    expect(onClose).toHaveBeenCalled()
    await act(async () => { await useUndoStore.getState().undo() })
    expect(calls(IPC.RECORD_LINK_REMOVE)).toEqual([[7, 5, 12]])
    expect(calls(IPC.RECORD_LINK_ADD)).toEqual([[7, 5, 12], [7, 5, 11]])
  })

  it('unlinks from the chips', async () => {
    await open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unlink Jane Smith' })) })
    expect(calls(IPC.RECORD_LINK_REMOVE)).toEqual([[7, 5, 11]])
  })

  it('creates a new record from what was typed, and works from the keyboard', async () => {
    const onClose = await open()
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'Dana Cole' } })
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { selected: true }).textContent).toMatch(/New .*Dana Cole/)
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
    expect(calls(IPC.RECORD_LINK_CREATE)).toEqual([[7, 'forward', 5, 'Dana Cole']])
    await act(async () => { await useUndoStore.getState().undo() })
    expect(calls(IPC.ROW_HARD_DELETE)).toEqual([[99]])
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
