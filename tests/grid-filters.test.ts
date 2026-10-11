/**
 * Grid Filter Tests — tests the matchFilter logic and FilterOperator behavior.
 * Now imports matchFilter directly from the extracted utility.
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
const allCols = [textCol, numCol, dateCol, checkCol]

// ── Text filters ──────────────────────────────────────────────────────────────

describe('Text Filters', () => {
  const row = makeRow(1, { 1: 'Alice Smith' })

  it('contains (case-insensitive)', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'contains', value: 'alice' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'contains', value: 'bob' }, allCols)).toBe(false)
  })

  it('not_contains', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'not_contains', value: 'bob' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'not_contains', value: 'alice' }, allCols)).toBe(false)
  })

  it('equals (case-insensitive)', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'equals', value: 'alice smith' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'equals', value: 'Alice' }, allCols)).toBe(false)
  })

  it('not_equals', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'not_equals', value: 'alice smith' }, allCols)).toBe(false)
    expect(matchFilter(row, { columnId: 1, operator: 'not_equals', value: 'bob' }, allCols)).toBe(true)
  })

  it('starts_with', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'starts_with', value: 'Ali' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'starts_with', value: 'Smi' }, allCols)).toBe(false)
  })

  it('ends_with', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'ends_with', value: 'smith' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 1, operator: 'ends_with', value: 'alice' }, allCols)).toBe(false)
  })
})

// ── Empty / Not-Empty ─────────────────────────────────────────────────────────

describe('Empty / Not-Empty Filters', () => {
  it('is_empty for null/empty', () => {
    const emptyRow = makeRow(1, { 1: '' })
    const nullRow = makeRow(2, {}) // col_1 not set → rawVal defaults to ''
    expect(matchFilter(emptyRow, { columnId: 1, operator: 'is_empty', value: '' }, allCols)).toBe(true)
    expect(matchFilter(nullRow, { columnId: 1, operator: 'is_empty', value: '' }, allCols)).toBe(true)
  })

  it('is_not_empty for populated cell', () => {
    const row = makeRow(1, { 1: 'data' })
    expect(matchFilter(row, { columnId: 1, operator: 'is_not_empty', value: '' }, allCols)).toBe(true)
  })

  it('is_empty false for populated cell', () => {
    const row = makeRow(1, { 1: 'data' })
    expect(matchFilter(row, { columnId: 1, operator: 'is_empty', value: '' }, allCols)).toBe(false)
  })
})

// ── Number filters ────────────────────────────────────────────────────────────

describe('Number Filters', () => {
  const row = makeRow(1, { 2: '42' })

  it('gt (greater than)', () => {
    expect(matchFilter(row, { columnId: 2, operator: 'gt', value: '40' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 2, operator: 'gt', value: '50' }, allCols)).toBe(false)
  })

  it('lt (less than)', () => {
    expect(matchFilter(row, { columnId: 2, operator: 'lt', value: '50' }, allCols)).toBe(true)
    expect(matchFilter(row, { columnId: 2, operator: 'lt', value: '10' }, allCols)).toBe(false)
  })

  it('gt/lt with non-numeric value returns false', () => {
    const nonNumRow = makeRow(1, { 2: 'abc' })
    expect(matchFilter(nonNumRow, { columnId: 2, operator: 'gt', value: '10' }, allCols)).toBe(false)
    expect(matchFilter(nonNumRow, { columnId: 2, operator: 'lt', value: '10' }, allCols)).toBe(false)
  })

  it('reads typed amounts the way paste does: "1,000", "$100", "1200.5" (bug sweep S3)', () => {
    const money = { id: 9, column_type: 'currency' } as Column
    const cols = [...allCols, money]
    const small = makeRow(1, { 9: '50' }), big = makeRow(2, { 9: '1200.50' })
    expect(matchFilter(small, { columnId: 9, operator: 'gt', value: '1,000' }, cols)).toBe(false)
    expect(matchFilter(big, { columnId: 9, operator: 'gt', value: '1,000' }, cols)).toBe(true)
    expect(matchFilter(small, { columnId: 9, operator: 'gt', value: '$10' }, cols)).toBe(true)
    expect(matchFilter(big, { columnId: 9, operator: 'equals', value: '1200.5' }, cols)).toBe(true)
    expect(matchFilter(big, { columnId: 9, operator: 'equals', value: '$1,200.50' }, cols)).toBe(true)
    expect(matchFilter(big, { columnId: 9, operator: 'not_equals', value: '1200.5' }, cols)).toBe(false)
  })
})

describe('Age and Days-until filters (bug sweep S5)', () => {
  const dob = { id: 20, column_type: 'date', config: '{}' } as Column
  const age = { id: 21, column_type: 'age_from_dob', config: JSON.stringify({ source_column_id: 20 }) } as Column
  const days = { id: 22, column_type: 'calculated_days', config: JSON.stringify({ source_column_id: 20 }) } as Column
  const cols = [dob, age, days]
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const yearsAgo = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); d.setDate(d.getDate() - 1); return ymd(d) }

  it('compares the age the cell shows, not the empty stored value', () => {
    const older = makeRow(1, { 20: yearsAgo(70) }), younger = makeRow(2, { 20: yearsAgo(30) }), none = makeRow(3, {})
    expect(matchFilter(older, { columnId: 21, operator: 'gt', value: '65' }, cols)).toBe(true)
    expect(matchFilter(younger, { columnId: 21, operator: 'gt', value: '65' }, cols)).toBe(false)
    expect(matchFilter(younger, { columnId: 21, operator: 'equals', value: '30' }, cols)).toBe(true)
    expect(matchFilter(older, { columnId: 21, operator: 'is_empty', value: '' }, cols)).toBe(false)
    expect(matchFilter(none, { columnId: 21, operator: 'is_empty', value: '' }, cols)).toBe(true)
  })

  it('compares the days until the date', () => {
    const d = new Date(); d.setDate(d.getDate() + 10)
    const soon = makeRow(1, { 20: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
    expect(matchFilter(soon, { columnId: 22, operator: 'lt', value: '14' }, cols)).toBe(true)
    expect(matchFilter(soon, { columnId: 22, operator: 'equals', value: '10' }, cols)).toBe(true)
  })
})

// ── Date filters ──────────────────────────────────────────────────────────────

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
})

// ── Checkbox filters ──────────────────────────────────────────────────────────

describe('Checkbox Filters', () => {
  it('equals true', () => {
    const checked = makeRow(1, { 4: 'true' })
    expect(matchFilter(checked, { columnId: 4, operator: 'equals', value: 'true' }, allCols)).toBe(true)
    expect(matchFilter(checked, { columnId: 4, operator: 'equals', value: 'false' }, allCols)).toBe(false)
  })

  it('non-true values normalize to false', () => {
    const unchecked = makeRow(1, { 4: '0' })
    expect(matchFilter(unchecked, { columnId: 4, operator: 'equals', value: 'false' }, allCols)).toBe(true)
    const empty = makeRow(2, { 4: '' })
    expect(matchFilter(empty, { columnId: 4, operator: 'equals', value: 'false' }, allCols)).toBe(true)
  })
})

// ── Row Tag filters ───────────────────────────────────────────────────────────

describe('Row Tag Filters', () => {
  const row = makeRow(1, {})
  const tagsMap = new Map([[1, ['urgent', 'new-client']]])

  it('tag contains (case-insensitive)', () => {
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'contains', value: 'urgent' }, allCols, tagsMap)).toBe(true)
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'contains', value: 'missing' }, allCols, tagsMap)).toBe(false)
  })

  it('tag not_contains', () => {
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'not_contains', value: 'missing' }, allCols, tagsMap)).toBe(true)
  })

  it('tag is_empty for untagged row', () => {
    const untagged = makeRow(2, {})
    expect(matchFilter(untagged, { columnId: ROW_TAG_COLUMN_ID, operator: 'is_empty', value: '' }, allCols, tagsMap)).toBe(true)
  })

  it('tag is_not_empty for tagged row', () => {
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: 'is_not_empty', value: '' }, allCols, tagsMap)).toBe(true)
  })
})

// ── Multi-filter (AND logic) ──────────────────────────────────────────────────

describe('Multi-filter AND logic', () => {
  const rows = [
    makeRow(1, { 1: 'Alice Smith', 2: '25' }),
    makeRow(2, { 1: 'Bob Jones', 2: '35' }),
    makeRow(3, { 1: 'Alice Jones', 2: '45' }),
  ]

  it('two filters combined narrow results', () => {
    const filters: ColumnFilter[] = [
      { columnId: 1, operator: 'contains', value: 'alice' },
      { columnId: 2, operator: 'gt', value: '30' },
    ]
    const matched = rows.filter(r => filters.every(f => matchFilter(r, f, allCols)))
    expect(matched).toHaveLength(1)
    expect(matched[0].row_id).toBe(3)
  })
})
