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

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: (state: unknown) => T) => {
    let prev: T | undefined
    return (state: unknown): T => {
      const next = selector(state)
      if (prev !== undefined && shallowEq(prev, next)) return prev
      prev = next
      return next
    }
  },
}))

function shallowEq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const keysA = Object.keys(a as Record<string, unknown>)
  const keysB = Object.keys(b as Record<string, unknown>)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { GridStatusFooter } from '../../../../src/renderer/components/grid/GridStatusFooter'
import type { Column, GridRow } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function makeRow(id: number): GridRow {
  return {
    row_id: id, position: id - 1, is_active: 1, is_starred: 0,
    acuity_level_id: null, deleted_at: null,
    created_at: '', updated_at: '', col_1: `Client ${id}`,
  } as unknown as GridRow
}

function setupStore(overrides: Record<string, unknown> = {}) {
  useGridStore.setState({
    rows: [makeRow(1), makeRow(2), makeRow(3)],
    columns: [makeColumn(1, 'Name'), makeColumn(2, 'Age', 'number')],
    searchQuery: '',
    selectedRowIds: new Set<number>(),
    sortedRowIds: [1, 2, 3],
    viewMode: 'table',
    ...overrides,
  } as unknown as Parameters<typeof useGridStore.setState>[0])
}

beforeEach(() => { setWords() })

describe('GridStatusFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStore()
  })

  it('renders client count', () => {
    render(<GridStatusFooter />)
    expect(screen.getByText('3 clients')).toBeTruthy()
  })

  it('renders column count', () => {
    render(<GridStatusFooter />)
    expect(screen.getByText('2 columns')).toBeTruthy()
  })

  it('counts the records shown when a search or filter hides some (G-24)', () => {
    setupStore({ searchQuery: 'test', sortedRowIds: [2] })
    render(<GridStatusFooter />)
    expect(screen.getByText('1 of 3 clients')).toBeTruthy()
  })

  it('totals each number column on its own for the selection (G-24)', () => {
    const fee = makeColumn(3, 'Fee', 'currency')
    const rows = [makeRow(1), makeRow(2), makeRow(3)].map((r, i) => ({ ...r, col_2: String(30 + i), col_3: String(100 * (i + 1)) }))
    setupStore({ rows, columns: [makeColumn(1, 'Name'), makeColumn(2, 'Age', 'number'), fee], selectedRowIds: new Set([1, 2]) })
    render(<GridStatusFooter />)
    expect(screen.getByText(/Age total: 61/)).toBeTruthy()
    expect(screen.getByText(/Fee total: \$300\.00/)).toBeTruthy()
  })

  it('shows singular form for 1 client', () => {
    setupStore({ rows: [makeRow(1)], sortedRowIds: [1] })
    render(<GridStatusFooter />)
    expect(screen.getByText('1 client')).toBeTruthy()
  })

  it('shows selection count when rows are selected', () => {
    setupStore({ selectedRowIds: new Set([1, 2]) })
    render(<GridStatusFooter />)
    expect(screen.getByText(/Selected: 2/)).toBeTruthy()
  })

  it('is the one footer line: list name, counts and the save status together (UX-B-42)', () => {
    setupStore({ grids: [{ id: 1, name: 'My Caseload' }], activeGridId: 1, isSaving: true, saveError: null })
    render(<GridStatusFooter />)
    expect(screen.getByText('My Caseload')).toBeTruthy()
    expect(screen.getByText('3 clients')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Saving…')
  })

  it('says when archived records are being shown too (UX-B-27)', () => {
    const archived = { ...makeRow(3), is_active: 0 } as unknown as GridRow
    setupStore({ rows: [makeRow(1), makeRow(2), archived], showArchived: true })
    render(<GridStatusFooter />)
    expect(screen.getByTestId('archived-shown-note').textContent).toBe('Showing archived clients too')
  })

  it('says nothing about archived records while they are hidden', () => {
    setupStore({ showArchived: false })
    render(<GridStatusFooter />)
    expect(screen.queryByTestId('archived-shown-note')).toBeNull()
  })

  it('offers the color key for the deadline rules the shown columns use (UX-B-04)', () => {
    useAlertStore.setState({ rules: [
      { id: 7, name: 'Annual review', thresholds: [{ daysBefore: 30, label: 'Coming up', bgClass: 'bg-yellow-100' }, { daysBefore: -1, label: 'Late', bgClass: 'bg-red-100' }] },
      { id: 8, name: 'Not used here', thresholds: [] },
    ] } as unknown as Parameters<typeof useAlertStore.setState>[0])
    const due = { ...makeColumn(3, 'Review due', 'date'), config: JSON.stringify({ alert_rule_id: 7 }) } as Column
    setupStore({ columns: [makeColumn(1, 'Name'), due] })
    render(<GridStatusFooter />)
    fireEvent.click(screen.getByRole('button', { name: /What do the colors mean/ }))
    const panel = screen.getByRole('dialog', { name: 'What the colors mean' })
    expect(panel.textContent).toContain('Annual review')
    expect(panel.textContent).toContain('Coming up')
    expect(panel.textContent).not.toContain('Not used here')
  })

  it('has no color key when no shown column has a deadline rule', () => {
    render(<GridStatusFooter />)
    expect(screen.queryByTestId('color-key-button')).toBeNull()
  })
})
