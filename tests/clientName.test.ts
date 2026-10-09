/**
 * Client Name Utility Tests — pure functions, no deps.
 * Tests getClientName() and findNameColumnIds() from src/renderer/utils/clientName.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { getClientName, findNameColumnIds } from '../src/renderer/utils/clientName'
import type { Column, GridRow } from '../src/shared/types'
import { setWords } from './renderer/vocabFixture'
import { useGridStore } from '../src/renderer/stores/gridStore'

/** Helper to build a minimal Column object with sensible defaults. */
function makeColumn(overrides: Partial<Column> & { id: number; name: string }): Column {
  return {
    grid_id: 1,
    column_type: 'text',
    width: 200,
    position: 0,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: 0,
    default_value: null,
    description: null,
    config: '{}',
    conditional_format: '[]',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Helper to build a minimal GridRow with dynamic col_ fields. */
function makeRow(cols: Record<string, string | null>, overrides?: Partial<GridRow>): GridRow {
  return {
    row_id: 1,
    position: 0,
    is_active: 1,
    is_starred: 0,
    acuity_level_id: null,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...cols,
    ...overrides,
  } as GridRow
}

// ---------------------------------------------------------------------------
// getClientName
// ---------------------------------------------------------------------------
describe('getClientName', () => {
  beforeEach(() => { setWords() })

  it('returns "First Last" when both name and last name columns have values', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Jane', col_2: 'Doe' })
    expect(getClientName(row, columns)).toBe('Jane Doe')
  })

  it('returns first name only when last name column is absent', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Client Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Phone', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Marcus', col_2: '555-1234' })
    expect(getClientName(row, columns)).toBe('Marcus')
  })

  it('returns first name only when last name column exists but is empty', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Ava', col_2: '' })
    expect(getClientName(row, columns)).toBe('Ava')
  })

  it('returns first name only when last name column value is null', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Ava', col_2: null })
    expect(getClientName(row, columns)).toBe('Ava')
  })

  it('returns last name only when name column value is empty', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Surname', position: 1 }),
    ]
    const row = makeRow({ col_1: '', col_2: 'Williams' })
    expect(getClientName(row, columns)).toBe('Williams')
  })

  it('returns last name only when name column value is null', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: null, col_2: 'Garcia' })
    expect(getClientName(row, columns)).toBe('Garcia')
  })

  it('returns default fallback when both name values are empty', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: '', col_2: '' })
    expect(getClientName(row, columns)).toBe('Unnamed client')
  })

  it('returns default fallback when both name values are null', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: null, col_2: null })
    expect(getClientName(row, columns)).toBe('Unnamed client')
  })

  it('returns default fallback when no is_name_column is flagged', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First Name' }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Jane', col_2: 'Doe' })
    expect(getClientName(row, columns)).toBe('Unnamed client')
  })

  it('returns custom fallback when provided', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1 }),
    ]
    const row = makeRow({ col_1: '' })
    expect(getClientName(row, columns, 'No Name')).toBe('No Name')
  })

  it('returns custom fallback when no name column exists', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Notes' }),
    ]
    const row = makeRow({ col_1: 'some text' })
    expect(getClientName(row, columns, '(unknown)')).toBe('(unknown)')
  })

  it('trims whitespace from first and last names', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: '  Jane  ', col_2: '  Doe  ' })
    expect(getClientName(row, columns)).toBe('Jane Doe')
  })

  it('treats whitespace-only name as empty (falls back)', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: '   ', col_2: '   ' })
    expect(getClientName(row, columns)).toBe('Unnamed client')
  })

  it('handles special characters in names', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: "Mary-Jo", col_2: "O'Brien" })
    expect(getClientName(row, columns)).toBe("Mary-Jo O'Brien")
  })

  it('handles unicode and accented characters', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Rene', col_2: 'Descartes' })
    expect(getClientName(row, columns)).toBe('Rene Descartes')

    const row2 = makeRow({ col_1: 'Bjork', col_2: 'Gudmundsdottir' })
    expect(getClientName(row2, columns)).toBe('Bjork Gudmundsdottir')
  })

  it('handles very long names without truncation', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    const longFirst = 'A'.repeat(200)
    const longLast = 'B'.repeat(200)
    const row = makeRow({ col_1: longFirst, col_2: longLast })
    expect(getClientName(row, columns)).toBe(`${longFirst} ${longLast}`)
    expect(getClientName(row, columns).length).toBe(401)
  })

  // -- Last-name pattern matching --

  it('recognizes "lastname" (no space) as last name column', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'lastname', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Alice', col_2: 'Smith' })
    expect(getClientName(row, columns)).toBe('Alice Smith')
  })

  it('recognizes "Surname" as last name column (case insensitive)', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Surname', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Bob', col_2: 'Jones' })
    expect(getClientName(row, columns)).toBe('Bob Jones')
  })

  it('recognizes "Family Name" as last name column', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Given', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Family Name', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Yuki', col_2: 'Tanaka' })
    expect(getClientName(row, columns)).toBe('Yuki Tanaka')
  })

  it('recognizes "LNAME" as last name column (all caps)', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'LNAME', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Carlos', col_2: 'Rivera' })
    expect(getClientName(row, columns)).toBe('Carlos Rivera')
  })

  it('recognizes "Last" (just the word) as last name column', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Last', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Diana', col_2: 'Prince' })
    expect(getClientName(row, columns)).toBe('Diana Prince')
  })

  it('does NOT match non-last-name columns (e.g., "Address")', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1 }),
      makeColumn({ id: 2, name: 'Address', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Eve', col_2: '123 Main St' })
    expect(getClientName(row, columns)).toBe('Eve')
  })

  it('trims column name before matching last-name pattern', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
      makeColumn({ id: 2, name: '  Last Name  ', position: 1 }),
    ]
    const row = makeRow({ col_1: 'Frank', col_2: 'Castle' })
    expect(getClientName(row, columns)).toBe('Frank Castle')
  })

  // -- Multiple columns / edge cases --

  it('does not use the name column itself as the last name column', () => {
    // If the is_name_column is coincidentally named "Last Name", it should not
    // also be used as the last name detection column.
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Last Name', is_name_column: 1 }),
    ]
    const row = makeRow({ col_1: 'Thompson' })
    expect(getClientName(row, columns)).toBe('Thompson')
  })

  it('picks the first matching last-name column when multiple exist', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First', is_name_column: 1, position: 0 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
      makeColumn({ id: 3, name: 'Surname', position: 2 }),
    ]
    const row = makeRow({ col_1: 'John', col_2: 'Doe', col_3: 'Smith' })
    // Array.find returns the first match in columns array order
    expect(getClientName(row, columns)).toBe('John Doe')
  })

  it('works with high column IDs', () => {
    const columns: Column[] = [
      makeColumn({ id: 999, name: 'Name', is_name_column: 1 }),
      makeColumn({ id: 1000, name: 'Last Name', position: 1 }),
    ]
    const row = makeRow({ col_999: 'High', col_1000: 'ID' })
    expect(getClientName(row, columns)).toBe('High ID')
  })

  it('returns fallback when row has no matching col_ key for name column', () => {
    const columns: Column[] = [
      makeColumn({ id: 5, name: 'Name', is_name_column: 1 }),
    ]
    // Row doesn't have col_5 at all — accessing it yields undefined
    const row = makeRow({})
    expect(getClientName(row, columns)).toBe('Unnamed client')
  })

  it('handles empty columns array', () => {
    const row = makeRow({ col_1: 'Hello' })
    expect(getClientName(row, [])).toBe('Unnamed client')
  })
})

describe('getClientName with a display format', () => {
  const columns: Column[] = [
    makeColumn({ id: 1, name: 'Nickname', is_name_column: 1 }),
    makeColumn({ id: 2, name: 'Make', position: 1 }),
    makeColumn({ id: 3, name: 'Plate', position: 2 }),
  ]
  const withFormat = (display_format: string | null) =>
    useGridStore.setState({ grids: [{ id: 1, name: 'Vehicles', display_format } as never] })

  beforeEach(() => { setWords() })

  it('uses the list\'s format', () => {
    withFormat('{Make} – {Plate}')
    expect(getClientName(makeRow({ col_1: 'Old blue', col_2: 'Honda', col_3: 'ABC123' }), columns)).toBe('Honda – ABC123')
    expect(getClientName(makeRow({ col_1: 'Old blue', col_2: 'Honda', col_3: null }), columns)).toBe('Honda')
  })

  it('falls back to the name column when the format comes out empty, or there is none', () => {
    withFormat('{Plate}')
    expect(getClientName(makeRow({ col_1: 'Old blue', col_3: null }), columns)).toBe('Old blue')
    withFormat(null)
    expect(getClientName(makeRow({ col_1: 'Old blue', col_2: 'Honda', col_3: 'ABC123' }), columns)).toBe('Old blue')
  })
})

// ---------------------------------------------------------------------------
// findNameColumnIds
// ---------------------------------------------------------------------------
describe('findNameColumnIds', () => {
  it('returns both IDs when name and last-name columns exist', () => {
    const columns: Column[] = [
      makeColumn({ id: 10, name: 'First Name', is_name_column: 1 }),
      makeColumn({ id: 20, name: 'Last Name', position: 1 }),
    ]
    expect(findNameColumnIds(columns)).toEqual({ nameColId: 10, lastNameColId: 20 })
  })

  it('returns nameColId only when no last-name column exists', () => {
    const columns: Column[] = [
      makeColumn({ id: 7, name: 'Client', is_name_column: 1 }),
      makeColumn({ id: 8, name: 'Status', position: 1 }),
    ]
    expect(findNameColumnIds(columns)).toEqual({ nameColId: 7, lastNameColId: null })
  })

  it('returns both null when no name column is flagged', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'First Name' }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
    ]
    expect(findNameColumnIds(columns)).toEqual({ nameColId: null, lastNameColId: null })
  })

  it('returns both null for empty columns array', () => {
    expect(findNameColumnIds([])).toEqual({ nameColId: null, lastNameColId: null })
  })

  it('does not return the name column as the last-name column even if named "Last Name"', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Last Name', is_name_column: 1 }),
    ]
    // The name column is id=1, and since it's excluded from last-name search,
    // lastNameColId should be null
    expect(findNameColumnIds(columns)).toEqual({ nameColId: 1, lastNameColId: null })
  })

  it('recognizes all last-name patterns', () => {
    const patterns = ['last', 'Last Name', 'lastname', 'SURNAME', 'family name', 'lname']
    for (const pattern of patterns) {
      const columns: Column[] = [
        makeColumn({ id: 1, name: 'First', is_name_column: 1 }),
        makeColumn({ id: 2, name: pattern, position: 1 }),
      ]
      const result = findNameColumnIds(columns)
      expect(result.lastNameColId, `Expected "${pattern}" to match as last-name column`).toBe(2)
    }
  })

  it('picks the first matching last-name column', () => {
    const columns: Column[] = [
      makeColumn({ id: 1, name: 'Name', is_name_column: 1, position: 0 }),
      makeColumn({ id: 2, name: 'Last Name', position: 1 }),
      makeColumn({ id: 3, name: 'Surname', position: 2 }),
    ]
    expect(findNameColumnIds(columns)).toEqual({ nameColId: 1, lastNameColId: 2 })
  })
})
