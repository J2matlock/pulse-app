/**
 * Export Tests — CSV export correctness, value formatting, PDF generation,
 * special character handling, and supervisor report queries.
 * Tests the data-layer logic directly against real SQLCipher DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import Papa from 'papaparse'

let t: TestDb
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }
})

import { formatDate, sanitizeCsvFormula, unguardCsvFormula, formatCellValue, stripHtml } from '../src/main/export-shared'

beforeEach(() => { t = createTestDb() })
afterEach(() => { cleanupTestDb(t) })

// The real export helpers (the file used to test hand-copied mirrors of them)
// ── CSV Export Logic ─────────────────────────────────────────────────────────

describe('CSV Export Logic', () => {
  it('generates headers matching column names', () => {
    const { gridId, columnIds } = seedGrid(t.db, { rowCount: 1, columnCount: 3 })
    t.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Name', columnIds[0])
    t.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Date', columnIds[1])
    t.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Status', columnIds[2])

    const columns = t.db.prepare('SELECT id, name FROM columns WHERE grid_id = ? ORDER BY position')
      .all(gridId) as { id: number; name: string }[]
    expect(columns.map(c => c.name)).toEqual(['Name', 'Date', 'Status'])
  })

  it('exports cell values in correct columns via pivot query', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 2, columnCount: 3 })
    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Alice')
    insert.run(rowIds[0], columnIds[1], '2024-03-15')
    insert.run(rowIds[0], columnIds[2], 'Active')
    insert.run(rowIds[1], columnIds[0], 'Bob')
    insert.run(rowIds[1], columnIds[2], 'Inactive')

    const columns = t.db.prepare('SELECT id, name FROM columns WHERE grid_id = ? ORDER BY position')
      .all(gridId) as { id: number; name: string }[]
    const colCases = columns.map(c =>
      `MAX(CASE WHEN c.column_id = ${c.id} THEN c.value END) AS col_${c.id}`
    ).join(', ')
    const rows = t.db.prepare(`
      SELECT r.id AS row_id, ${colCases}
      FROM rows r LEFT JOIN cells c ON c.row_id = r.id
      WHERE r.grid_id = ? AND r.is_active = 1 AND r.deleted_at IS NULL
      GROUP BY r.id ORDER BY r.position
    `).all(gridId) as Record<string, unknown>[]

    expect(rows).toHaveLength(2)
    expect(rows[0][`col_${columnIds[0]}`]).toBe('Alice')
    expect(rows[0][`col_${columnIds[2]}`]).toBe('Active')
    expect(rows[1][`col_${columnIds[0]}`]).toBe('Bob')
    // Bob has no date cell
    expect(rows[1][`col_${columnIds[1]}`]).toBeNull()
  })

  it('handles special characters (commas, quotes, newlines) via PapaParse', () => {
    const data = [
      ['Name', 'Notes'],
      ['O\'Brien, Jane', 'Line1\nLine2'],
      ['"Quoted" Name', 'Has, commas'],
    ]
    const csv = Papa.unparse({ fields: data[0], data: data.slice(1) })
    const parsed = Papa.parse(csv, { header: true })
    expect(parsed.data).toHaveLength(2)
    expect((parsed.data[0] as Record<string, string>)['Name']).toBe('O\'Brien, Jane')
    expect((parsed.data[0] as Record<string, string>)['Notes']).toBe('Line1\nLine2')
    expect((parsed.data[1] as Record<string, string>)['Name']).toBe('"Quoted" Name')
  })

  it('handles empty cells as empty strings in formatted output', () => {
    expect(formatCellValue(null, 'text')).toBe('')
    expect(formatCellValue('', 'text')).toBe('')
    expect(formatCellValue(null, 'date')).toBe('')
    expect(formatCellValue('', 'checkbox')).toBe('')
    expect(formatCellValue(null, 'currency')).toBe('')
  })

  it('handles unicode characters', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Maria Garcia')

    const colCases = `MAX(CASE WHEN c.column_id = ${columnIds[0]} THEN c.value END) AS col_${columnIds[0]}`
    const rows = t.db.prepare(`
      SELECT r.id AS row_id, ${colCases}
      FROM rows r LEFT JOIN cells c ON c.row_id = r.id
      WHERE r.grid_id = ? AND r.is_active = 1 AND r.deleted_at IS NULL
      GROUP BY r.id
    `).all(gridId) as Record<string, unknown>[]

    expect(rows[0][`col_${columnIds[0]}`]).toBe('Maria Garcia')

    // Also test PapaParse round-trip with unicode
    const csv = Papa.unparse({ fields: ['Name'], data: [['Maria Garcia'], ['Takeshi Yamada']] })
    const parsed = Papa.parse(csv, { header: true })
    expect((parsed.data[0] as Record<string, string>)['Name']).toBe('Maria Garcia')
    expect((parsed.data[1] as Record<string, string>)['Name']).toBe('Takeshi Yamada')
  })

  it('date values formatted per dateFormat setting', () => {
    expect(formatDate('2024-03-15', 'iso')).toBe('2024-03-15')
    expect(formatDate('2024-03-15', 'us')).toBe('03/15/2024')
    expect(formatDate('2024-03-15', 'eu')).toBe('15/03/2024')
  })

  it('invalid date returns original value', () => {
    expect(formatDate('not-a-date', 'iso')).toBe('not-a-date')
  })

  it('checkbox values formatted as Yes/No', () => {
    expect(formatCellValue('1', 'checkbox')).toBe('Yes')
    expect(formatCellValue('true', 'checkbox')).toBe('Yes')
    expect(formatCellValue('0', 'checkbox')).toBe('No')
    expect(formatCellValue('false', 'checkbox')).toBe('No')
  })

  it('currency values formatted with dollar sign and 2 decimals', () => {
    expect(formatCellValue('1234.5', 'currency')).toBe('$1,234.50')
    expect(formatCellValue('0', 'currency')).toBe('$0.00')
    expect(formatCellValue('99.999', 'currency')).toBe('$100.00')
  })

  it('currency with non-numeric value gets formula-sanitized', () => {
    expect(formatCellValue('N/A', 'currency')).toBe('N/A')
  })
})

// ── CSV Formula Injection Prevention ─────────────────────────────────────────

describe('CSV Formula Injection Prevention', () => {
  it('prefixes cells starting with = with an apostrophe', () => {
    expect(sanitizeCsvFormula('=SUM(A1)')).toBe('\'=SUM(A1)')
  })

  it('prefixes cells starting with + with an apostrophe', () => {
    expect(sanitizeCsvFormula('+1-555-1234')).toBe('\'+1-555-1234')
  })

  it('prefixes cells starting with - with an apostrophe', () => {
    expect(sanitizeCsvFormula('-HYPERLINK("evil")')).toBe('\'-HYPERLINK("evil")')
  })

  it('prefixes cells starting with @ with an apostrophe', () => {
    expect(sanitizeCsvFormula('@SUM(A1)')).toBe('\'@SUM(A1)')
  })

  it('prefixes cells with formula-like content after newline', () => {
    expect(sanitizeCsvFormula('safe\n=evil')).toBe('\'safe\n=evil')
  })

  it('leaves a negative number in a number column alone, but guards it in a text column', () => {
    expect(formatCellValue('-5', 'number')).toBe('-5')
    expect(formatCellValue('-5', 'text')).toBe('\'-5')
  })

  it('leaves normal text unchanged', () => {
    expect(sanitizeCsvFormula('Alice Smith')).toBe('Alice Smith')
    expect(sanitizeCsvFormula('123 Main St')).toBe('123 Main St')
  })

  it('uses the OWASP apostrophe, not a TAB, for cells starting with TAB or CR too (AUDIT-037)', () => {
    expect(sanitizeCsvFormula('\t=1+1')).toBe("'\t=1+1")
    expect(sanitizeCsvFormula('\r=1+1')).toBe("'\r=1+1")
    // What it writes doesn't itself start with a character a spreadsheet reads as a formula
    for (const v of ['=1+1', '+1', '-1', '@x', '\tx', '\rx']) expect(sanitizeCsvFormula(v)).toMatch(/^'/)
    expect(sanitizeCsvFormula('=1+1').trimStart()).toBe("'=1+1")
  })

  it("leaves a name that starts with an apostrophe alone ('Til)", () => {
    expect(sanitizeCsvFormula("'Til")).toBe("'Til")
    expect(unguardCsvFormula("'Til")).toBe("'Til")
    expect(unguardCsvFormula("'hello")).toBe("'hello")
  })

  it('import takes off exactly the apostrophe the export added', () => {
    expect(unguardCsvFormula("'=1+1")).toBe('=1+1')
    expect(unguardCsvFormula("'+1 555 0100")).toBe('+1 555 0100')
    expect(unguardCsvFormula("'-")).toBe('-')
    expect(unguardCsvFormula("'@home")).toBe('@home')
    expect(unguardCsvFormula("'\tx")).toBe('\tx')
    expect(unguardCsvFormula("''=1")).toBe("'=1")
  })

  it('round-trips every value exactly', () => {
    const values = ['=1+1', '+1 555 0100', '-', '-12', '@home', '\tTabbed', '\rx', "'Til", "'=1", "''=1", 'safe\n=evil',
      "'", "''", 'Test Person', '', '123 Main St', "O'Brien"]
    for (const v of values) expect(unguardCsvFormula(sanitizeCsvFormula(v))).toBe(v)
  })
})

// ── HTML Stripping ───────────────────────────────────────────────────────────

describe('HTML Stripping', () => {
  it('strips HTML tags', () => {
    expect(stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World')
  })

  it('decodes common HTML entities', () => {
    // &nbsp; → regular space ' ', so the result has a trailing space after the apostrophe space
    expect(stripHtml('&amp; &lt; &gt; &quot; &#39; &nbsp;')).toBe('& < > " \' '+ ' ')
  })

  it('decodes numeric entities', () => {
    expect(stripHtml('caf&#233; &#x2014; ok')).toBe('café — ok')
  })

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('')
  })
})

// ── PDF Data Transformation ──────────────────────────────────────────────────

describe('PDF Data Transformation', () => {
  it('transforms grid data into header + body arrays for autoTable', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 3, columnCount: 2 })
    t.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Client', columnIds[0])
    t.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Status', columnIds[1])

    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Alice')
    insert.run(rowIds[0], columnIds[1], 'Active')
    insert.run(rowIds[1], columnIds[0], 'Bob')

    const columns = t.db.prepare('SELECT id, name, column_type FROM columns WHERE grid_id = ? AND is_visible = 1 ORDER BY position')
      .all(gridId) as { id: number; name: string; column_type: string }[]

    const colCases = columns.map(c =>
      `MAX(CASE WHEN c.column_id = ${c.id} THEN c.value END) AS col_${c.id}`
    ).join(', ')
    const rows = t.db.prepare(`
      SELECT r.id AS row_id, ${colCases}
      FROM rows r LEFT JOIN cells c ON c.row_id = r.id
      WHERE r.grid_id = ? AND r.is_active = 1 AND r.deleted_at IS NULL
      GROUP BY r.id ORDER BY r.position
    `).all(gridId) as Record<string, unknown>[]

    // Build autoTable-style arrays
    const head = [columns.map(c => c.name)]
    const body = rows.map(row =>
      columns.map(col => formatCellValue(row[`col_${col.id}`] as string | null, col.column_type))
    )

    expect(head).toEqual([['Client', 'Status']])
    expect(body).toHaveLength(3)
    expect(body[0]).toEqual(['Alice', 'Active'])
    expect(body[1]).toEqual(['Bob', ''])
    expect(body[2]).toEqual(['', ''])
  })

  it('grid name is available for PDF title', () => {
    const { gridId } = seedGrid(t.db, { name: 'My Caseload 2026', rowCount: 1, columnCount: 1 })
    const grid = t.db.prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string }
    expect(grid.name).toBe('My Caseload 2026')
  })
})

// ── Supervisor Report Queries ────────────────────────────────────────────────

describe('Supervisor Report Queries', () => {
  it('counts active/archived/deleted rows correctly', () => {
    const { gridId, rowIds } = seedGrid(t.db, { rowCount: 10, columnCount: 1 })
    for (let i = 0; i < 3; i++) {
      t.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(rowIds[i])
    }
    for (let i = 3; i < 5; i++) {
      t.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[i])
    }

    const active = (t.db.prepare(
      'SELECT COUNT(*) as c FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
    ).get(gridId) as { c: number }).c
    const archived = (t.db.prepare(
      'SELECT COUNT(*) as c FROM rows WHERE grid_id = ? AND is_active = 0 AND archived_at IS NOT NULL AND deleted_at IS NULL'
    ).get(gridId) as { c: number }).c
    const deleted = (t.db.prepare(
      'SELECT COUNT(*) as c FROM rows WHERE grid_id = ? AND deleted_at IS NOT NULL'
    ).get(gridId) as { c: number }).c

    expect(active).toBe(5)
    expect(archived).toBe(3)
    expect(deleted).toBe(2)
  })
})
