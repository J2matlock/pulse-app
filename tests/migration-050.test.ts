/** Migration 050 — one-time sweep of repeating-appointment series left by records deleted for good (P-005). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, type TestDb } from './helpers'
import { up as migration050 } from '../src/main/migrations/050_orphan_series_sweep'

let t: TestDb
beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version < 50) m.up(t.db)
})
afterEach(() => cleanupTestDb(t))

const version = () => (t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value
const series = (template: string) => Number(t.db.prepare("INSERT INTO appointment_series (rule, template, materialized_until) VALUES ('{}', ?, '2099-01-01')").run(template).lastInsertRowid)
const seriesIds = () => (t.db.prepare('SELECT id FROM appointment_series ORDER BY id').all() as Array<{ id: number }>).map(r => r.id)

describe('migration 050', () => {
  it('removes series whose record is gone, and keeps live, trashed and record-less ones', () => {
    const gridId = Number(t.db.prepare("INSERT INTO grids (name) VALUES ('Test List')").run().lastInsertRowid)
    const rowId = Number(t.db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 0)').run(gridId).lastInsertRowid)
    const trashedRow = Number(t.db.prepare("INSERT INTO rows (grid_id, position, deleted_at) VALUES (?, 1, datetime('now'))").run(gridId).lastInsertRowid)
    const live = series(JSON.stringify({ row_id: rowId, title: 'Visit' }))
    series(JSON.stringify({ row_id: trashedRow + 100, title: 'Secret visit', notes: 'private' }))
    const trashed = series(JSON.stringify({ row_id: trashedRow, title: 'Visit in the Trash' }))
    const unattached = series(JSON.stringify({ row_id: null, title: 'Team meeting' }))
    const noKey = series(JSON.stringify({ title: 'Older template' }))
    expect(version()).toBe('49')

    migration050(t.db)

    expect(version()).toBe('50')
    expect(seriesIds()).toEqual([live, trashed, unattached, noKey])
  })

  it('is safe to run twice', () => {
    series(JSON.stringify({ row_id: 999, title: 'Gone' }))
    migration050(t.db)
    expect(() => migration050(t.db)).not.toThrow()
    expect(seriesIds()).toEqual([])
    expect(version()).toBe('50')
  })
})
