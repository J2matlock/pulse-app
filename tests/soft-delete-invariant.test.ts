/**
 * Soft-delete invariant (sweep plan 1.6): records in the Trash, and records of
 * a list in the Trash, show up only in the Trash views.
 *
 * Two checks over every read path, on the real database.ts and the real IPC
 * handlers:
 *  - names: trashed records are named "ZZTRASHED …" (their notes and
 *    appointments say so too), so no list, search result, calendar item or
 *    export file may contain that marker;
 *  - numbers: every path is read, the Trash is emptied (Empty Trash, then the
 *    list purged), and every path is read again. Anything trashed data was
 *    counted in shows up as a difference.
 *
 * Deliberate exceptions are listed in KNOWN_TRASH_READERS with the reason
 * (sweep/DECISIONS.md).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { IPC } from '../src/shared/ipc-channels'
import { localDateString } from '../src/shared/dates'
import { addDays } from '../src/shared/ymd'

const KEY_HEX = 'd4'.repeat(32)

const h = vi.hoisted(() => ({
  storedPath: '',
  stores: new Map<string, Map<string, unknown>>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => process.env.PULSE_DATA_DIR ?? '/nonexistent',
    getVersion: () => '9.9.9',
    getName: () => 'Pulse Test',
    commandLine: { appendSwitch: () => {} },
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(ch, fn) }, on: () => {}, removeHandler: () => {} },
  BrowserWindow: class { static getAllWindows() { return [] } static getFocusedWindow() { return null } },
  safeStorage: { isEncryptionAvailable: () => false },
  clipboard: { clear: () => {}, writeText: () => {} },
  dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '' },
  nativeTheme: { on: () => {}, shouldUseDarkColors: false },
  powerMonitor: { on: () => {} },
}))

vi.mock('electron-store', () => ({
  default: class {
    private data: Map<string, unknown>
    constructor(opts?: { name?: string }) {
      const name = opts?.name ?? 'config'
      if (!h.stores.has(name)) h.stores.set(name, new Map())
      this.data = h.stores.get(name) as Map<string, unknown>
    }
    get(k: string, d?: unknown) { return this.data.has(k) ? this.data.get(k) : d }
    set(k: string | Record<string, unknown>, v?: unknown) {
      if (typeof k === 'object') for (const [key, val] of Object.entries(k)) this.data.set(key, val)
      else this.data.set(k, v)
    }
    has(k: string) { return this.data.has(k) }
    delete(k: string) { this.data.delete(k) }
    clear() { this.data.clear() }
  },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../src/main/auth', () => ({
  getDbKey: () => Buffer.from(KEY_HEX, 'hex'),
  setStoredDbPath: (p: string) => { h.storedPath = p },
  getStoredDbPath: () => h.storedPath,
  isPasswordSetup: () => true,
  hasRecoveryKey: () => true,
  getKeyEnvelope: () => null,
  isValidKeyEnvelope: () => false,
  unwrapKeyEnvelope: () => { throw new Error('not used') },
  adoptRestoredDbKey: () => { throw new Error('not used') },
  getAutoLockMinutes: () => 15,
}))

vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

import { openDatabase, closeDatabase, getDb } from '../src/main/database'
import { registerIpcHandlers } from '../src/main/ipc-handlers'
import { seedWorkspace, SEED_INTERVAL_DAYS, type SeedResult } from './seedWorkspace'
import { setDbFeatures } from './helpers'
import { featuresForExistingInstall } from '../src/shared/features'
import { loadIcsItems, exportIcs } from '../src/main/export-ics'
import { loadPlannerRows, exportWeeklyPlanner } from '../src/main/export-planner'
import { getRequirementStatus, saveRequirements } from '../src/main/contact-requirements'
import { columnDependents } from '../src/main/column-usage'
import { previewTypeChange } from '../src/main/column-type'
import { countLinks, linkCountsForGrid } from '../src/main/links'
import { batchRowIds, buildLabelsPdf } from '../src/main/export-documents'
import { loadAuditTrail, exportAuditReport } from '../src/main/export-audit'
import { exportCsv, exportNotesCsv } from '../src/main/export-csv'
import { exportPdfGrid } from '../src/main/export-pdf'
import { exportSupervisorReport } from '../src/main/export-supervisor'
import { exportMissingInfoCsv } from '../src/main/missing-info'
import { exportTotalsCsv } from '../src/main/totals'
import { exportComplianceSummary } from '../src/main/compliance'
import { loadDeadlines, deadlineCounts } from '../src/main/deadlines'
import { appointmentsNeedingOutcome, appointmentsToday } from '../src/main/appointments'

registerIpcHandlers()

const MARK = 'ZZTRASHED'
const TODAY = localDateString()
const MONTH = TODAY.slice(0, 7)
const FROM = addDays(TODAY, -60)
const TO = addDays(TODAY, 60)

let dir: string
let seed: SeedResult
/** The list moved to the Trash, with its records */
let trashedListId: number
let providerId: number

type Result = { ok: true; data: unknown } | { ok: false; error: string }
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`No handler for ${channel}`)
  const res = await fn({ senderFrame: { parent: null, url: 'app://bundle/index.html' } }, ...args) as Result
  if (!res.ok) throw new Error(`${channel}: ${res.error}`)
  return res.data
}

function seedTrash(): void {
  const db = getDb()
  setDbFeatures(db, featuresForExistingInstall({ trackTime: true, trackMileage: true }))
  seed = seedWorkspace(db, { records: 40, customColumns: 8, today: TODAY })

  // Trashed records say so everywhere they could leak by name
  const trashed = seed.trashedRowIds
  const inTrashed = `(${trashed.join(',')})`
  db.prepare(`UPDATE cells SET value = '${MARK} record ' || row_id WHERE column_id = ? AND row_id IN ${inTrashed}`).run(seed.nameColumnId)
  db.prepare(`UPDATE case_log SET content = '${MARK} note ' || id WHERE row_id IN ${inTrashed}`).run()
  db.prepare(`UPDATE appointments SET title = '${MARK} visit ' || id WHERE row_id IN ${inTrashed}`).run()
  // A trashed record with an extension, a checklist item due, and a contact
  const t0 = trashed[0]!
  const ext = db.prepare('INSERT INTO deadline_extensions (row_id, column_id, original_due, new_due, reason) VALUES (?, ?, ?, ?, ?)')
  ext.run(t0, seed.deadlineColumnId, TODAY, addDays(TODAY, 14), `${MARK} extension`)
  ext.run(seed.activeRowIds[0], seed.deadlineColumnId, TODAY, addDays(TODAY, 7), 'Live extension')
  for (const rowId of [t0, seed.activeRowIds[0]!]) {
    db.prepare("INSERT INTO checklist_items (row_id, title, position, due_date) VALUES (?, ?, 0, ?)").run(rowId, rowId === t0 ? `${MARK} checklist` : 'Live checklist', addDays(TODAY, 1))
  }
  db.prepare(`UPDATE case_log SET minutes = 45, miles = 12.5, occurred_at = ? WHERE row_id IN (${t0}, ${seed.activeRowIds[0]})`).run(`${TODAY} 10:00:00`)
  providerId = Number(db.prepare("INSERT INTO providers (name) VALUES ('Shared Contact')").run().lastInsertRowid)
  const link = db.prepare('INSERT INTO provider_client_links (provider_id, row_id, grid_id) VALUES (?, ?, ?)')
  link.run(providerId, t0, seed.gridId)
  link.run(providerId, seed.activeRowIds[0], seed.gridId)
  // A format rule on a trashed record's cell
  db.prepare('INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, ?)').run(t0, seed.customColumnIds[0], JSON.stringify([{ operator: 'is_not_empty', value: '', bgColor: '#fecaca' }]))
  // Monthly contact requirement and the stage board use the list too
  saveRequirements(seed.gridId, [{ label: 'Monthly visit', note_types: ['visit'], per_month: 1, period: 'month' }])

  // A second list, every record of which is still "active" but the list is in the Trash
  trashedListId = Number(db.prepare("INSERT INTO grids (name, position, record_kind) VALUES ('ZZTRASHED list', 5, 'person')").run().lastInsertRowid)
  const nameCol = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, is_name_column) VALUES (?, 'Name', 'text', 0, 1)").run(trashedListId).lastInsertRowid)
  const dateCol = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Last review', 'date', 1, ?)").run(trashedListId, JSON.stringify({ alert_rule_id: seed.ruleId })).lastInsertRowid)
  for (let i = 0; i < 3; i++) {
    const rowId = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, ?)').run(trashedListId, i).lastInsertRowid)
    db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, nameCol, `${MARK} list record ${i}`)
    db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, dateCol, addDays(TODAY, -SEED_INTERVAL_DAYS - i))
    const noteId = Number(db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, occurred_at, follow_up_date, minutes) VALUES (?, ?, 'visit', ?, ?, ?, ?, 20)")
      .run(rowId, `${MARK} list note ${i}`, `${TODAY} 09:00:00`, `${TODAY} 09:00:00`, `${TODAY} 09:00:00`, addDays(TODAY, 1)).lastInsertRowid)
    const appt = db.prepare('INSERT INTO appointments (row_id, title, start_at, end_at, all_day, status, case_log_id) VALUES (?, ?, ?, ?, 0, ?, ?)')
    appt.run(rowId, `${MARK} list visit done ${i}`, `${addDays(TODAY, -2)}T10:00`, `${addDays(TODAY, -2)}T11:00`, 'done', noteId)
    appt.run(rowId, `${MARK} list visit ahead ${i}`, `${addDays(TODAY, 2)}T10:00`, `${addDays(TODAY, 2)}T11:00`, 'scheduled', null)
    db.prepare('INSERT INTO deadline_extensions (row_id, column_id, original_due, new_due, reason) VALUES (?, ?, ?, ?, ?)').run(rowId, dateCol, TODAY, addDays(TODAY, 10), `${MARK} list extension`)
    db.prepare("INSERT INTO checklist_items (row_id, title, position, due_date) VALUES (?, ?, 0, ?)").run(rowId, `${MARK} list checklist`, addDays(TODAY, 1))
    db.prepare('INSERT INTO provider_client_links (provider_id, row_id, grid_id) VALUES (?, ?, ?)').run(providerId, rowId, trashedListId)
  }
  db.prepare("INSERT INTO caseload_tasks (grid_id, title, due_date, position) VALUES (?, ?, ?, 0)").run(trashedListId, `${MARK} list task`, addDays(TODAY, 1))
}

beforeEach(async () => {
  for (const m of h.stores.values()) m.clear()
  dir = mkdtempSync(join(tmpdir(), 'pulse-soft-delete-'))
  process.env.PULSE_DATA_DIR = dir
  openDatabase()
  seedTrash()
  await invoke(IPC.GRID_DELETE, trashedListId)
})

afterEach(() => {
  try { closeDatabase() } catch { /* already closed */ }
  delete process.env.PULSE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

/** Empty the Trash the way the app does (trashed records, and lists in the Trash with their records) */
async function emptyTrash(): Promise<void> {
  await invoke(IPC.ROW_PURGE_ALL)
}

/** Every read path, as plain data. Counts and lists only: no clock-dependent text. */
async function readAll(): Promise<Record<string, unknown>> {
  const g = seed.gridId
  const records = { source: 'records', filters: [], groupBy: [], values: [] }
  const out: Record<string, unknown> = {
    'grid:get-all': await invoke(IPC.GRID_GET_ALL),
    'grid:get-full': await invoke(IPC.GRID_GET_FULL, g),
    'grid:get-full (archived shown)': await invoke(IPC.GRID_GET_FULL, g, true),
    'dashboard:get-all': await invoke(IPC.DASHBOARD_GET_ALL),
    'dashboard:get-deadlines': await invoke(IPC.DASHBOARD_GET_DEADLINES),
    'dashboard:recent-activity': await invoke(IPC.DASHBOARD_RECENT_ACTIVITY),
    'dashboard:get-followups': await invoke(IPC.DASHBOARD_GET_FOLLOWUPS),
    'dashboard:get-briefing': await invoke(IPC.DASHBOARD_GET_BRIEFING),
    'loadDeadlines': loadDeadlines({}),
    'deadlineCounts': deadlineCounts(TODAY),
    'missing-info:get': await invoke(IPC.MISSING_INFO_GET, null),
    'compliance:summary': await invoke(IPC.COMPLIANCE_SUMMARY_GET, MONTH, null),
    'totals:get': await invoke(IPC.TOTALS_GET, MONTH, null),
    'stages:summary': await invoke(IPC.STAGE_SUMMARY),
    'appointments:list': await invoke(IPC.APPT_LIST, { from: FROM, to: TO }),
    'appointmentsNeedingOutcome': appointmentsNeedingOutcome(TODAY),
    'appointmentsToday': appointmentsToday(TODAY),
    'calendar:items': await invoke(IPC.CALENDAR_ITEMS, FROM, TO),
    'reports:run records': await invoke(IPC.REPORT_RUN, g, records),
    'reports:run activities': await invoke(IPC.REPORT_RUN, g, { ...records, source: 'activities' }),
    'reports:run appointments': await invoke(IPC.REPORT_RUN, g, { ...records, source: 'appointments' }),
    'reports:run deadlines': await invoke(IPC.REPORT_RUN, g, { ...records, source: 'deadlines' }),
    'onboarding:getting-started': await invoke(IPC.ONBOARDING_GETTING_STARTED),
    'task:get-all': await invoke(IPC.TASK_GET_ALL),
    'task:get-due': await invoke(IPC.TASK_GET_DUE),
    'search:clients-cross-grid': await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, ''),
    'search:clients-cross-grid (marker)': await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, MARK),
    'checklist:get-due': await invoke(IPC.CHECKLIST_GET_DUE),
    'contacts:get-client-links': await invoke(IPC.CONTACTS_GET_CLIENT_LINKS, { providerId }),
    'contacts:get-all': await invoke(IPC.CONTACTS_GET_ALL, {}),
    'links:get (linked records)': await Promise.all(seed.linkedRowIds.map(id => invoke(IPC.RECORD_LINKS_GET, id))),
    'countLinks': countLinks(seed.linkTypeId),
    'linkCountsForGrid': linkCountsForGrid(seed.linkedGridId),
    'contact requirements': getRequirementStatus(TODAY),
    'column dependents (format rules)': columnDependents(seed.customColumnIds[0]!),
    'change-type preview': previewTypeChange(seed.customColumnIds[0]!, 'number'),
    'ICS items': loadIcsItems({}),
    'weekly planner rows': loadPlannerRows(TODAY, addDays(TODAY, 6)),
    'batch print records': batchRowIds({ gridId: g }),
    'audit trail': loadAuditTrail({}),
  }
  // Format rules come with the list for every row id; they're side data, kept apart below
  for (const k of ['grid:get-full', 'grid:get-full (archived shown)']) {
    const full = out[k] as { cellFormats?: unknown }
    out[`${k} cellFormats`] = full.cellFormats
    delete full.cellFormats
  }
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>
}

/**
 * Paths that read the Trash on purpose (sweep/DECISIONS.md), with the reason.
 * Everything else must give the same answer before and after Empty Trash.
 */
const KNOWN_TRASH_READERS: Record<string, string> = {
  'audit trail': 'D-007: the audit trail keeps trashed records on purpose (it records "Moved to the Trash"); A16-01 is open',
  'audit.pdf': 'D-007, as above',
  'grid:get-full cellFormats': "D-009: format rules are sent for every row id in the list; the grid only draws the ones for rows it shows",
  'grid:get-full (archived shown) cellFormats': 'D-009, as above',
  'countLinks': 'D-009: the "delete this link type" warning counts every link the delete removes, trashed records\' too',
  'linkCountsForGrid': 'D-009: the "delete this list" warning counts every link the delete removes, trashed records\' too',
}

/** The supervisor report has a labelled "removed from the list" section naming records in the Trash (D-008, A16-02 open) */
const SUPERVISOR_FILES = ['sup.csv', 'sup.pdf']

describe('Trashed records appear only in the Trash', () => {
  it('no read path names a trashed record or a record of a trashed list', async () => {
    const all = await readAll()
    const leaks = Object.entries(all).filter(([k, v]) => !(k in KNOWN_TRASH_READERS) && JSON.stringify(v).includes(MARK)).map(([k]) => k)
    expect(leaks).toEqual([])
  })

  it('no read path counts them: every answer is the same after the Trash is emptied', async () => {
    const before = await readAll()
    await emptyTrash()
    const after = await readAll()
    const differs = Object.keys(before).filter(k => !(k in KNOWN_TRASH_READERS) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    expect(differs).toEqual([])
  })

  it('exported files never name them', async () => {
    const out = join(dir, 'exports')
    const f = (name: string) => join(out, name)
    const g = seed.gridId
    const cols = [seed.nameColumnId, seed.deadlineColumnId, ...seed.customColumnIds]
    await invoke(IPC.EXPORT_ALL_CSV, join(out, 'all'))
    await exportCsv({ gridId: g, columnIds: cols, activeRowIds: seed.rowIds, destPath: f('list.csv'), dateFormat: 'iso' })
    await exportNotesCsv(f('notes.csv'))
    await exportPdfGrid({ gridId: g, columnIds: cols, activeRowIds: seed.rowIds, destPath: f('list.pdf') })
    const sup = { gridId: g, columnIds: cols, dateRange: { start: addDays(TODAY, -30), end: TODAY }, includeActivityLog: true, includeSystemActivity: true, includeTaskSummary: true, workerName: 'Jo', workerTitle: 'Lead', workerOrg: 'Org' }
    await exportSupervisorReport({ ...sup, format: 'pdf', destPath: f('sup.pdf') })
    await exportSupervisorReport({ ...sup, format: 'csv', destPath: f('sup.csv') })
    await exportWeeklyPlanner(TODAY, f('week.pdf'), 'Jo')
    await exportIcs(f('cal.ics'))
    await exportMissingInfoCsv(f('missing.csv'))
    await exportTotalsCsv(MONTH, undefined, f('totals.csv'))
    await exportComplianceSummary(MONTH, undefined, f('compliance.pdf'))
    writeFileSync(f('labels.pdf'), Buffer.from(buildLabelsPdf({ gridId: g }, seed.nameColumnId, 'avery-5160').pdf.output('arraybuffer')))
    await exportAuditReport({}, f('audit.pdf'), 'All lists', 'Jo')

    const files = [...readdirSync(out).filter(n => n !== 'all').map(f), ...readdirSync(join(out, 'all')).map(n => join(out, 'all', n))]
    const leaks = files.filter(p => !Object.keys(KNOWN_TRASH_READERS).some(k => p.endsWith(k)) && !SUPERVISOR_FILES.some(k => p.endsWith(k)) && readFileSync(p, 'latin1').includes(MARK))
    expect(leaks.map(p => p.slice(out.length + 1))).toEqual([])

    // The supervisor report names the main list's trashed records once each, in its
    // "removed from the list" section, and nothing else in the Trash (D-008)
    const trashedNames = seed.trashedRowIds.map(id => `${MARK} record ${id}`).sort()
    const csvLines = readFileSync(f('sup.csv'), 'utf8').split('\n')
    const section = csvLines.findIndex(l => /Removed From/i.test(l))
    const marked = csvLines.map((l, i) => ({ l, i })).filter(x => x.l.includes(MARK))
    expect(marked.map(x => x.l.split(',')[0]).sort()).toEqual(trashedNames)
    expect(marked.every(x => x.i > section && x.i <= section + 1 + trashedNames.length)).toBe(true)
    const pdfRuns = readFileSync(f('sup.pdf'), 'latin1').match(/\((?:\\.|[^\\)])*\)/g) ?? []
    expect(pdfRuns.filter(r => r.includes(MARK)).map(r => r.slice(1, -1)).sort()).toEqual(trashedNames)
  })

  it('a record in the Trash, or in a list in the Trash, is refused by the one-record exports (A16-06)', async () => {
    const db = getDb()
    const listRecord = (db.prepare('SELECT id FROM rows WHERE grid_id = ? LIMIT 1').get(trashedListId) as { id: number }).id
    const templateId = Number(db.prepare("INSERT INTO letter_templates (name, content) VALUES ('Letter', 'Dear {{name}}')").run().lastInsertRowid)
    const sections = { deadlines: true, checklist: true, caseLog: true, scratchPad: true, contactInfo: true, gridData: true }
    const call = async (channel: string, ...args: unknown[]) => await h.handlers.get(channel)!({ senderFrame: { parent: null, url: 'app://bundle/index.html' } }, ...args) as Result
    for (const [rowId, gridId] of [[seed.trashedRowIds[0]!, seed.gridId], [listRecord, trashedListId]] as const) {
      const profile = await call(IPC.EXPORT_PDF_PROFILE, { rowId, gridId, destPath: join(dir, 'p.pdf'), includeSections: sections })
      expect(profile).toEqual({ ok: false, error: expect.stringMatching(/moved to the Trash/) })
      expect(await call(IPC.EXPORT_HANDOFF_PACKET, { rowId, gridId })).toEqual({ ok: false, error: expect.stringMatching(/moved to the Trash/) })
      expect(await call(IPC.LETTER_TEMPLATE_GENERATE, templateId, rowId, gridId)).toEqual({ ok: false, error: expect.stringMatching(/moved to the Trash/) })
    }
    // A live record still exports
    const live = seed.activeRowIds[0]!
    expect(await call(IPC.EXPORT_PDF_PROFILE, { rowId: live, gridId: seed.gridId, destPath: join(dir, 'live.pdf'), includeSections: sections })).toEqual({ ok: true, data: true })
    expect(await call(IPC.LETTER_TEMPLATE_GENERATE, templateId, live, seed.gridId)).toMatchObject({ ok: true })
  })
})
