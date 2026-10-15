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
import { exportWhatsDue } from '../src/main/export-planner'
import { exportAuditReport } from '../src/main/export-audit'
import { exportCsv } from '../src/main/export-csv'
import { exportIcs } from '../src/main/export-ics'
import { exportNotesCsv } from '../src/main/export-csv'
import { exportTotalsCsv } from '../src/main/totals'
import { exportMissingInfoCsv } from '../src/main/missing-info'
import { exportComplianceSummary } from '../src/main/compliance'
import { buildLabelsPdf } from '../src/main/export-documents'
import { runReport } from '../src/main/report-builder'
import { reportToCsv, buildReportPdf } from '../src/main/export-report'
import { saveForm } from '../src/main/forms'
import { buildFormPdf } from '../src/main/export-forms'

/** The text runs of a PDF, or the lines of a CSV */
function parts(path: string): string[] {
  const text = readFileSync(path, 'latin1')
  const runs = text.match(/\((?:\\.|[^\\)])*\)/g)
  return runs && runs.length > 1 ? runs : text.split(/\r?\n/)
}

/**
 * The app's default words where the workspace's own belong (A28-01..04, A28-07):
 * under NONSENSE_VOCAB, a heading or label saying "note", "list", "record",
 * "activity log" or "contact(s)" came from Pulse, not from the seeded data
 * (which never says them).
 */
const DEFAULT_WORDS = /\b(notes?|lists?|records?|activity logs?|contacts?)\b/i
/**
 * Fixed labels that aren't the activity or contact word (a free-text column on
 * the planner, the scratch pad, a gizmo's phone and email)
 */
const NOT_VOCAB = /^\((Notes|Scratch notes|Notes for the next tinker|Contact Information)\)$/

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

  it("what's due", async () => {
    await exportWhatsDue(90, dest('due.pdf'), 'Jo', { includeAppointments: true })
    expect(leaks(dest('due.pdf'))).toEqual([])
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

  it('the other exports: notes and totals CSV, missing information, compliance summary, labels, saved reports', async () => {
    const month = localDateFromToday(0).slice(0, 7)
    await exportNotesCsv(dest('notes.csv'))
    await exportTotalsCsv(month, undefined, dest('totals.csv'))
    await exportMissingInfoCsv(dest('missing.csv'))
    await exportComplianceSummary(month, undefined, dest('compliance.pdf'))
    writeFileSync(dest('labels.pdf'), Buffer.from(buildLabelsPdf({ gridId }, columnIds[0]!, 'avery-5160').pdf.output('arraybuffer')))
    for (const source of ['records', 'activities', 'appointments', 'deadlines'] as const) {
      const r = runReport(gridId, { source, filters: [], groupBy: [], values: [] })
      writeFileSync(dest(`report-${source}.csv`), reportToCsv(r))
      writeFileSync(dest(`report-${source}.pdf`), buildReportPdf('Report', 'All', r))
    }
    const files = ['notes.csv', 'totals.csv', 'missing.csv', 'compliance.pdf', 'labels.pdf',
      ...['records', 'activities', 'appointments', 'deadlines'].flatMap(s => [`report-${s}.csv`, `report-${s}.pdf`])]
    expect(files.flatMap(n => leaks(dest(n)).map(hit => `${n}: ${hit}`))).toEqual([])
  })

  /** Every export this file covers, written under NONSENSE_VOCAB */
  async function writeEveryExport(): Promise<string[]> {
    const month = localDateFromToday(0).slice(0, 7)
    const sup = {
      gridId, columnIds, dateRange: { start: localDateFromToday(-30), end: localDateFromToday(0) },
      includeActivityLog: true, includeSystemActivity: true, includeTaskSummary: true, workerName: 'Jo', workerTitle: 'Lead', workerOrg: 'Shop',
    }
    await exportPdfGrid({ gridId, columnIds, activeRowIds: rowIds, destPath: dest('grid.pdf') })
    await exportPdfProfile({ rowId: rowIds[0]!, gridId, destPath: dest('profile.pdf'), includeSections: allSections })
    await exportSupervisorReport({ ...sup, format: 'pdf', destPath: dest('sup.pdf') })
    await exportSupervisorReport({ ...sup, format: 'csv', destPath: dest('sup.csv') })
    await exportHandoffPacket({ rowId: rowIds[0]!, gridId, receiving: 'Sam', summary: 'Waiting on parts.' }, dest('handoff.pdf'))
    await exportWhatsDue(90, dest('due.pdf'), 'Jo', { includeAppointments: true })
    await exportAuditReport({ gridId }, dest('audit.pdf'), 'Shelf A', 'Jo')
    await exportContactPdf(providerId, dest('contact.pdf'))
    await exportDirectoryPdf({}, dest('directory.pdf'))
    await exportCsv({ gridId, columnIds, activeRowIds: rowIds, destPath: dest('list.csv'), dateFormat: 'us' })
    await exportNotesCsv(dest('notes.csv'))
    await exportTotalsCsv(month, undefined, dest('totals.csv'))
    await exportMissingInfoCsv(dest('missing.csv'))
    await exportComplianceSummary(month, undefined, dest('compliance.pdf'))
    writeFileSync(dest('labels.pdf'), Buffer.from(buildLabelsPdf({ gridId }, columnIds[0]!, 'avery-5160').pdf.output('arraybuffer')))
    for (const source of ['records', 'activities', 'appointments', 'deadlines'] as const) {
      const r = runReport(gridId, { source, filters: [], groupBy: [], values: [] })
      writeFileSync(dest(`report-${source}.csv`), reportToCsv(r))
      writeFileSync(dest(`report-${source}.pdf`), buildReportPdf('Report', 'All', r))
    }
    const form = saveForm({
      grid_id: gridId, name: 'Intake', intro: 'Welcome', log_activity_type: 'visit',
      fields: [{ kind: 'section', title: 'About' }, { kind: 'column', columnId: columnIds[0]!, required: true }, { kind: 'note', label: 'Anything else?' }],
    })
    writeFileSync(dest('form.pdf'), Buffer.from(buildFormPdf(form.id, null).pdf.output('arraybuffer')))
    writeFileSync(dest('form-filled.pdf'), Buffer.from(buildFormPdf(form.id, rowIds[0]!).pdf.output('arraybuffer')))
    return ['grid.pdf', 'profile.pdf', 'sup.pdf', 'sup.csv', 'handoff.pdf', 'due.pdf', 'audit.pdf', 'contact.pdf', 'directory.pdf',
      'list.csv', 'notes.csv', 'totals.csv', 'missing.csv', 'compliance.pdf', 'labels.pdf',
      ...['records', 'activities', 'appointments', 'deadlines'].flatMap(s => [`report-${s}.csv`, `report-${s}.pdf`]),
      'form.pdf', 'form-filled.pdf']
  }

  it('forms PDF', async () => {
    const files = await writeEveryExport()
    expect(files.filter(n => n.startsWith('form')).flatMap(n => leaks(dest(n)).map(hit => `${n}: ${hit}`))).toEqual([])
  })

  it("headings and labels use the workspace's words, not the defaults (A28-01..04, A28-07)", async () => {
    const files = await writeEveryExport()
    const hits = files.flatMap(n => parts(dest(n)).filter(p => DEFAULT_WORDS.test(p) && !NOT_VOCAB.test(p)).map(p => `${n}: ${p}`))
    expect(hits).toEqual([])
    // and the workspace's words are where the defaults were
    expect(parts(dest('totals.csv'))[0]).toContain('Jot type')
    expect(readFileSync(dest('sup.pdf'), 'latin1')).toContain('(Jot pile')
    expect(readFileSync(dest('audit.pdf'), 'latin1')).toMatch(/\(Phone jot\)/)
    expect(readFileSync(dest('handoff.pdf'), 'latin1')).toMatch(/jots, gizmos/)
  })

  it('the check itself catches the old words', () => {
    const p = dest('probe.pdf')
    writeFileSync(p, '(Client profile) Tj (other) Tj')
    expect(leaks(p)).toEqual(['(Client profile)'])
    expect(['(Record name)', '(Lists)', '(New note)', '(Contact)'].filter(t => DEFAULT_WORDS.test(t) && !NOT_VOCAB.test(t))).toHaveLength(4)
  })
})
