// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

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

  it('shows "results" when search is active', () => {
    setupStore({ searchQuery: 'test' })
    render(<GridStatusFooter />)
    expect(screen.getByText('3 results')).toBeTruthy()
  })

  it('shows singular form for 1 client', () => {
    setupStore({ rows: [makeRow(1)] })
    render(<GridStatusFooter />)
    expect(screen.getByText('1 client')).toBeTruthy()
  })

  it('shows selection count when rows are selected', () => {
    setupStore({ selectedRowIds: new Set([1, 2]) })
    render(<GridStatusFooter />)
    expect(screen.getByText(/Selected: 2/)).toBeTruthy()
  })
})
