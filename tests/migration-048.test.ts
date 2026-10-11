/** Migration 048 — index on appointments.case_log_id so deleting notes doesn't scan every appointment (AUDIT-103). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, type TestDb } from './helpers'
import { up as migration048 } from '../src/main/migrations/048_appointment_note_index'

let t: TestDb
beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version < 48) m.up(t.db)
})
afterEach(() => cleanupTestDb(t))

const version = () => (t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value
const plan = (sql: string) => (t.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(1) as Array<{ detail: string }>).map(r => r.detail).join(' | ')

function seed(): { noteId: number; apptId: number } {
  const db = t.db
  const gridId = Number(db.prepare("INSERT INTO grids (name) VALUES ('Test List')").run().lastInsertRowid)
  const rowId = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 0)').run(gridId).lastInsertRowid)
  const noteId = Number(db.prepare("INSERT INTO case_log (row_id, content) VALUES (?, 'Test note')").run(rowId).lastInsertRowid)
  const apptId = Number(db.prepare("INSERT INTO appointments (row_id, title, start_at, case_log_id) VALUES (?, 'Visit', '2026-01-05 09:00', ?)").run(rowId, noteId).lastInsertRowid)
  db.prepare("INSERT INTO appointments (row_id, title, start_at) VALUES (?, 'Call', '2026-01-06 09:00')").run(rowId)
  return { noteId, apptId }
}

describe('migration 048', () => {
  it('upgrades a v47 database with appointments, keeping them, and the lookup by note uses the index', () => {
    const { noteId, apptId } = seed()
    expect(version()).toBe('47')
    expect(plan('SELECT id FROM appointments WHERE case_log_id = ?')).toMatch(/SCAN appointments/)

    migration048(t.db)

    expect(version()).toBe('48')
    expect(plan('SELECT id FROM appointments WHERE case_log_id = ?')).toMatch(/USING (COVERING )?INDEX idx_appt_case_log/)
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM appointments').get() as { n: number }).n).toBe(2)
    expect(t.db.prepare('SELECT case_log_id FROM appointments WHERE id = ?').get(apptId)).toEqual({ case_log_id: noteId })
  })

  it('deleting a note still clears it from its appointment', () => {
    const { noteId, apptId } = seed()
    migration048(t.db)
    t.db.prepare('DELETE FROM case_log WHERE id = ?').run(noteId)
    expect(t.db.prepare('SELECT case_log_id FROM appointments WHERE id = ?').get(apptId)).toEqual({ case_log_id: null })
  })

  it('is safe to run twice', () => {
    migration048(t.db)
    expect(() => migration048(t.db)).not.toThrow()
    expect(version()).toBe('48')
  })
})
