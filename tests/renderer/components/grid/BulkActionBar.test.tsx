// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Global mocks ────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
  mustInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
  storeInvoke: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Names by row id for the tests that need them (R3: the Trash button names records); '' = no name
const names = vi.hoisted(() => new Map<number, string>())
vi.mock('../../../../src/renderer/utils/clientName', () => ({
  getClientName: (r: { row_id: number }, _c: unknown, fallback = 'Unnamed') => names.has(r.row_id) ? (names.get(r.row_id) || fallback) : 'Test Client',
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

// ── Store imports ───────────────────────────────────────────────────────────

import { BulkActionBar, namedRecords } from '../../../../src/renderer/components/grid/BulkActionBar'
import type { BulkActionBarProps } from '../../../../src/renderer/components/grid/BulkActionBar'
import type { GridRow, Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { safeInvoke } from '../../../../src/renderer/utils/safeInvoke'
import { IPC } from '../../../../src/shared/ipc-channels'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import { useArchiveReasonStore } from '../../../../src/renderer/stores/archiveReasonStore'

function makeRow(id: number, isActive = 1): GridRow {
  return {
    row_id: id, position: id - 1, is_active: isActive, is_starred: 0,
    acuity_level_id: null, deleted_at: null,
    created_at: '', updated_at: '', col_1: `Client ${id}`,
  } as unknown as GridRow
}

function makeColumn(id: number, name: string): Column {
  return {
    id, grid_id: 1, name, column_type: 'text', position: 0, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 1,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function makeProps(overrides: Partial<BulkActionBarProps> = {}): BulkActionBarProps {
  const rows = [makeRow(1), makeRow(2), makeRow(3)]
  return {
    selectedRowIds: new Set([1, 2]),
    rowById: new Map(rows.map(r => [r.row_id, r])),
    columns: [makeColumn(1, 'Name')],
    activeGridId: 1,
    acuityEnabled: false,
    acuityLevels: [],
    bulkSetRowAcuityLevel: vi.fn(),
    setSelectedRowIds: vi.fn(),
    setBulkMoveTarget: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('BulkActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('displays correct selected count', () => {
    render(<BulkActionBar {...makeProps()} />)
    expect(screen.getByText('2 clients selected')).toBeTruthy()
  })

  it('displays singular when 1 row selected', () => {
    render(<BulkActionBar {...makeProps({ selectedRowIds: new Set([1]) })} />)
    expect(screen.getByText('1 client selected')).toBeTruthy()
  })

  it('Move to the Trash names the records and acts at once, with an Undo toast, no dialog (UX-B-25, Q4, R3)', async () => {
    useUndoStore.getState().clear()
    names.set(1, 'Bergstrom home').set(2, '')
    const setSelectedRowIds = vi.fn()
    render(<BulkActionBar {...makeProps({ setSelectedRowIds })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move Bergstrom home and 1 unnamed to the Trash' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith(IPC.ROW_BULK_ACTION, 'delete', [1, 2]))
    await vi.waitFor(() => expect(useUndoStore.getState().toast?.description).toBe('Moved Bergstrom home and 1 unnamed to the Trash'))
    expect(setSelectedRowIds.mock.calls.at(-1)![0].size).toBe(0)
    names.clear()
  })

  describe('namedRecords: which records, by name (persona study R3)', () => {
    const t = ((key: string, o?: { count?: number }) => key === 'record' && o?.count !== 1 ? 'clients' : 'client') as Parameters<typeof namedRecords>[1]
    it('1 record: its name, or "1 unnamed client"', () => {
      expect(namedRecords(['Bergstrom home'], t)).toBe('Bergstrom home')
      expect(namedRecords([''], t)).toBe('1 unnamed client')
    })
    it('2 records: both names', () => {
      expect(namedRecords(['Bergstrom home', 'Nowak home'], t)).toBe('Bergstrom home and Nowak home')
    })
    it('5 records: two names and the rest counted; nameless ones kept apart while the rest are named', () => {
      expect(namedRecords(['Bergstrom home', '', '', '', ''], t)).toBe('Bergstrom home and 4 unnamed')
      expect(namedRecords(['Bergstrom home', 'Nowak home', 'Olson home', '', ''], t)).toBe('Bergstrom home, Nowak home and 3 more')
      expect(namedRecords(['', '', '', '', ''], t)).toBe('5 unnamed clients')
    })
    it('a long name is shortened so the button stays on one line', () => {
      expect(namedRecords(['The Bergstrom family foster home on County Road 12'], t)).toBe('The Bergstrom family foster h…')
    })
  })

  it('clear selection button calls setSelectedRowIds with empty set', () => {
    const setSelectedRowIds = vi.fn()
    render(<BulkActionBar {...makeProps({ setSelectedRowIds })} />)
    const clearBtn = screen.getByRole('button', { name: 'Clear selection' })
    fireEvent.click(clearBtn)
    expect(setSelectedRowIds).toHaveBeenCalled()
    const arg = setSelectedRowIds.mock.calls[0]![0]
    expect(arg.size).toBe(0)
  })

  it('shows Archive button when all selected rows are active', () => {
    render(<BulkActionBar {...makeProps()} />)
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
    expect(screen.queryByText('Unarchive')).toBeNull()
  })

  it('archives at once in one bulk step, no dialog, and the toast offers a reason (Q4, UX-B-26)', async () => {
    useUndoStore.getState().clear()
    render(<BulkActionBar {...makeProps()} />)
    vi.mocked(safeInvoke).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => expect(useUndoStore.getState().toast).not.toBeNull())
    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith(IPC.ROW_BULK_ACTION, 'archive', [1, 2])
    expect(vi.mocked(safeInvoke).mock.calls.some(c => c[0] === IPC.ROW_ARCHIVE)).toBe(false)
    expect(useUndoStore.getState().toast?.description).toBe('Archived 2 clients (Test Client, Test Client)')
    // "Add a reason…" asks for both records
    useUndoStore.getState().toast!.action!.run()
    expect(useArchiveReasonStore.getState().request?.rowIds).toEqual([1, 2])
    expect(useArchiveReasonStore.getState().request?.label).toBe('2 clients')
    useArchiveReasonStore.setState({ request: null })
  })

  it('cancels upcoming appointments with them and says how many; Undo puts them back (audit 1.13)', async () => {
    useUndoStore.getState().clear()
    vi.mocked(safeInvoke).mockImplementation(async (channel: string) => {
      if (channel === IPC.APPT_UPCOMING_COUNT) return { ok: true, data: 2 } as never
      if (channel === IPC.APPT_CANCEL_UPCOMING) return { ok: true, data: { snapshot: { s: 1 }, ids: [7, 8] } } as never
      return { ok: true, data: null } as never
    })
    render(<BulkActionBar {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await vi.waitFor(() => expect(useUndoStore.getState().toast?.description).toBe('Archived 2 clients (Test Client, Test Client); 2 upcoming appointments cancelled'))
    const { mustInvoke } = await import('../../../../src/renderer/utils/safeInvoke')
    await useUndoStore.getState().undoFromToast()
    expect(vi.mocked(mustInvoke)).toHaveBeenCalledWith(IPC.ROW_BULK_ACTION, 'unarchive', [1, 2])
    expect(vi.mocked(mustInvoke)).toHaveBeenCalledWith(IPC.APPT_RESTORE, { s: 1 })
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: null } as never)
  })

  it('says "Change a column…", not "Bulk Edit" (UX-B-25)', () => {
    render(<BulkActionBar {...makeProps()} />)
    expect(screen.getByText('Change a column…')).toBeTruthy()
    expect(screen.queryByText('Bulk Edit')).toBeNull()
  })

  it('shows Unarchive button when all selected rows are archived', () => {
    const archivedRows = [makeRow(1, 0), makeRow(2, 0)]
    render(<BulkActionBar {...makeProps({
      selectedRowIds: new Set([1, 2]),
      rowById: new Map(archivedRows.map(r => [r.row_id, r])),
    })} />)
    expect(screen.getByText('Unarchive')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
  })

  it('shows Move to caseload button', () => {
    render(<BulkActionBar {...makeProps()} />)
    expect(screen.getByText('Move to caseload…')).toBeTruthy()
  })

  it('clicking Move to caseload calls setBulkMoveTarget', () => {
    const setBulkMoveTarget = vi.fn()
    render(<BulkActionBar {...makeProps({ setBulkMoveTarget })} />)
    fireEvent.click(screen.getByText('Move to caseload…'))
    expect(setBulkMoveTarget).toHaveBeenCalledWith(true)
  })
})
