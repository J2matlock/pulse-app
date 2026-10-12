/**
 * Filter Evaluation Tests — comprehensive tests for matchFilter logic.
 * Covers all filter operators, column types, edge cases, and compound filters.
 */
import { describe, it, expect } from 'vitest'
import type { ColumnFilter, Column, GridRow } from '../src/shared/types'
import { ROW_TAG_COLUMN_ID } from '../src/shared/types'
import { matchFilter } from '../src/renderer/utils/filterMatch'

// Helper to make rows with required GridRow fields
function makeRow(id: number, vals: Record<number, string | null>): GridRow {
  const row: GridRow = {
    row_id: id, position: 0, is_active: 1, is_starred: 0,
    acuity_level_id: null, deleted_at: null,
    created_at: '2026-01-01', updated_at: '2026-01-01',
  }
  for (const [colId, val] of Object.entries(vals)) {
    (row as Record<string, unknown>)[`col_${colId}`] = val
  }
  return row
}

const textCol = { id: 1, column_type: 'text' } as Column
const numCol = { id: 2, column_type: 'number' } as Column
const dateCol = { id: 3, column_type: 'date' } as Column
const checkCol = { id: 4, column_type: 'checkbox' } as Column
const dropCol = { id: 5, column_type: 'dropdown' } as Column
const allCols = [textCol, numCol, dateCol, checkCol, dropCol]

// ── Text filters ─────────────────────────────────────────────────────────────

describe('Text Filters', () => {
  const row = makeRow(1, { 1: 'Alice Smith' })

  it('contains (case-insensitive)', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'contains', value: 'alice' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'contains', value: 'SMITH' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'contains', value: 'bob' }, allCols)).toBe(false)
  })

  it('not_contains', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'not_contains', value: 'bob' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'not_contains', value: 'alice' }, allCols)).toBe(false)
  })

  it('equals (case-insensitive, full match)', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'equals', value: 'alice smith' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'equals', value: 'ALICE SMITH' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'equals', value: 'Alice' }, allCols)).toBe(false)
  })

  it('not_equals', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'not_equals', value: 'alice smith' }, allCols)).toBe(false)
    expect(matchFilter(row, { columnId: 1, operator: 'not_equals', value: 'bob' }, allCols)).toBe(true)
  })

  it('starts_with (case-insensitive)', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'starts_with', value: 'Ali' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'starts_with', value: 'ali' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'starts_with', value: 'Smi' }, allCols)).toBe(false)
  })

  it('ends_with (case-insensitive)', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'ends_with', value: 'smith' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'ends_with', value: 'SMITH' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'ends_with', value: 'alice' }, allCols)).toBe(false)
  })

  it('special characters in text filter value', () => {
    const specialRow = makeRow(2, { 1: 'O\'Brien, Jane (MD)' })
    expect(matchFilter(specialRow, { columnId: 1, operator: 'contains', value: 'O\'Brien' }, allCols)).toBe(true)
    expect(matchFilter(specialRow, { columnId: 1, operator: 'contains', value: '(MD)' }, allCols)).toBe(true)
    expect(matchFilter(specialRow, { columnId: 1, operator: 'contains', value: ', Jane' }, allCols)).toBe(true)
  })
})

// ── Empty / Not-Empty ────────────────────────────────────────────────────────

describe('Empty / Not-Empty Filters', () => {
  it('is_empty for null value', () => {
    const nullRow = makeRow(1, { 1: null })
    expect(matchFilter(nullRow, { columnId: 1, operator: 'is_empty', value: '' }, allCols)).toBe(true)
  })

  it('is_empty for empty string', () => {
    const emptyRow = makeRow(1, { 1: '' })
    expect(matchFilter(emptyRow, { columnId: 1, operator: 'is_empty', value: '' }, allCols)).toBe(true)
  })

  it('is_empty for undefined (column not set)', () => {
    const noColRow = makeRow(1, {})  // col_1 not in row -> undefined -> rawVal defaults to ''
    expect(matchFilter(noColRow, { columnId: 1, operator: 'is_empty', value: '' }, allCols)).toBe(true)
  })

  it('is_not_empty for populated cell', () => {
    const row = makeRow(1, { 1: 'data' })
    expect(matchFilter(row, { columnId: 1, operator: 'is_not_empty', value: '' }, allCols)).toBe(true)
  })

  it('is_empty false for populated cell', () => {
    const row = makeRow(1, { 1: 'data' })
    expect(matchFilter(row, { columnId: 1, operator: 'is_empty', value: '' }, allCols)).toBe(false)
  })

  it('is_not_empty false for null cell', () => {
    const row = makeRow(1, { 1: null })
    expect(matchFilter(row, { columnId: 1, operator: 'is_not_empty', value: '' }, allCols)).toBe(false)
  })
})

// ── Number filters ───────────────────────────────────────────────────────────

describe('Number Filters', () => {
  const row = makeRow(1, { 2: '42' })

  it('equals for number', () => {
    expect(matchFilter(row, { columnId: 2, operator: 'equals', value: '42' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 2, operator: 'equals', value: '43' }, allCols)).toBe(false)
  })

  it('gt (greater than)', () => {
    expect(matchFilter(row, { columnId: 2, operator: 'gt', value: '40' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 2, operator: 'gt', value: '42' }, allCols)).toBe(false)
    expect(matchFilter(row, { columnId: 2, operator: 'gt', value: '50' }, allCols)).toBe(false)
  })

  it('lt (less than)', () => {
    expect(matchFilter(row, { columnId: 2, operator: 'lt', value: '50' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 2, operator: 'lt', value: '42' }, allCols)).toBe(false)
    expect(matchFilter(row, { columnId: 2, operator: 'lt', value: '10' }, allCols)).toBe(false)
  })

  it('gt/lt with non-numeric cell value returns false', () => {
    const nonNumRow = makeRow(1, { 2: 'abc' })
    expect(matchFilter(nonNumRow, { columnId: 2, operator: 'gt', value: '10' }, allCols)).toBe(false)
    expect(matchFilter(nonNumRow, { columnId: 2, operator: 'lt', value: '10' }, allCols)).toBe(false)
  })

  it('gt/lt with non-numeric filter value returns false', () => {
    expect(matchFilter(row, { columnId: 2, operator: 'gt', value: 'xyz' }, allCols)).toBe(false)
    expect(matchFilter(row, { columnId: 2, operator: 'lt', value: 'xyz' }, allCols)).toBe(false)
  })

  it('gt/lt with empty cell returns false', () => {
    const emptyRow = makeRow(1, { 2: '' })
    expect(matchFilter(emptyRow, { columnId: 2, operator: 'gt', value: '10' }, allCols)).toBe(false)
    expect(matchFilter(emptyRow, { columnId: 2, operator: 'lt', value: '10' }, allCols)).toBe(false)
  })

  it('number between simulation (gt + lt combined)', () => {
    const rows = [
      makeRow(1, { 2: '10' }),
      makeRow(2, { 2: '25' }),
      makeRow(3, { 2: '50' }),
    ]
    const filters: ColumnFilter[] = [
      { columnId: 2, operator: 'gt', value: '15' },
      { columnId: 2, operator: 'lt', value: '40' },
    ]
    const matched = rows.filter(r => filters.every(f => matchFilter(r, f, allCols)))
    expect(matched).toHaveLength(1)
    expect(matched[0].row_id).toBe(2)
  })

  it('decimal number comparisons', () => {
    const decRow = makeRow(1, { 2: '3.14' })
    expect(matchFilter(decRow, { columnId: 2, operator: 'gt', value: '3.0' }, allCols)).toBe(true)
    expect(matchFilter(decRow, { columnId: 2, operator: 'lt', value: '3.2' }, allCols)).toBe(true)
  })

  it('negative number comparisons', () => {
    const negRow = makeRow(1, { 2: '-5' })
    expect(matchFilter(negRow, { columnId: 2, operator: 'lt', value: '0' }, allCols)).toBe(true)
    expect(matchFilter(negRow, { columnId: 2, operator: 'gt', value: '-10' }, allCols)).toBe(true)
  })
})

// ── Date filters ─────────────────────────────────────────────────────────────

describe('Date Filters', () => {
  const row = makeRow(1, { 3: '2026-03-15' })

  it('before', () => {
    expect(matchFilter(row, { columnId: 3, operator: 'before', value: '2026-04-01' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 3, operator: 'before', value: '2026-01-01' }, allCols)).toBe(false)
  })

  it('after', () => {
    expect(matchFilter(row, { columnId: 3, operator: 'after', value: '2026-01-01' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 3, operator: 'after', value: '2026-12-31' }, allCols)).toBe(false)
  })

  it('before/after with empty cell returns false', () => {
    const emptyRow = makeRow(1, { 3: '' })
    expect(matchFilter(emptyRow, { columnId: 3, operator: 'before', value: '2026-01-01' }, allCols)).toBe(false)
    expect(matchFilter(emptyRow, { columnId: 3, operator: 'after', value: '2026-01-01' }, allCols)).toBe(false)
  })

  it('before/after with empty filter value returns false', () => {
    expect(matchFilter(row, { columnId: 3, operator: 'before', value: '' }, allCols)).toBe(false)
    expect(matchFilter(row, { columnId: 3, operator: 'after', value: '' }, allCols)).toBe(false)
  })

  it('is_empty for date column', () => {
    const noDate = makeRow(1, { 3: null })
    expect(matchFilter(noDate, { columnId: 3, operator: 'is_empty', value: '' }, allCols)).toBe(true)
  })

  it('is_not_empty for date column', () => {
    expect(matchFilter(row, { columnId: 3, operator: 'is_not_empty', value: '' }, allCols)).toBe(true)
  })

  it('date between simulation (after + before combined)', () => {
    const rows = [
      makeRow(1, { 3: '2026-01-01' }),
      makeRow(2, { 3: '2026-06-15' }),
      makeRow(3, { 3: '2026-12-31' }),
    ]
    const filters: ColumnFilter[] = [
      { columnId: 3, operator: 'after', value: '2026-03-01' },
      { columnId: 3, operator: 'before', value: '2026-09-01' },
    ]
    const matched = rows.filter(r => filters.every(f => matchFilter(r, f, allCols)))
    expect(matched).toHaveLength(1)
    expect(matched[0].row_id).toBe(2)
  })
})

// ── Checkbox filters ─────────────────────────────────────────────────────────

describe('Checkbox Filters', () => {
  it('equals true for checked', () => {
    const checked = makeRow(1, { 4: 'true' })
    expect(matchFilter(checked, { columnId: 4, operator: 'equals', value: 'true' }, allCols)).toBe(true)
    expect(matchFilter(checked, { columnId: 4, operator: 'equals', value: 'false' }, allCols)).toBe(false)
  })

  it('non-true values normalize to false (is not checked)', () => {
    const unchecked = makeRow(1, { 4: '0' })
    expect(matchFilter(unchecked, { columnId: 4, operator: 'equals', value: 'false' }, allCols)).toBe(true)
    const empty = makeRow(2, { 4: '' })
    expect(matchFilter(empty, { columnId: 4, operator: 'equals', value: 'false' }, allCols)).toBe(true)
    const nullVal = makeRow(3, { 4: null })
    expect(matchFilter(nullVal, { columnId: 4, operator: 'equals', value: 'false' }, allCols)).toBe(true)
  })

  it('not_equals for checkbox', () => {
    const checked = makeRow(1, { 4: 'true' })
    expect(matchFilter(checked, { columnId: 4, operator: 'not_equals', value: 'false' }, allCols)).toBe(true)
    expect(matchFilter(checked, { columnId: 4, operator: 'not_equals', value: 'true' }, allCols)).toBe(false)
  })
})

// ── Dropdown filters ─────────────────────────────────────────────────────────

describe('Dropdown Filters', () => {
  it('equals for dropdown value', () => {
    const row = makeRow(1, { 5: 'Active' })
    expect(matchFilter(row, { columnId: 5, operator: 'equals', value: 'Active' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 5, operator: 'equals', value: 'active' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 5, operator: 'equals', value: 'Closed' }, allCols)).toBe(false)
  })

  it('not_equals for dropdown value', () => {
    const row = makeRow(1, { 5: 'Active' })
    expect(matchFilter(row, { columnId: 5, operator: 'not_equals', value: 'Closed' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 5, operator: 'not_equals', value: 'active' }, allCols)).toBe(false)
  })

  it('is_empty for unset dropdown', () => {
    const row = makeRow(1, { 5: null })
    expect(matchFilter(row, { columnId: 5, operator: 'is_empty', value: '' }, allCols)).toBe(true)
  })

  it('is_not_empty for set dropdown', () => {
    const row = makeRow(1, { 5: 'Active' })
    expect(matchFilter(row, { columnId: 5, operator: 'is_not_empty', value: '' }, allCols)).toBe(true)
  })
})

// ── Row Tag filters ──────────────────────────────────────────────────────────

describe('Row Tag Filters', () => {
  const row = makeRow(1, {})
  const tagsMap = new Map([[1, ['urgent', 'new-client']]])

  it('tag contains (case-insensitive)', () => {
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'contains', value: 'urgent' }, allCols, tagsMap)).toBe(true)
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'contains', value: 'URGENT' }, allCols, tagsMap)).toBe(true)
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'contains', value: 'missing' }, allCols, tagsMap)).toBe(false)
  })

  it('tag not_contains', () => {
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'not_contains', value: 'missing' }, allCols, tagsMap)).toBe(true)
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'not_contains', value: 'urgent' }, allCols, tagsMap)).toBe(false)
  })

  it('tag is_empty for untagged row', () => {
    const untagged = makeRow(2, {})
    expect(matchFilter(untagged, { columnId: ROW_TAG_COLUMN_ID, operator: 'is_empty', value: '' }, allCols, tagsMap)).toBe(true)
  })

  it('tag is_not_empty for tagged row', () => {
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'is_not_empty', value: '' }, allCols, tagsMap)).toBe(true)
  })
})

// ── Compound filters (AND logic) ─────────────────────────────────────────────

describe('Compound Filters (AND logic)', () => {
  const rows = [
    makeRow(1, { 1: 'Alice Smith', 2: '25', 3: '2026-06-01', 4: 'true' }),
    makeRow(2, { 1: 'Bob Jones', 2: '35', 3: '2026-01-15', 4: 'false' }),
    makeRow(3, { 1: 'Alice Jones', 2: '45', 3: '2026-09-20', 4: 'true' }),
    makeRow(4, { 1: 'Charlie Brown', 2: '30', 3: null, 4: 'false' }),
  ]

  it('two text+number filters narrow results', () => {
    const filters: ColumnFilter[] = [
      { columnId: 1, operator: 'contains', value: 'alice' },
      { columnId: 2, operator: 'gt', value: '30' },
    ]
    const matched = rows.filter(r => filters.every(f => matchFilter(r, f, allCols)))
    expect(matched).toHaveLength(1)
    expect(matched[0].row_id).toBe(3)
  })

  it('three filters: text + date + checkbox', () => {
    const filters: ColumnFilter[] = [
      { columnId: 1, operator: 'contains', value: 'Jones' },
      { columnId: 3, operator: 'after', value: '2026-03-01' },
      { columnId: 4, operator: 'equals', value: 'true' },
    ]
    const matched = rows.filter(r => filters.every(f => matchFilter(r, f, allCols)))
    expect(matched).toHaveLength(1)
    expect(matched[0].row_id).toBe(3)
  })

  it('contradictory filters return empty', () => {
    const filters: ColumnFilter[] = [
      { columnId: 1, operator: 'contains', value: 'alice' },
      { columnId: 1, operator: 'contains', value: 'charlie' },
    ]
    const matched = rows.filter(r => filters.every(f => matchFilter(r, f, allCols)))
    expect(matched).toHaveLength(0)
  })

  it('is_empty combined with other filters', () => {
    const filters: ColumnFilter[] = [
      { columnId: 3, operator: 'is_empty', value: '' },
      { columnId: 4, operator: 'equals', value: 'false' },
    ]
    const matched = rows.filter(r => filters.every(f => matchFilter(r, f, allCols)))
    expect(matched).toHaveLength(1)
    expect(matched[0].row_id).toBe(4)
  })
})

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('unknown operator falls through to true', () => {
    const row = makeRow(1, { 1: 'test' })
    expect(matchFilter(row, { columnId: 1, operator: 'between' as any, value: 'x' }, allCols)).toBe(true)
  })

  it('filter on non-existent column (no matching col in columns array)', () => {
    const row = makeRow(1, { 99: 'test' })
    // col is undefined, but rawVal from row[col_99] is 'test'
    expect(matchFilter(row, { columnId: 99, operator: 'contains', value: 'test' }, [textCol])).toBe(true)
  })

  it('whitespace-only value treated as non-empty by is_not_empty', () => {
    const row = makeRow(1, { 1: '   ' })
    expect(matchFilter(row, { columnId: 1, operator: 'is_not_empty', value: '' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'is_empty', value: '' }, allCols)).toBe(false)
  })

  it('contains with empty filter value matches everything', () => {
    const row = makeRow(1, { 1: 'anything' })
    expect(matchFilter(row, { columnId: 1, operator: 'contains', value: '' }, allCols)).toBe(true)
  })
})

// ── Files and auto-number columns (Q-049) ───────────────────────────────────

describe('Files and auto-number columns', () => {
  const filesCol = { id: 6, column_type: 'file_count' } as Column
  const autoCol = { id: 7, column_type: 'auto_number' } as Column
  const cols = [filesCol, autoCol]
  // The grid query gives a Files column as a number (a COUNT)
  const withFiles = (n: number, auto: string | null) => {
    const row = makeRow(1, { 7: auto })
    ;(row as Record<string, unknown>).col_6 = n
    return row
  }

  it('compares how many files as numbers, 0 included', () => {
    expect(matchFilter(withFiles(3, null), { columnId: 6, operator: 'gt', value: '2' }, cols)).toBe(true)
    expect(matchFilter(withFiles(1, null), { columnId: 6, operator: 'gt', value: '2' }, cols)).toBe(false)
    expect(matchFilter(withFiles(0, null), { columnId: 6, operator: 'lt', value: '1' }, cols)).toBe(true)
    expect(matchFilter(withFiles(0, null), { columnId: 6, operator: 'equals', value: '0' }, cols)).toBe(true)
    expect(matchFilter(withFiles(2, null), { columnId: 6, operator: 'not_equals', value: '2' }, cols)).toBe(false)
  })

  it('compares an auto number by its number for greater and less than, and as text otherwise', () => {
    expect(matchFilter(withFiles(0, 'J-0042'), { columnId: 7, operator: 'gt', value: '40' }, cols)).toBe(true)
    expect(matchFilter(withFiles(0, 'J-0042'), { columnId: 7, operator: 'gt', value: 'J-0050' }, cols)).toBe(false)
    expect(matchFilter(withFiles(0, 'J-0042'), { columnId: 7, operator: 'lt', value: '100' }, cols)).toBe(true)
    expect(matchFilter(withFiles(0, 'J-0042'), { columnId: 7, operator: 'equals', value: 'j-0042' }, cols)).toBe(true)
    expect(matchFilter(withFiles(0, null), { columnId: 7, operator: 'gt', value: '1' }, cols)).toBe(false)
  })
})
