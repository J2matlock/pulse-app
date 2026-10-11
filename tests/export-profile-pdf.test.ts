/**
 * 1.19: the profile PDF and handoff packet show the same deadlines as the app,
 * leave private and system entries out, and include extra contact info.
 * jsPDF writes text uncompressed, so the PDF bytes can be searched for it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'
import { localDateFromToday } from '../src/shared/dates'

let testDb: TestDb
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => testDb.db, cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql) }
})
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-profile-pdf', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportPdfProfile, deadlineSummary } from '../src/main/export-pdf'
import { exportHandoffPacket } from '../src/main/export-handoff'

const ALL = { deadlines: true, checklist: true, caseLog: true, scratchPad: true, contactInfo: true, gridData: true }

beforeEach(() => { testDb = createTestDb(); setDbWords(testDb.db) })
afterEach(() => cleanupTestDb(testDb))

function seedRecord() {
  const g = seedGrid(testDb.db, { rowCount: 1, columnCount: 3 })
  const rowId = g.rowIds[0]!
  const db = testDb.db
  db.prepare("UPDATE rows SET display_name = 'Maria' WHERE id = ?").run(rowId)
  db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, g.columnIds[0], 'Maria')
  // "Every 30 days" from a visit 20 days ago: due in 10 days, not overdue
  const every30 = Number(db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Monthly', '[]', 30)").run().lastInsertRowid)
  db.prepare("UPDATE columns SET name = 'Last visit', column_type = 'date', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: every30 }), g.columnIds[1])
  db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, g.columnIds[1], localDateFromToday(-20))
  // A plain due date of today: "Due today" all day long
  const plain = Number(db.prepare("INSERT INTO alert_rules (name, thresholds) VALUES ('Due', '[]')").run().lastInsertRowid)
  db.prepare("UPDATE columns SET name = 'Renewal', column_type = 'date', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: plain }), g.columnIds[2])
  db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, g.columnIds[2], localDateFromToday(0))
  db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Home visit went well', 'visit')").run(rowId)
  db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Stage changed to Active', 'system')").run(rowId)
  db.prepare("INSERT INTO scrap_notes (row_id, content) VALUES (?, 'check with mom re drinking')").run(rowId)
  db.prepare('UPDATE rows SET manual_contacts = ? WHERE id = ?').run(JSON.stringify([{ type: 'phone', label: 'Guardian cell', value: '555-0199' }]), rowId)
  return { gridId: g.gridId, rowId }
}

const text = (path: string) => readFileSync(path).toString('latin1')

function seedComputed(db: TestDb['db']) {
  const g = seedGrid(db, { rowCount: 1, columnTypes: ['text', 'date', 'date', 'age_from_dob', 'calculated_days'] })
  const [name, dob, next, age, days] = g.columnIds as [number, number, number, number, number]
  const rename = db.prepare('UPDATE columns SET name = ?, config = ? WHERE id = ?')
  rename.run('Name', '{}', name)
  rename.run('Birth date', '{}', dob)
  rename.run('Next visit', '{}', next)
  rename.run('Age', JSON.stringify({ source_column_id: dob }), age)
  rename.run('Days to visit', JSON.stringify({ source_column_id: next }), days)
  db.prepare('UPDATE columns SET is_name_column = 1 WHERE id = ?').run(name)
  const insert = db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
  const [rowId = 0] = g.rowIds
  insert.run(rowId, name, 'Test Person')
  insert.run(rowId, dob, `${new Date().getFullYear() - 10}-01-01`)
  insert.run(rowId, next, localDateFromToday(5))
  return { gridId: g.gridId, rowId }
}

describe('profile PDF', () => {
  it('prints deadlines from the deadline engine', async () => {
    const { gridId, rowId } = seedRecord()
    const dest = join(testDb.tmpDir, 'p.pdf')
    await exportPdfProfile({ rowId, gridId, destPath: dest, includeSections: ALL })
    const pdf = text(dest)
    expect(pdf).toContain('Due in 10 days')
    expect(pdf).toContain('Due today')
    expect(pdf).not.toContain('OVERDUE')
  })

  it('leaves system entries out of recent notes and prints extra contact info', async () => {
    const { gridId, rowId } = seedRecord()
    const dest = join(testDb.tmpDir, 'p.pdf')
    await exportPdfProfile({ rowId, gridId, destPath: dest, includeSections: { ...ALL, scratchPad: false } })
    const pdf = text(dest)
    expect(pdf).toContain('Home visit went well')
    expect(pdf).not.toContain('Stage changed to Active')
    expect(pdf).toContain('Guardian cell')
    expect(pdf).toContain('555-0199')
    expect(pdf).not.toContain('check with mom')
  })

  it('prints scrap-note paragraphs on their own lines (AUDIT-069)', async () => {
    const { gridId, rowId } = seedRecord()
    testDb.db.prepare("UPDATE scrap_notes SET content = '<p>Call Mom</p><p>Bring forms</p>' WHERE row_id = ?").run(rowId)
    const dest = join(testDb.tmpDir, 'p.pdf')
    await exportPdfProfile({ rowId, gridId, destPath: dest, includeSections: ALL })
    const pdf = text(dest)
    expect(pdf).toContain('(Call Mom)')
    expect(pdf).toContain('(Bring forms)')
    expect(pdf).not.toContain('Call MomBring forms')
  })

  it('shows Age and Days-until as the table does, not blank (AUDIT-036)', async () => {
    const { gridId, rowId } = seedComputed(testDb.db)
    const dest = join(testDb.tmpDir, 'computed.pdf')
    await exportPdfProfile({ rowId, gridId, destPath: dest, includeSections: { ...ALL, deadlines: false } })
    const pdf = text(dest)
    expect(pdf).toContain('(10 yrs)')
    expect(pdf).toContain('(5 days)')
  })

  it('describes overdue, step and extended deadlines', () => {
    expect(deadlineSummary({ due: '2026-10-01', state: 'overdue', daysUntil: -3, estimated: false })).toBe('Next due Oct 1, 2026  ·  OVERDUE by 3 days')
    expect(deadlineSummary({ due: '2026-10-20', state: 'ok', daysUntil: 1, estimated: true, label: 'Step 2', extended: { from: '2026-10-10', reason: 'Client in hospital' } }))
      .toBe('Next due Oct 20, 2026 (estimated)  ·  Due tomorrow  ·  Step 2  ·  Extended from Oct 10, 2026: Client in hospital')
  })

  it('says a used-up allowance is used up, not "OVERDUE by 0 days"', () => {
    expect(deadlineSummary({ due: '2026-12-31', state: 'overdue', daysUntil: 0, estimated: false, label: 'All 12 used' })).toBe('All 12 used  ·  ends Dec 31, 2026')
  })
})

describe('handoff packet', () => {
  it('leaves scrap notes out unless asked', async () => {
    const { gridId, rowId } = seedRecord()
    const without = join(testDb.tmpDir, 'h1.pdf')
    await exportHandoffPacket({ rowId, gridId }, without)
    expect(text(without)).not.toContain('check with mom')
    expect(text(without)).toContain('Due in 10 days')
    const withPad = join(testDb.tmpDir, 'h2.pdf')
    await exportHandoffPacket({ rowId, gridId, includeScratchPad: true }, withPad)
    expect(text(withPad)).toContain('check with mom')
  })
})
