/**
 * Sorting Tests — verifies sort behavior at the database level using the pivot query pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTestDb,
  cleanupTestDb,
  seedGrid,
  type TestDb,
} from './helpers'

let t: TestDb

beforeEach(() => { t = createTestDb() })
afterEach(() => { cleanupTestDb(t) })

/** Build a pivot query and sort by a column expression */
function queryGridSorted(
  gridId: number,
  columnIds: number[],
  orderExpr: string
): Record<string, unknown>[] {
  const columnCases = columnIds
    .map(id => `MAX(CASE WHEN c.column_id = ${id} THEN c.value END) AS col_${id}`)
    .join(', ')
  const query = `
    SELECT r.id AS row_id, r.position, r.is_active, r.is_starred,
           ${columnCases}
    FROM rows r
    LEFT JOIN cells c ON c.row_id = r.id
    WHERE r.grid_id = ? AND r.is_active = 1
    GROUP BY r.id
    ORDER BY ${orderExpr}
  `
  return t.db.prepare(query).all(gridId) as Record<string, unknown>[]
}

// ── Single Column Sort ───────────────────────────────────────────────────────

describe('Single Column Sort', () => {
  it('text ascending: A, B, C order', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], colId, 'Charlie')
    ins.run(rowIds[1], colId, 'Alice')
    ins.run(rowIds[2], colId, 'Bob')

    const rows = queryGridSorted(gridId, columnIds, `col_${colId} ASC`)
    expect(rows.map(r => r[`col_${colId}`])).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('text descending: Z, Y, X order', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], colId, 'Alpha')
    ins.run(rowIds[1], colId, 'Zulu')
    ins.run(rowIds[2], colId, 'Mike')

    const rows = queryGridSorted(gridId, columnIds, `col_${colId} DESC`)
    expect(rows.map(r => r[`col_${colId}`])).toEqual(['Zulu', 'Mike', 'Alpha'])
  })

  it('date ascending: earliest first (not alphabetical)', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 3, columnCount: 1, columnTypes: ['date'] })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], colId, '2026-12-01')
    ins.run(rowIds[1], colId, '2026-02-01')
    ins.run(rowIds[2], colId, '2026-07-15')

    // Date strings in YYYY-MM-DD format sort correctly as text
    const rows = queryGridSorted(gridId, columnIds, `col_${colId} ASC`)
    expect(rows.map(r => r[`col_${colId}`])).toEqual(['2026-02-01', '2026-07-15', '2026-12-01'])
  })

  it('number sort: numeric order (2 before 10)', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 4, columnCount: 1, columnTypes: ['number'] })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], colId, '10')
    ins.run(rowIds[1], colId, '2')
    ins.run(rowIds[2], colId, '100')
    ins.run(rowIds[3], colId, '1')

    // CAST to numeric for proper sorting
    const rows = queryGridSorted(gridId, columnIds, `CAST(col_${colId} AS REAL) ASC`)
    expect(rows.map(r => r[`col_${colId}`])).toEqual(['1', '2', '10', '100'])
  })

  it('checkbox sort: unchecked (0) first ascending', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 3, columnCount: 1, columnTypes: ['checkbox'] })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], colId, '1')
    ins.run(rowIds[1], colId, '0')
    ins.run(rowIds[2], colId, '1')

    const rows = queryGridSorted(gridId, columnIds, `col_${colId} ASC`)
    expect(rows.map(r => r[`col_${colId}`])).toEqual(['0', '1', '1'])
  })
})

// ── Multi-Column Sort ────────────────────────────────────────────────────────

describe('Multi-Column Sort', () => {
  it('sort by Status (primary), then Name (secondary)', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 4, columnCount: 2 })
    const [nameCol, statusCol] = columnIds
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], nameCol, 'Charlie'); ins.run(rowIds[0], statusCol, 'Active')
    ins.run(rowIds[1], nameCol, 'Alice');   ins.run(rowIds[1], statusCol, 'Inactive')
    ins.run(rowIds[2], nameCol, 'Bob');     ins.run(rowIds[2], statusCol, 'Active')
    ins.run(rowIds[3], nameCol, 'Diana');   ins.run(rowIds[3], statusCol, 'Inactive')

    const rows = queryGridSorted(gridId, columnIds, `col_${statusCol} ASC, col_${nameCol} ASC`)
    expect(rows.map(r => r[`col_${nameCol}`])).toEqual(['Bob', 'Charlie', 'Alice', 'Diana'])
  })

  it('sort by 3 columns: priority order respected', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 4, columnCount: 3 })
    const [c1, c2, c3] = columnIds
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], c1, 'A'); ins.run(rowIds[0], c2, '2'); ins.run(rowIds[0], c3, 'X')
    ins.run(rowIds[1], c1, 'A'); ins.run(rowIds[1], c2, '1'); ins.run(rowIds[1], c3, 'Y')
    ins.run(rowIds[2], c1, 'B'); ins.run(rowIds[2], c2, '1'); ins.run(rowIds[2], c3, 'X')
    ins.run(rowIds[3], c1, 'A'); ins.run(rowIds[3], c2, '1'); ins.run(rowIds[3], c3, 'X')

    const rows = queryGridSorted(gridId, columnIds, `col_${c1} ASC, col_${c2} ASC, col_${c3} ASC`)
    // A,1,X → A,1,Y → A,2,X → B,1,X
    expect(rows.map(r => [r[`col_${c1}`], r[`col_${c2}`], r[`col_${c3}`]])).toEqual([
      ['A', '1', 'X'],
      ['A', '1', 'Y'],
      ['A', '2', 'X'],
      ['B', '1', 'X'],
    ])
  })
})

// ── Null Handling ────────────────────────────────────────────────────────────

describe('Null Handling in Sort', () => {
  it('NULL values sort to bottom in ascending order', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 4, columnCount: 1 })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], colId, 'Charlie')
    ins.run(rowIds[1], colId, null)
    ins.run(rowIds[2], colId, 'Alice')
    // rowIds[3] has no cell at all (also NULL via LEFT JOIN)

    const rows = queryGridSorted(gridId, columnIds,
      `CASE WHEN col_${colId} IS NULL THEN 1 ELSE 0 END, col_${colId} ASC`)
    const values = rows.map(r => r[`col_${colId}`])
    // Non-null values first (sorted), then nulls
    expect(values[0]).toBe('Alice')
    expect(values[1]).toBe('Charlie')
    expect(values[2]).toBeNull()
    expect(values[3]).toBeNull()
  })

  it('NULL values sort to bottom in descending order', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ins.run(rowIds[0], colId, 'Zulu')
    ins.run(rowIds[1], colId, null)
    ins.run(rowIds[2], colId, 'Alpha')

    const rows = queryGridSorted(gridId, columnIds,
      `CASE WHEN col_${colId} IS NULL THEN 1 ELSE 0 END, col_${colId} DESC`)
    const values = rows.map(r => r[`col_${colId}`])
    expect(values[0]).toBe('Zulu')
    expect(values[1]).toBe('Alpha')
    expect(values[2]).toBeNull()
  })
})

// ── Sort Persistence ─────────────────────────────────────────────────────────

describe('Sort Persistence', () => {
  it('sort_config stored and retrieved correctly from grids table', () => {
    const { gridId } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const sortConfig = JSON.stringify([{ columnId: 1, direction: 'asc', priority: 0 }])
    t.db.prepare('UPDATE grids SET sort_config = ? WHERE id = ?').run(sortConfig, gridId)

    const grid = t.db.prepare('SELECT sort_config FROM grids WHERE id = ?').get(gridId) as { sort_config: string }
    const parsed = JSON.parse(grid.sort_config)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].columnId).toBe(1)
    expect(parsed[0].direction).toBe('asc')
  })

  it('multi-column sort config persists', () => {
    const { gridId } = seedGrid(t.db, { rowCount: 1, columnCount: 3 })
    const sortConfig = JSON.stringify([
      { columnId: 1, direction: 'asc', priority: 0 },
      { columnId: 2, direction: 'desc', priority: 1 },
    ])
    t.db.prepare('UPDATE grids SET sort_config = ? WHERE id = ?').run(sortConfig, gridId)

    const grid = t.db.prepare('SELECT sort_config FROM grids WHERE id = ?').get(gridId) as { sort_config: string }
    const parsed = JSON.parse(grid.sort_config)
    expect(parsed).toHaveLength(2)
    expect(parsed[1].direction).toBe('desc')
  })
})
