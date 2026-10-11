/**
 * export-csv.ts tests — CSV export via real SQLCipher DB.
 * Tests exportCsv() end-to-end: pivot query, column filtering, row filtering,
 * date formatting, formula sanitization, and atomic file writes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import Papa from 'papaparse'

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
    buildGridQuery: actual.buildGridQuery,
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-export-csv', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportCsv } from '../src/main/export-csv'

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

describe('exportCsv', () => {
  it('exports all columns and rows to a valid CSV file', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 3 })
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Name', columnIds[0])
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Status', columnIds[1])
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Notes', columnIds[2])

    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Alice')
    insert.run(rowIds[0], columnIds[1], 'Active')
    insert.run(rowIds[1], columnIds[0], 'Bob')
    insert.run(rowIds[1], columnIds[1], 'Inactive')
    insert.run(rowIds[2], columnIds[0], 'Charlie')

    const destPath = join(testDb.tmpDir, 'export.csv')
    await exportCsv({
      gridId,
      columnIds: [],
      activeRowIds: [],
      destPath,
      dateFormat: 'iso',
    })

    expect(existsSync(destPath)).toBe(true)
    const csv = readFileSync(destPath, 'utf-8')
    const parsed = Papa.parse(csv, { header: true })
    expect(parsed.data).toHaveLength(3)
    expect((parsed.data[0] as Record<string, string>)['Name']).toBe('Alice')
    expect((parsed.data[1] as Record<string, string>)['Name']).toBe('Bob')
    expect((parsed.data[2] as Record<string, string>)['Name']).toBe('Charlie')
  })

  it('can include archived records, marked as archived, but never ones in the Trash (S4)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    testDb.db.prepare("UPDATE columns SET name = 'Name' WHERE id = ?").run(columnIds[0])
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Alice')
    insert.run(rowIds[1], columnIds[0], 'Bob')
    insert.run(rowIds[2], columnIds[0], 'Charlie')
    testDb.db.prepare('UPDATE rows SET is_active = 0 WHERE id = ?').run(rowIds[1])
    testDb.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(rowIds[2])

    const destPath = join(testDb.tmpDir, 'all.csv')
    await exportCsv({ gridId, columnIds: [], activeRowIds: [], destPath, dateFormat: 'iso', includeHidden: true, includeArchived: true })
    const parsed = Papa.parse(readFileSync(destPath, 'utf-8').replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
    expect(parsed.data).toEqual([{ Name: 'Alice', Archived: '' }, { Name: 'Bob', Archived: 'Yes' }])

    // The ordinary export is unchanged: active records only, no extra column
    await exportCsv({ gridId, columnIds: [], activeRowIds: [], destPath, dateFormat: 'iso' })
    const plain = Papa.parse(readFileSync(destPath, 'utf-8').replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
    expect(plain.data).toEqual([{ Name: 'Alice' }])
  })

  it('filters to selected columns only', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 3 })
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Name', columnIds[0])
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Hidden', columnIds[1])
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Visible', columnIds[2])

    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Alice')
    insert.run(rowIds[0], columnIds[1], 'should-not-appear')
    insert.run(rowIds[0], columnIds[2], 'yes')

    const destPath = join(testDb.tmpDir, 'filtered-cols.csv')
    await exportCsv({
      gridId,
      columnIds: [columnIds[0], columnIds[2]],
      activeRowIds: [],
      destPath,
      dateFormat: 'iso',
    })

    const csv = readFileSync(destPath, 'utf-8')
    const parsed = Papa.parse(csv, { header: true })
    expect(parsed.meta.fields).toEqual(['Name', 'Visible'])
    expect((parsed.data[0] as Record<string, string>)['Name']).toBe('Alice')
    expect((parsed.data[0] as Record<string, string>)['Visible']).toBe('yes')
  })

  it('filters to selected rows only', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 5, columnCount: 1 })
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 5; i++) {
      insert.run(rowIds[i], columnIds[0], `Client ${i}`)
    }

    const destPath = join(testDb.tmpDir, 'filtered-rows.csv')
    await exportCsv({
      gridId,
      columnIds: [],
      activeRowIds: [rowIds[1], rowIds[3]],
      destPath,
      dateFormat: 'iso',
    })

    const csv = readFileSync(destPath, 'utf-8')
    const parsed = Papa.parse(csv, { header: true })
    expect(parsed.data).toHaveLength(2)
  })

  it('writes a byte-order mark, keeps negative numbers as numbers and uses the saved date format (X-20, X-21)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 3, columnTypes: ['text', 'number', 'date'] })
    testDb.db.prepare("UPDATE columns SET name = ? WHERE id = ?").run('Name', columnIds[0])
    testDb.db.prepare("UPDATE columns SET name = ? WHERE id = ?").run('Balance', columnIds[1])
    testDb.db.prepare("UPDATE columns SET name = ? WHERE id = ?").run('Seen', columnIds[2])
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], '-not a number'); insert.run(rowIds[0], columnIds[1], '-12.5'); insert.run(rowIds[0], columnIds[2], '2026-10-06')
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('date_format', 'eu')").run()
    const destPath = join(testDb.tmpDir, 'bom.csv')
    await exportCsv({ gridId, columnIds: [], activeRowIds: [], destPath })
    const raw = readFileSync(destPath, 'utf-8')
    expect(raw.charCodeAt(0)).toBe(0xFEFF)
    const parsed = Papa.parse<Record<string, string>>(raw.slice(1), { header: true, skipEmptyLines: true })
    expect(parsed.data[0]).toEqual({ Name: '\t-not a number', Balance: '-12.5', Seen: '06/10/2026' })
  })

  it('exports a deadline column as its due date and state, not the date last done (G-08)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 2, columnTypes: ['text', 'deadline'] })
    const rule = Number(testDb.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Yearly', '[]', 365)").run().lastInsertRowid)
    testDb.db.prepare("UPDATE columns SET name = 'Name' WHERE id = ?").run(columnIds[0])
    testDb.db.prepare("UPDATE columns SET name = 'Review', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule }), columnIds[1])
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[1], '2020-01-01')
    const destPath = join(testDb.tmpDir, 'deadline.csv')
    await exportCsv({ gridId, columnIds: [], activeRowIds: [], destPath, dateFormat: 'iso' })
    const parsed = Papa.parse<Record<string, string>>(readFileSync(destPath, 'utf-8').slice(1), { header: true, skipEmptyLines: true })
    expect(parsed.data[0]!.Review).toMatch(/^Dec 31, 2020 · \d+ days late$/)
  })

  it('keeps the on-screen order of the rows it was given, and can include a hidden column (G-07)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 2 })
    testDb.db.prepare("UPDATE columns SET name = 'Name' WHERE id = ?").run(columnIds[0])
    testDb.db.prepare("UPDATE columns SET name = 'Secret', is_visible = 0 WHERE id = ?").run(columnIds[1])
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 3; i++) { insert.run(rowIds[i], columnIds[0], `Client ${i}`); insert.run(rowIds[i], columnIds[1], `s${i}`) }

    const destPath = join(testDb.tmpDir, 'ordered.csv')
    await exportCsv({ gridId, columnIds: [columnIds[0]!, columnIds[1]!], activeRowIds: [rowIds[2]!, rowIds[0]!], destPath, dateFormat: 'iso' })
    const parsed = Papa.parse<Record<string, string>>(readFileSync(destPath, 'utf-8'), { header: true, skipEmptyLines: true })
    expect(parsed.data).toEqual([{ Name: 'Client 2', Secret: 's2' }, { Name: 'Client 0', Secret: 's0' }])

    // No columns named: the visible ones only, as before
    const plain = join(testDb.tmpDir, 'plain.csv')
    await exportCsv({ gridId, columnIds: [], activeRowIds: [], destPath: plain, dateFormat: 'iso' })
    expect(Papa.parse<Record<string, string>>(readFileSync(plain, 'utf-8'), { header: true }).meta.fields).toEqual(['Name'])
  })

  it('formats dates according to dateFormat setting', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, {
      rowCount: 1, columnCount: 1, columnTypes: ['date'],
    })
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
      .run(rowIds[0], columnIds[0], '2024-06-15')

    const destPath = join(testDb.tmpDir, 'dates.csv')
    await exportCsv({
      gridId,
      columnIds: [],
      activeRowIds: [],
      destPath,
      dateFormat: 'us',
    })

    const csv = readFileSync(destPath, 'utf-8')
    expect(csv).toContain('06/15/2024')
  })

  it('handles grid with no rows (empty export)', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 2 })
    const destPath = join(testDb.tmpDir, 'empty.csv')
    await exportCsv({
      gridId,
      columnIds: [],
      activeRowIds: [],
      destPath,
      dateFormat: 'iso',
    })

    const csv = readFileSync(destPath, 'utf-8')
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true })
    expect(parsed.data).toHaveLength(0)
    // Headers should still exist
    expect(parsed.meta.fields?.length).toBeGreaterThan(0)
  })

  it('sanitizes formula-injection cells', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
      .run(rowIds[0], columnIds[0], '=SUM(A1)')

    const destPath = join(testDb.tmpDir, 'formula.csv')
    await exportCsv({
      gridId,
      columnIds: [],
      activeRowIds: [],
      destPath,
      dateFormat: 'iso',
    })

    const csv = readFileSync(destPath, 'utf-8')
    // The sanitized value should have a tab prefix
    expect(csv).toContain('\t=SUM(A1)')
  })

  it('excludes soft-deleted rows', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Active')
    insert.run(rowIds[1], columnIds[0], 'Deleted')
    insert.run(rowIds[2], columnIds[0], 'Also Active')

    // Soft-delete the second row
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[1])

    const destPath = join(testDb.tmpDir, 'no-deleted.csv')
    await exportCsv({
      gridId,
      columnIds: [],
      activeRowIds: [],
      destPath,
      dateFormat: 'iso',
    })

    const csv = readFileSync(destPath, 'utf-8')
    expect(csv).not.toContain('Deleted')
    const parsed = Papa.parse(csv, { header: true })
    expect(parsed.data).toHaveLength(2)
  })
})
