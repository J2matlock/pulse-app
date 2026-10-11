// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

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

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { CellConditionalFormatPanel, evalCellFormat } from '../../../../src/renderer/components/grid/CellConditionalFormatPanel'
import type { Column, GridRow, CellFormatRule } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: id === 1 ? 1 : 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function setupStore() {
  useGridStore.setState({
    columns: [makeColumn(1, 'Name'), makeColumn(2, 'Score', 'number')],
    rows: [
      { row_id: 1, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_1: 'Alice', col_2: '90' } as unknown as GridRow,
    ],
    cellFormats: new Map(),
    setCellFormat: vi.fn().mockResolvedValue(undefined),
    batchSetCellFormat: vi.fn().mockResolvedValue(undefined),
    updateColumn: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof useGridStore.setState>[0])
}

beforeEach(() => { setWords() })

describe('CellConditionalFormatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStore()
  })

  it('renders cell mode title', () => {
    render(<CellConditionalFormatPanel rowId={1} columnId={1} onClose={vi.fn()} />)
    expect(screen.getByText('Auto-Highlight Cell')).toBeTruthy()
  })

  it('renders column mode title', () => {
    render(<CellConditionalFormatPanel columnId={1} onClose={vi.fn()} mode="column" />)
    expect(screen.getByText('Auto-Highlight Column')).toBeTruthy()
  })

  it('shows empty state with Add highlight rule button', () => {
    render(<CellConditionalFormatPanel rowId={1} columnId={1} onClose={vi.fn()} />)
    expect(screen.getByText(/No highlight rules yet/)).toBeTruthy()
    expect(screen.getByText('Add highlight rule')).toBeTruthy()
  })

  it('talks about the list\'s records, not rows (R1)', () => {
    render(<CellConditionalFormatPanel rowId={1} columnId={2} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Add highlight rule'))
    expect(screen.getByText('Another column of the same client (e.g. a checkbox)')).toBeTruthy()
    expect(screen.getByText('A cell of another client')).toBeTruthy()
    expect(screen.getByText('Highlight the whole client when matched')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\brow\b/i)
  })

  it('"All rows in this column" saves a column rule, so new records get it too (L-19)', async () => {
    render(<CellConditionalFormatPanel rowId={1} columnId={2} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Add highlight rule'))
    fireEvent.change(screen.getByDisplayValue('This cell only'), { target: { value: 'all_rows' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply' })) })
    const updateColumn = useGridStore.getState().updateColumn as unknown as ReturnType<typeof vi.fn>
    expect(updateColumn).toHaveBeenCalledWith(2, { conditional_format: expect.any(String) })
    const saved = JSON.parse((updateColumn.mock.calls[0]![1] as { conditional_format: string }).conditional_format) as Array<Record<string, unknown>>
    expect(saved).toHaveLength(1)
    expect(saved[0]).not.toHaveProperty('originRowId')
    expect(useGridStore.getState().batchSetCellFormat).not.toHaveBeenCalled()
  })

  it('Close button calls onClose', () => {
    const onClose = vi.fn()
    render(<CellConditionalFormatPanel rowId={1} columnId={1} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('evalCellFormat', () => {
  it('returns null for empty rules', () => {
    expect(evalCellFormat([], 'test', {}, new Map())).toBeNull()
  })

  it('matches equals operator', () => {
    const rule: CellFormatRule = { sourceType: 'self', operator: 'equals', value: 'hello', bgColor: '#ff0' }
    expect(evalCellFormat([rule], 'hello', {}, new Map())).toBe(rule)
    expect(evalCellFormat([rule], 'world', {}, new Map())).toBeNull()
  })

  it('matches is_empty operator', () => {
    const rule: CellFormatRule = { sourceType: 'self', operator: 'is_empty', value: '', bgColor: '#ff0' }
    expect(evalCellFormat([rule], '', {}, new Map())).toBe(rule)
    expect(evalCellFormat([rule], null, {}, new Map())).toBe(rule)
    expect(evalCellFormat([rule], 'filled', {}, new Map())).toBeNull()
  })

  it('matches greater_than operator for numbers', () => {
    const rule: CellFormatRule = { sourceType: 'self', operator: 'greater_than', value: '50', bgColor: '#ff0' }
    expect(evalCellFormat([rule], '60', {}, new Map())).toBe(rule)
    expect(evalCellFormat([rule], '40', {}, new Map())).toBeNull()
  })
})
