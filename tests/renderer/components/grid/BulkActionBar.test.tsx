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
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../../src/renderer/utils/clientName', () => ({
  getClientName: () => 'Test Client',
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

// ── Store imports ───────────────────────────────────────────────────────────

import { BulkActionBar } from '../../../../src/renderer/components/grid/BulkActionBar'
import type { BulkActionBarProps } from '../../../../src/renderer/components/grid/BulkActionBar'
import type { GridRow, Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { safeInvoke } from '../../../../src/renderer/utils/safeInvoke'

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
    setBulkDeleteTarget: vi.fn(),
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

  it('Delete button calls setBulkDeleteTarget', () => {
    const setBulkDeleteTarget = vi.fn()
    render(<BulkActionBar {...makeProps({ setBulkDeleteTarget })} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(setBulkDeleteTarget).toHaveBeenCalledWith(true)
  })

  it('clear selection button calls setSelectedRowIds with empty set', () => {
    const setSelectedRowIds = vi.fn()
    render(<BulkActionBar {...makeProps({ setSelectedRowIds })} />)
    // The clear button has title "Clear selection (Escape)"
    const clearBtn = screen.getByTitle('Clear selection (Escape)')
    fireEvent.click(clearBtn)
    expect(setSelectedRowIds).toHaveBeenCalled()
    const arg = setSelectedRowIds.mock.calls[0]![0]
    expect(arg.size).toBe(0)
  })

  it('shows Archive button when all selected rows are active', () => {
    render(<BulkActionBar {...makeProps()} />)
    expect(screen.getByText('Archive')).toBeTruthy()
    expect(screen.queryByText('Unarchive')).toBeNull()
  })

  it('the archive question names the list with the workspace word (A28-12)', async () => {
    // The question shows only when an archived record has upcoming appointments
    vi.mocked(safeInvoke).mockResolvedValueOnce({ ok: true, data: 2 })
    render(<BulkActionBar {...makeProps()} />)
    fireEvent.click(screen.getByText('Archive'))
    expect(await screen.findByText(/hidden from the caseload\. Unarchiving/)).toBeTruthy()
  })

  it('shows Unarchive button when all selected rows are archived', () => {
    const archivedRows = [makeRow(1, 0), makeRow(2, 0)]
    render(<BulkActionBar {...makeProps({
      selectedRowIds: new Set([1, 2]),
      rowById: new Map(archivedRows.map(r => [r.row_id, r])),
    })} />)
    expect(screen.getByText('Unarchive')).toBeTruthy()
    expect(screen.queryByText('Archive')).toBeNull()
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
