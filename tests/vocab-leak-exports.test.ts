/**
 * Leak test for files Pulse writes: under nonsense workspace words, no PDF,
 * CSV or calendar export may say "client", "caseload", "case note" and the
 * like. The catch-all for strings the word rollout missed
 * (plans/generalization/W01-workspace.md §8).
 *
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { seedLeakWorkspace, LEAK } from './vocabLeakSeed'
import { localDateFromToday } from '../src/shared/dates'

let testDb: TestDb
// The real module is loaded only after everything has bound to this mock:
// database.ts imports contacts.ts, and loading it first would bind contacts.ts
// to the real getDb
type Db = typeof import('../src/main/database')
let realBuildGridQuery: Db['buildGridQuery']
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  buildGridQuery: (...args: Parameters<Db['buildGridQuery']>) => realBuildGridQuery(...args),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-vocab-leak', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportPdfGrid, exportPdfProfile, exportContactPdf, exportDirectoryPdf } from '../src/main/export-pdf'
import { exportSupervisorReport } from '../src/main/export-supervisor'
import { exportHandoffPacket } from '../src/main/export-handoff'
import { exportWeeklyPlanner } from '../src/main/export-planner'
import { exportAuditReport } from '../src/main/export-audit'
import { exportCsv } from '../src/main/export-csv'
import { exportIcs } from '../src/main/export-ics'

function leaks(path: string): string[] {
  const text = readFileSync(path, 'latin1')
  // jsPDF writes each run as "(text) Tj"; pull out string literals so font
  // names and stream bytes don't get in the way
  const runs = text.match(/\((?:\\.|[^\\)])*\)/g) ?? [text]
  const hits = runs.filter(r => LEAK.test(r))
  // CSV / ICS have no PDF runs; check the whole file
  return hits.length || runs.length > 1 ? hits : (LEAK.test(text) ? [text.match(LEAK)![0]] : [])
}

beforeAll(async () => {
  realBuildGridQuery = (await vi.importActual<Db>('../src/main/database')).buildGridQuery
})

let gridId: number
let rowIds: number[]
let columnIds: number[]
let providerId: number

beforeEach(() => {
  testDb = createTestDb()
  ;({ gridId, rowIds, columnIds, providerId } = seedLeakWorkspace(testDb.db))
})
afterEach(() => cleanupTestDb(testDb))

const allSections = { deadlines: true, checklist: true, caseLog: true, scratchPad: true, contactInfo: true, gridData: true }
const dest = (name: string) => join(testDb.tmpDir, name)

describe('exports use the workspace words', () => {
  it('list PDF', async () => {
    await exportPdfGrid({ gridId, columnIds, activeRowIds: rowIds, destPath: dest('grid.pdf') })
    expect(leaks(dest('grid.pdf'))).toEqual([])
  })

  it('profile PDF', async () => {
    await exportPdfProfile({ rowId: rowIds[0]!, gridId, destPath: dest('profile.pdf'), includeSections: allSections })
    expect(leaks(dest('profile.pdf'))).toEqual([])
    // and the workspace's own words are there instead
    expect(readFileSync(dest('profile.pdf'), 'latin1')).toMatch(/jot/i)
  })

  it('supervisor report (PDF and CSV)', async () => {
    const base = {
      gridId, columnIds, dateRange: { start: localDateFromToday(-30), end: localDateFromToday(0) },
      includeActivityLog: true, includeSystemActivity: true, includeTaskSummary: true, workerName: 'Jo', workerTitle: 'Lead', workerOrg: 'Shop',
    }
    await exportSupervisorReport({ ...base, format: 'pdf', destPath: dest('sup.pdf') })
    await exportSupervisorReport({ ...base, format: 'csv', destPath: dest('sup.csv') })
    expect(leaks(dest('sup.pdf'))).toEqual([])
    expect(leaks(dest('sup.csv'))).toEqual([])
  })

  it('handoff packet', async () => {
    await exportHandoffPacket({ rowId: rowIds[0]!, gridId, receiving: 'Sam', summary: 'Waiting on parts.' }, dest('handoff.pdf'))
    expect(leaks(dest('handoff.pdf'))).toEqual([])
  })

  it('weekly planner', async () => {
    await exportWeeklyPlanner(localDateFromToday(0), dest('week.pdf'), 'Jo')
    expect(leaks(dest('week.pdf'))).toEqual([])
  })

  it('audit report', async () => {
    await exportAuditReport({ gridId }, dest('audit.pdf'), 'Shelf A', 'Jo')
    expect(leaks(dest('audit.pdf'))).toEqual([])
  })

  it('contact and directory PDFs', async () => {
    await exportContactPdf(providerId, dest('contact.pdf'))
    await exportDirectoryPdf({}, dest('directory.pdf'))
    expect(leaks(dest('contact.pdf'))).toEqual([])
    expect(leaks(dest('directory.pdf'))).toEqual([])
  })

  it('CSV export', async () => {
    await exportCsv({ gridId, columnIds, activeRowIds: rowIds, destPath: dest('list.csv'), dateFormat: 'us' })
    expect(leaks(dest('list.csv'))).toEqual([])
  })

  it('calendar export', async () => {
    await exportIcs(dest('cal.ics'))
    expect(leaks(dest('cal.ics'))).toEqual([])
  })

  it('the check itself catches the old words', () => {
    const p = dest('probe.pdf')
    writeFileSync(p, '(Client profile) Tj (other) Tj')
    expect(leaks(p)).toEqual(['(Client profile)'])
  })
})
