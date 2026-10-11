/**
 * Starter templates — src/main/starters.ts (W01 §4)
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'


vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-starters') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {}, exit: () => {}, on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: () => {},
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: undefined }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    cachedStmt: (key: string, sql: string) => testDb.db.prepare(sql),
  }
})

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { BUILTIN_STARTERS } from '../src/shared/starters'
import { parseStarter } from '../src/shared/starters/schema'
import { HUMAN_SERVICES_VOCAB } from '../src/shared/vocab'
import { seedGrid, setDbWords } from './helpers'

const starters = () => import('../src/main/starters')

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

let dir: string
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'pulse-starter-')) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

/** Write a starter to a temp file and return its source */
function fileSource(data: unknown): { filePath: string } {
  const filePath = join(dir, `s-${Math.random().toString(36).slice(2)}.pulse`)
  writeFileSync(filePath, typeof data === 'string' ? data : JSON.stringify(data))
  return { filePath }
}

const thresholds = JSON.stringify([{ daysBefore: 0, bgClass: '#dc2626', label: 'Due' }])
const shop = {
  pulse_template: '2.0', type: 'workspace', id: 'auto-shop', name: 'Auto shop', description: 'Customers and vehicles', icon: 'wrench',
  vocab: { record: { one: 'customer', many: 'customers', article: 'a' } },
  suggestedFeatures: { letters: true, tasks: false },
  lists: [
    {
      key: 'customers', name: 'Customers', kind: 'person',
      columns: [
        { name: 'Name', column_type: 'text', position: 0, is_name_column: 1, is_identifier: 1 },
        { name: 'Phone', column_type: 'phone', position: 1 },
      ],
    },
    {
      key: 'vehicles', name: 'Vehicles', kind: 'thing',
      vocab: { record: { one: 'vehicle', many: 'vehicles', article: 'a' } },
      columns: [
        { name: 'Vehicle', column_type: 'text', position: 0, is_name_column: 1 },
        { name: 'Last oil change', column_type: 'date', position: 1, config: JSON.stringify({ alert_rule_name: 'Oil change', done_checklist_name: 'Service', alert_rule_id: 999 }) },
        { name: 'Mileage', column_type: 'odometer', position: 2 },
      ],
      alertRules: [{ name: 'Oil change', thresholds, interval_months: 6 }],
      checklists: [{ name: 'Service', items: JSON.stringify(['Oil', 'Filter']) }],
    },
  ],
  sampleData: {
    records: {
      customers: [{ Name: 'Pat Example', Phone: '555-0100' }],
      vehicles: [{ Vehicle: '2015 Civic', 'Last oil change': { daysFromToday: -10 } }, { Vehicle: '2019 F-150', Nope: 'x' }],
    },
    activities: [{ record: 'vehicles#0', type: 'visit', daysAgo: 3, text: 'Came in for oil' }, { record: 'vehicles#1', type: 'bogus', daysAgo: 0, text: 'Called' }],
  },
}
const all = { lists: ['customers', 'vehicles'], applyWords: true, applyFeatures: true, sampleData: false }
const setting = (key: string) => (testDb.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value

describe('starter validation', () => {
  it('every built-in starter is valid', async () => {
    for (const raw of BUILTIN_STARTERS) expect(parseStarter(raw)).toMatchObject({ ok: true })
    const list = (await starters()).listBuiltinStarters()
    expect(list.map(s => s.id)).toContain('human-services')
    // The broad social-work layout is the default, not a state-specific one (audit F-19)
    expect(list.find(s => s.id === 'human-services')!.variants[0]!.key).toBe('social-worker-caseload')
    expect(list[0]!.variants.length).toBe(11)
  })

  it('explains what is wrong with a file', () => {
    expect(parseStarter(null)).toEqual({ ok: false, error: "This isn't a Pulse template file." })
    expect(parseStarter({ ...shop, pulse_template: '2.1' })).toMatchObject({ ok: false, error: expect.stringMatching(/newer version of Pulse\. Update/) })
    expect(parseStarter({ ...shop, lists: [shop.lists[0], shop.lists[0]] })).toMatchObject({ ok: false, error: expect.stringMatching(/same key/) })
    expect(parseStarter({ ...shop, lists: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/problem \(at lists\)/) })
    expect(parseStarter({ ...shop, extra: 1 })).toMatchObject({ ok: false })
  })

  it('refuses files that are not JSON or too large', async () => {
    const { loadStarter } = await starters()
    expect(() => loadStarter(fileSource('not json'))).toThrow("This isn't a Pulse template file.")
    expect(() => loadStarter(fileSource('x'.repeat(2 * 1024 * 1024 + 1)))).toThrow(/too large/)
    expect(() => loadStarter({ builtinId: 'nope' })).toThrow(/isn't available/)
  })
})

describe('applying a starter', () => {
  it('adds lists with columns, rules and checklists linked by name, plus words and features', async () => {
    const { applyStarter } = await starters()
    const res = applyStarter(fileSource(shop), all)
    expect(Object.keys(res.gridIds)).toEqual(['customers', 'vehicles'])
    expect(res.workspaceChanged).toBe(true)

    const grid = testDb.db.prepare('SELECT name, record_kind, vocab FROM grids WHERE id = ?').get(res.gridIds.vehicles) as { name: string; record_kind: string; vocab: string }
    expect(grid).toMatchObject({ name: 'Vehicles', record_kind: 'thing' })
    expect(JSON.parse(grid.vocab).record.one).toBe('vehicle')

    const cfg = JSON.parse((testDb.db.prepare("SELECT config FROM columns WHERE grid_id = ? AND name = 'Last oil change'").get(res.gridIds.vehicles) as { config: string }).config)
    const ruleId = (testDb.db.prepare("SELECT id FROM alert_rules WHERE name = 'Oil change'").get() as { id: number }).id
    const clId = (testDb.db.prepare("SELECT id FROM checklist_templates WHERE name = 'Service'").get() as { id: number }).id
    expect(cfg).toMatchObject({ alert_rule_id: ruleId, alert_rule_name: 'Oil change', done_checklist_id: clId })

    // A column type this version doesn't have becomes text, with a warning
    expect(testDb.db.prepare("SELECT column_type FROM columns WHERE name = 'Mileage'").get()).toEqual({ column_type: 'text' })
    expect(res.warnings.join(' ')).toMatch(/Mileage/)

    expect(JSON.parse(setting('workspace_vocab')!).record.one).toBe('customer')
    expect(JSON.parse(setting('workspace_features')!)).toMatchObject({ letters: true, tasks: false })
  })

  it('marks required columns, but never ones that can\'t be missing, and shares them again', async () => {
    const { applyStarter, exportWorkspaceStarter } = await starters()
    const staff = {
      ...shop, lists: [{
        key: 'staff', name: 'Staff', kind: 'person',
        columns: [
          { name: 'Name', column_type: 'text', position: 0, is_name_column: 1, is_required: 1 },
          { name: 'Hired', column_type: 'date', position: 1, is_required: 1 },
          { name: 'Oriented', column_type: 'checkbox', position: 2, is_required: 1 },
          { name: 'Phone', column_type: 'phone', position: 3 },
        ],
      }], sampleData: undefined,
    }
    const res = applyStarter(fileSource(staff), { ...all, lists: ['staff'] })
    const required = () => testDb.db.prepare('SELECT name FROM columns WHERE is_required = 1 ORDER BY position').all().map(r => (r as { name: string }).name)
    expect(required()).toEqual(['Name', 'Hired'])
    const shared = exportWorkspaceStarter().lists!.find(l => l.name === 'Staff')!
    expect(shared.columns.filter(c => c.is_required).map(c => c.name)).toEqual(['Name', 'Hired'])
    testDb.db.prepare('DELETE FROM grids WHERE id = ?').run(res.gridIds.staff)
    applyStarter(fileSource({ ...staff, lists: [shared] }), { ...all, lists: [shared.key] })
    expect(required()).toEqual(['Name', 'Hired'])
  })

  it('a shared Age column reads the new list\'s birth-date column (S4)', async () => {
    const { applyStarter, exportWorkspaceStarter } = await starters()
    const people = {
      ...shop, lists: [{
        key: 'people', name: 'People', kind: 'person',
        columns: [
          { name: 'Name', column_type: 'text', position: 0, is_name_column: 1 },
          { name: 'Born', column_type: 'date', position: 1 },
          { name: 'Age', column_type: 'age_from_dob', position: 2, config: JSON.stringify({ source_column_name: 'Born' }) },
        ],
      }], sampleData: undefined,
    }
    const res = applyStarter(fileSource(people), { ...all, lists: ['people'] })
    const ageCfg = (gridId: number) => JSON.parse((testDb.db.prepare("SELECT config FROM columns WHERE grid_id = ? AND name = 'Age'").get(gridId) as { config: string }).config)
    const bornId = (gridId: number) => (testDb.db.prepare("SELECT id FROM columns WHERE grid_id = ? AND name = 'Born'").get(gridId) as { id: number }).id
    expect(ageCfg(res.gridIds.people!)).toEqual({ source_column_id: bornId(res.gridIds.people!) })

    // Shared again and applied as a second list: it points at its own column, not the first list's
    const shared = exportWorkspaceStarter().lists!.find(l => l.name === 'People')!
    const again = applyStarter(fileSource({ ...people, lists: [shared] }), { ...all, lists: [shared.key] })
    const second = Object.values(again.gridIds)[0]!
    expect(second).not.toBe(res.gridIds.people)
    expect(ageCfg(second)).toEqual({ source_column_id: bornId(second) })
  })

  it('adds only the chosen lists and leaves words and features alone when asked', async () => {
    const { applyStarter } = await starters()
    const res = applyStarter(fileSource(shop), { ...all, lists: ['vehicles'], applyWords: false, applyFeatures: false })
    expect(Object.keys(res.gridIds)).toEqual(['vehicles'])
    expect(res.workspaceChanged).toBe(false)
    expect(setting('workspace_vocab')).toBeUndefined()
    expect(() => applyStarter(fileSource(shop), { ...all, lists: [] })).toThrow(/at least one list/)
  })

  it('never overwrites: renames clashing lists, reuses identical rules, renames different ones', async () => {
    const { applyStarter } = await starters()
    applyStarter(fileSource(shop), all)
    const again = applyStarter(fileSource(shop), all)
    expect(again.renamed).toMatchObject({ Customers: 'Customers 2', Vehicles: 'Vehicles 2' })
    expect(testDb.db.prepare("SELECT COUNT(*) AS n FROM alert_rules WHERE name LIKE 'Oil change%'").get()).toEqual({ n: 1 })

    const changed = { ...shop, lists: [{ ...shop.lists[1], alertRules: [{ name: 'Oil change', thresholds, interval_months: 3 }] }] }
    const third = applyStarter(fileSource(changed), { ...all, lists: ['vehicles'] })
    expect(third.renamed['Oil change']).toBe('Oil change 2')
    const cfg = JSON.parse((testDb.db.prepare('SELECT config FROM columns WHERE grid_id = ? AND name = ?').get(third.gridIds.vehicles, 'Last oil change') as { config: string }).config)
    expect(cfg.alert_rule_name).toBe('Oil change 2')
  })

  it('loads earlier values of a column as its history, leaving the cell at the newest', async () => {
    const { applyStarter } = await starters()
    const fleet = structuredClone(shop)
    fleet.lists[1]!.columns.push({ name: 'Odometer', column_type: 'number', position: 3 })
    const withHistory = {
      ...fleet,
      sampleData: {
        records: { vehicles: [{ Vehicle: '2015 Civic', Odometer: 41000 }] },
        history: [
          { record: 'vehicles#0', column: 'Odometer', values: [{ value: '38000', daysAgo: 90 }, { value: '39500', daysAgo: 45 }, { value: '41000', daysAgo: 1 }] },
          { record: 'vehicles#0', column: 'Nope', values: [{ value: '1', daysAgo: 1 }] },
        ],
      },
    }
    const res = applyStarter(fileSource(withHistory), { ...all, lists: ['vehicles'], sampleData: true })
    expect(res.warnings).toContain('Sample history names a column "Nope" that isn\'t in the list.')
    const rows = testDb.db.prepare("SELECT h.old_value, h.new_value, CAST(julianday('now') - julianday(h.changed_at) + 0.5 AS INTEGER) AS ago FROM cell_history h JOIN columns c ON c.id = h.column_id WHERE c.name = 'Odometer' ORDER BY h.changed_at").all()
    expect(rows).toEqual([
      { old_value: null, new_value: '38000', ago: 90 },
      { old_value: '38000', new_value: '39500', ago: 45 },
      { old_value: '39500', new_value: '41000', ago: 1 },
    ])
    expect(testDb.db.prepare("SELECT value FROM cells WHERE column_id = (SELECT id FROM columns WHERE name = 'Odometer')").get()).toEqual({ value: '41000' })
  })

  it('marks sample steps done on step-by-step deadlines, for the record\'s own start date', async () => {
    const { applyStarter } = await starters()
    const steps = {
      ...shop, lists: [{
        key: 'kids', name: 'Kids', kind: 'person',
        columns: [
          { name: 'Name', column_type: 'text', position: 0, is_name_column: 1 },
          { name: 'Referral date', column_type: 'date', position: 1 },
          { name: 'Timeline', column_type: 'deadline', position: 2, config: JSON.stringify({ alert_rule_name: 'Steps' }) },
        ],
        alertRules: [{ name: 'Steps', thresholds, kind: 'sequence', rule_config: JSON.stringify({ kind: 'sequence', anchorColumnId: { column: 'Referral date' }, steps: [
          { label: 'One', offset: { days: 10 } }, { label: 'Two', offset: { days: 20 } }, { label: 'Three', offset: { days: 300 } },
        ] }) }],
      }],
      sampleData: {
        records: { kids: [{ Name: 'A', 'Referral date': { daysFromToday: -40 } }] },
        stepsDone: [{ record: 'kids#0', column: 'Timeline', steps: 2 }, { record: 'kids#0', column: 'Name', steps: 1 }],
      },
    }
    const res = applyStarter(fileSource(steps), { ...all, lists: ['kids'], sampleData: true })
    expect(res.warnings).toEqual(['Sample steps name "Name", which isn\'t a step-by-step deadline in the list.'])
    const referral = (testDb.db.prepare("SELECT value FROM cells WHERE column_id = (SELECT id FROM columns WHERE name = 'Referral date')").get() as { value: string }).value
    expect(testDb.db.prepare('SELECT step, anchor_value FROM deadline_progress ORDER BY step').all()).toEqual([{ step: 0, anchor_value: referral }, { step: 1, anchor_value: referral }])
    const { loadDeadlines } = await import('../src/main/deadlines')
    expect(loadDeadlines({ gridId: res.gridIds.kids })[0]).toMatchObject({ step: 2, state: 'ok' })
  })

  it('loads sample appointments and weekly series, past ones done, and removes them with the samples', async () => {
    const { applyStarter, removeSampleData } = await starters()
    const withAppts = {
      ...shop,
      sampleData: {
        records: { customers: [{ Name: 'Pat Example' }] },
        appointments: [
          { record: 'customers#0', title: 'Weekly session', dayOffset: -14, time: '15:00', minutes: 50, type: 'visit', repeatWeekly: 6 },
          { record: 'customers#0', title: 'Missed', dayOffset: -3, time: '10:00', status: 'no_show' },
          { record: 'customers#0', title: 'Paperwork day', dayOffset: 2 },
          { record: 'customers#9', title: 'Nobody', dayOffset: 1 },
        ],
      },
    }
    expect(parseStarter(withAppts)).toMatchObject({ ok: true })
    const res = applyStarter(fileSource(withAppts), { ...all, sampleData: true })
    expect(res.warnings.join(' ')).not.toMatch(/appointment/)
    const appts = testDb.db.prepare('SELECT title, start_at, end_at, all_day, status, activity_type_key, series_id FROM appointments ORDER BY start_at').all() as Array<{ title: string; start_at: string; end_at: string | null; all_day: number; status: string; activity_type_key: string | null; series_id: number | null }>
    const weekly = appts.filter(a => a.title === 'Weekly session')
    expect(weekly).toHaveLength(6)
    expect(weekly.map(a => a.status)).toEqual(['done', 'done', 'scheduled', 'scheduled', 'scheduled', 'scheduled'])
    expect(weekly[0]).toMatchObject({ end_at: expect.stringMatching(/T15:50$/), activity_type_key: 'visit', series_id: expect.any(Number) })
    expect(appts.find(a => a.title === 'Missed')).toMatchObject({ status: 'no_show', end_at: null })
    expect(appts.find(a => a.title === 'Paperwork day')).toMatchObject({ all_day: 1, status: 'scheduled' })

    removeSampleData()
    // Their records are in the Trash, so their visits are hidden (and come back with a restore)
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM appointments a JOIN rows r ON r.id = a.row_id WHERE r.deleted_at IS NULL').get()).toEqual({ n: 0 })
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM appointment_series').get()).toEqual({ n: 0 })
  })

  it('makes dates with a rule wide enough for the deadline words', async () => {
    const { applyStarter } = await starters()
    const res = applyStarter({ builtinId: 'tree-service' }, { lists: ['customers', 'jobs', 'equipment', 'crew'], applyWords: false, applyFeatures: false, sampleData: false })
    const cols = testDb.db.prepare(`SELECT column_type, width, config FROM columns WHERE grid_id IN (${Object.values(res.gridIds).join(',')})`).all() as Array<{ column_type: string; width: number; config: string }>
    const ruled = cols.filter(c => c.column_type === 'deadline' || (c.column_type === 'date' && 'alert_rule_name' in JSON.parse(c.config)))
    expect(ruled.length).toBeGreaterThan(0)
    expect(ruled.every(c => c.width >= 250)).toBe(true)
    // Plain dates keep the width the starter gave them
    expect(cols.some(c => c.column_type === 'date' && !('alert_rule_name' in JSON.parse(c.config)) && c.width < 250)).toBe(true)
  })

  it('gives sample data a past: added dates over the year, older everyday notes, finished jobs in past months', async () => {
    const { applyStarter, removeSampleData, sampleRowIds } = await starters()
    const res = applyStarter({ builtinId: 'tree-service' }, { lists: ['customers', 'jobs', 'equipment', 'crew'], applyWords: false, applyFeatures: false, sampleData: true })
    const db = testDb.db
    const added = db.prepare("SELECT COUNT(DISTINCT strftime('%Y-%m', created_at)) AS n FROM rows WHERE grid_id = ?").get(res.gridIds.customers) as { n: number }
    expect(added.n).toBeGreaterThan(3)
    // Generated notes are at least five weeks old, of everyday kinds, never newer than the record
    const gen = db.prepare(`SELECT c.log_type, julianday('now') - julianday(c.created_at) AS age, julianday(c.created_at) - julianday(r.created_at) AS after
      FROM case_log c JOIN rows r ON r.id = c.row_id WHERE julianday('now') - julianday(c.created_at) > 34`).all() as Array<{ log_type: string; age: number; after: number }>
    expect(gen.length).toBeGreaterThan(20)
    expect(gen.every(g => g.after >= 0)).toBe(true)
    expect(new Set(gen.map(g => g.log_type)).size).toBeGreaterThan(1)
    // Done jobs copied back into past months, with their customer, finished dates spread over the year
    const jobs = db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT substr(v.value, 1, 7)) AS months FROM rows r
      JOIN cells v ON v.row_id = r.id JOIN columns c ON c.id = v.column_id AND c.name = 'Completed on' WHERE r.grid_id = ?`).get(res.gridIds.jobs) as { n: number; months: number }
    expect(jobs.n).toBeGreaterThan(12)
    expect(jobs.months).toBeGreaterThan(8)
    const unlinked = db.prepare(`SELECT COUNT(*) AS n FROM rows r WHERE r.grid_id = ? AND NOT EXISTS (SELECT 1 FROM record_links l WHERE l.from_row_id = r.id)`).get(res.gridIds.jobs) as { n: number }
    expect(unlinked.n).toBe(0)
    // Same every time, and all of it goes with "Remove sample data"
    const tracked = sampleRowIds().length
    expect(tracked).toBe((db.prepare('SELECT COUNT(*) AS n FROM rows').get() as { n: number }).n)
    expect(removeSampleData()).toEqual({ removed: tracked, kept: 0, keptListName: null })
    expect(db.prepare('SELECT COUNT(*) AS n FROM rows WHERE deleted_at IS NULL').get()).toEqual({ n: 0 })
  })

  it('leaves note types that a quota counts out of the made-up history', async () => {
    const { applyStarter } = await starters()
    const res = applyStarter({ builtinId: 'therapy-practice' }, { lists: ['clients'], applyWords: false, applyFeatures: false, sampleData: true })
    const { SAMPLE_HISTORY_TEXTS } = await import('../src/main/sample-history')
    const made = (testDb.db.prepare(`SELECT c.log_type, c.content FROM case_log c JOIN rows r ON r.id = c.row_id WHERE r.grid_id = ?`).all(res.gridIds.clients) as Array<{ log_type: string; content: string }>)
      .filter(n => SAMPLE_HISTORY_TEXTS.includes(n.content))
    expect(made.length).toBeGreaterThan(10)
    expect(made.map(n => n.log_type)).not.toContain('session')
  })

  it('loads sample data that can be removed', async () => {
    const { applyStarter, removeSampleData, sampleRowIds } = await starters()
    const res = applyStarter(fileSource(shop), { ...all, sampleData: true })
    expect(sampleRowIds()).toHaveLength(3)
    expect(res.warnings.join(' ')).toMatch(/"Nope"/)

    const civic = testDb.db.prepare("SELECT r.id FROM rows r WHERE r.grid_id = ? AND r.display_name = '2015 Civic'").get(res.gridIds.vehicles) as { id: number }
    const date = (testDb.db.prepare("SELECT value FROM cells c JOIN columns col ON col.id = c.column_id WHERE c.row_id = ? AND col.name = 'Last oil change'").get(civic.id) as { value: string }).value
    const expected = new Date(); expected.setDate(expected.getDate() - 10)
    expect(date).toBe(`${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`)
    // The hand-written note is the newest; older everyday notes come from the sample history
    expect(testDb.db.prepare('SELECT log_type FROM case_log WHERE row_id = ? ORDER BY created_at DESC LIMIT 1').all(civic.id)).toEqual([{ log_type: 'visit' }])
    expect(testDb.db.prepare("SELECT log_type FROM case_log WHERE content = 'Called'").get()).toEqual({ log_type: 'note' })

    // Removing samples keeps the lists and real records
    testDb.db.prepare("INSERT INTO rows (grid_id, position) VALUES (?, 99)").run(res.gridIds.customers)
    expect(removeSampleData().removed).toBe(3)
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM rows WHERE deleted_at IS NULL').get()).toEqual({ n: 1 })
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM grids').get()).toEqual({ n: 2 })
  })
})

describe('note types, numbers, periods and name formats in examples (W03 §5)', () => {
  const therapy = {
    pulse_template: '2.0', type: 'workspace', id: 'therapy', name: 'Therapy practice', description: 'Clients and sessions', icon: 'users',
    activityTypes: [
      { key: 'session', label: 'Session', icon: '🗣️', color: 'blue' },
      { key: 'no_show', label: 'No-show', color: 'red' },
      { key: 'phone', label: 'Call' },
    ],
    measures: [{ key: 'copay', label: 'Copay', kind: 'currency', decimals: 2 }],
    lists: [{
      key: 'clients', name: 'Clients', kind: 'person', displayFormat: '{Last} , {First}',
      columns: [
        { name: 'First', column_type: 'text', position: 0, is_name_column: 1 },
        { name: 'Last', column_type: 'text', position: 1 },
      ],
      requirements: [
        { label: 'Sessions', note_types: ['session'], per_month: 1, period: 'week' },
        { label: 'Unknown', note_types: ['telehealth'], per_month: 1 },
      ],
    }],
  }

  it('adds missing types and numbers by key, never renaming the user\'s own', async () => {
    const { applyStarter } = await starters()
    const res = applyStarter(fileSource(therapy), { lists: ['clients'], applyWords: false, applyFeatures: false, sampleData: false })
    expect(res.activityTypesChanged).toBe(true)
    expect(testDb.db.prepare("SELECT label, icon, color FROM activity_types WHERE key = 'session'").get()).toEqual({ label: 'Session', icon: '🗣️', color: 'blue' })
    // the existing Phone type keeps its name
    expect(testDb.db.prepare("SELECT label FROM activity_types WHERE key = 'phone'").get()).toEqual({ label: 'Phone' })
    expect(JSON.parse(setting('workspace_measures')!)).toEqual([{ key: 'copay', label: 'Copay', kind: 'currency', decimals: 2 }])
    expect(res.workspaceChanged).toBe(true)

    const gridId = res.gridIds.clients!
    expect(testDb.db.prepare('SELECT display_format FROM grids WHERE id = ?').get(gridId)).toEqual({ display_format: '{Last} , {First}' })
    expect(testDb.db.prepare('SELECT label, period, per_month FROM contact_requirements WHERE grid_id = ?').all(gridId))
      .toEqual([{ label: 'Sessions', period: 'week', per_month: 1 }])
    expect(res.warnings.join(' ')).toMatch(/"Unknown".*wasn't added/)
  })

  it('an example with its own full set replaces the starting types in a fresh workspace (audit R-17)', async () => {
    const { applyStarter } = await starters()
    applyStarter({ builtinId: 'tree-service' }, { lists: ['customers'], applyWords: false, applyFeatures: false, sampleData: false })
    const active = (testDb.db.prepare('SELECT key FROM activity_types WHERE is_archived = 0 ORDER BY key').all() as Array<{ key: string }>).map(r => r.key)
    expect(active).toEqual(['call', 'note', 'site_visit', 'text'])
    // Archived, not deleted, so nothing that refers to them breaks
    expect(testDb.db.prepare("SELECT is_archived FROM activity_types WHERE key = 'phone'").get()).toEqual({ is_archived: 1 })
  })

  it("keeps the starting types once the workspace has notes, or when the example only adds", async () => {
    const { applyStarter } = await starters()
    applyStarter(fileSource(therapy), { lists: ['clients'], applyWords: false, applyFeatures: false, sampleData: false })
    expect(testDb.db.prepare("SELECT is_archived FROM activity_types WHERE key = 'visit'").get()).toEqual({ is_archived: 0 })
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Called', 'phone')").run(rowIds[0])
    applyStarter({ builtinId: 'tree-service' }, { lists: ['customers'], applyWords: false, applyFeatures: false, sampleData: false })
    expect(testDb.db.prepare("SELECT is_archived FROM activity_types WHERE key = 'visit'").get()).toEqual({ is_archived: 0 })
  })

  it('applying twice adds nothing new', async () => {
    const { applyStarter } = await starters()
    applyStarter(fileSource(therapy), { lists: ['clients'], applyWords: false, applyFeatures: false, sampleData: false })
    const res = applyStarter(fileSource(therapy), { lists: ['clients'], applyWords: false, applyFeatures: false, sampleData: false })
    expect(res.activityTypesChanged).toBeUndefined()
    expect((testDb.db.prepare("SELECT COUNT(*) AS n FROM activity_types WHERE key = 'session'").get() as { n: number }).n).toBe(1)
    expect(JSON.parse(setting('workspace_measures')!)).toHaveLength(1)
  })

  it('shares them and opens them again elsewhere', async () => {
    const { applyStarter, exportWorkspaceStarter } = await starters()
    applyStarter(fileSource(therapy), { lists: ['clients'], applyWords: false, applyFeatures: false, sampleData: false })
    const shared = exportWorkspaceStarter()
    expect(shared.activityTypes!.map(t => t.key)).toEqual(expect.arrayContaining(['session', 'no_show', 'note']))
    expect(shared.measures).toEqual([{ key: 'copay', label: 'Copay', kind: 'currency', decimals: 2 }])
    expect(shared.lists![0]).toMatchObject({ displayFormat: '{Last} , {First}', requirements: [{ label: 'Sessions', period: 'week' }] })
  })

  it('refuses too many per period', async () => {
    const { parseStarter } = await import('../src/shared/starters/schema')
    const bad = { ...therapy, lists: [{ ...therapy.lists[0], requirements: [{ label: 'X', note_types: ['session'], per_month: 20, period: 'week' }] }] }
    expect(parseStarter(bad).ok).toBe(false)
  })
})

describe('preview', () => {
  it('shows the lists with final names, the words that change and the features that turn on', async () => {
    const { previewStarter, applyStarter } = await starters()
    applyStarter(fileSource(shop), { ...all, lists: ['customers'], applyWords: false, applyFeatures: false })
    const p = previewStarter(fileSource(shop))
    expect(p.lists.map(l => l.finalName)).toEqual(['Customers 2', 'Vehicles'])
    expect(p.words).toEqual([{ key: 'record', current: 'records', proposed: 'customers' }])
    expect(p.features.map(f => f.key)).toEqual(['letters'])
    expect(p.hasSampleData).toBe(true)
  })
})

describe('human-services starter', () => {
  it('each variant builds exactly the list its built-in setup template builds', async () => {
    const { applyStarter } = await starters()
    const { getSetupTemplates, applyPulseToNewGrid } = await import('../src/main/templates')
    const cols = (gridId: number) => (testDb.db.prepare('SELECT name, column_type, width, position, is_name_column, is_identifier, config FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<Record<string, unknown>>)
      .map(c => ({ ...c, config: JSON.parse(c.config as string) }))
    setDbWords(testDb.db) // the built-ins are only seeded under the human-services words
    const setups = getSetupTemplates().filter(t => t.is_system === 1)
    const hs = parseStarter(BUILTIN_STARTERS[0])
    if (!hs.ok) throw new Error(hs.error)
    for (const v of hs.starter.variants!) {
      const setup = setups.find(t => t.name === v.name)!
      const fromSetup = applyPulseToNewGrid(JSON.parse(setup.pulse_json))
      const fromStarter = applyStarter({ builtinId: 'human-services' }, { lists: ['caseload'], variant: v.key, applyWords: false, applyFeatures: false, sampleData: false }).gridIds.caseload!
      expect(cols(fromStarter), v.name).toEqual(cols(fromSetup))
    }
  })

  it("sets today's words and features and the care manager requirements", async () => {
    const { applyStarter } = await starters()
    const res = applyStarter({ builtinId: 'human-services' }, { lists: ['caseload'], variant: 'care-manager-service-coordinator', applyWords: true, applyFeatures: true, sampleData: false })
    expect(JSON.parse(setting('workspace_vocab')!)).toEqual(HUMAN_SERVICES_VOCAB)
    expect(JSON.parse(setting('workspace_features')!)).toMatchObject({ requirements: true, letters: true, timeTracking: false })
    expect(testDb.db.prepare('SELECT label, per_month FROM contact_requirements WHERE grid_id = ? ORDER BY position').all(res.gridIds.caseload))
      .toEqual([{ label: 'Visit', per_month: 1 }, { label: 'Phone contact', per_month: 1 }])
  })
})

describe('sharing a setup', () => {
  function seedWorkspace() {
    const db = testDb.db
    const g = seedGrid(db, { columnTypes: ['text', 'date', 'dropdown'], rowCount: 2 })
    const ruleId = Number(db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days, is_system) VALUES ('Visit every 30', ?, 30, 0)").run(thresholds).lastInsertRowid)
    const clId = Number(db.prepare("INSERT INTO checklist_templates (name, items, is_system) VALUES ('Intake', '[\"Consent\"]', 0)").run().lastInsertRowid)
    db.prepare('UPDATE columns SET name = ?, config = ? WHERE id = ?').run('Last visit', JSON.stringify({ alert_rule_id: ruleId, done_checklist_id: clId }), g.columnIds[1])
    db.prepare("INSERT INTO contact_requirements (grid_id, label, note_types, per_month) VALUES (?, 'Visit', '[\"visit\"]', 2)").run(g.gridId)
    db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, 'Secret Person')").run(g.rowIds[0], g.columnIds[0])
    db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Private note text', 'note')").run(g.rowIds[0])
    db.prepare("INSERT INTO settings (key, value) VALUES ('workspace_vocab', ?)").run(JSON.stringify({ record: { one: 'customer', many: 'customers', article: 'a' } }))
    db.prepare("INSERT INTO settings (key, value) VALUES ('note_formats', ?)").run(JSON.stringify([{ id: 'custom-1', name: 'Visit report', fields: ['Seen', 'Next'] }]))
    db.prepare("INSERT INTO settings (key, value) VALUES ('profile_name', 'Dana Worker')").run()
    db.prepare("INSERT INTO letter_templates (name, content, is_system) VALUES ('Welcome', 'Hello {{client_name}}', 0)").run()
    return g
  }

  it('exports lists, rules, checklists, requirements, words and formats, but no records, notes or personal settings', async () => {
    const { exportWorkspaceStarter } = await starters()
    seedWorkspace()
    const s = exportWorkspaceStarter()
    const json = JSON.stringify(s)
    expect(json).not.toMatch(/Secret Person|Private note text|Dana Worker/)
    expect(s.lists).toHaveLength(1)
    const list = s.lists![0]!
    expect(list.alertRules!.map(r => r.name)).toEqual(['Visit every 30'])
    expect(list.checklists!.map(c => c.name)).toEqual(['Intake'])
    expect(list.requirements).toEqual([{ label: 'Visit', note_types: ['visit'], per_month: 2 }])
    expect(JSON.parse(list.columns[1]!.config!)).toEqual({ alert_rule_name: 'Visit every 30', done_checklist_name: 'Intake' })
    expect(s.vocab!.record!.one).toBe('customer')
    expect(s.noteFormats![0]!.name).toBe('Visit report')
    expect(s.documentTemplates).toEqual([{ name: 'Welcome', content: 'Hello {{client_name}}' }])
  })

  it('opens again as the same setup in another workspace', async () => {
    const { exportWorkspaceStarter, applyStarter } = await starters()
    const g = seedWorkspace()
    const file = fileSource(exportWorkspaceStarter())
    const before = testDb.db.prepare('SELECT name, column_type, position FROM columns WHERE grid_id = ? ORDER BY position').all(g.gridId)
    cleanupTestDb(testDb)
    testDb = createTestDb()
    const res = applyStarter(file, { lists: ['test-caseload'], applyWords: true, applyFeatures: true, sampleData: false })
    const gridId = Object.values(res.gridIds)[0]!
    expect(testDb.db.prepare('SELECT name, column_type, position FROM columns WHERE grid_id = ? ORDER BY position').all(gridId)).toEqual(before)
    const cfg = JSON.parse((testDb.db.prepare("SELECT config FROM columns WHERE grid_id = ? AND name = 'Last visit'").get(gridId) as { config: string }).config)
    expect(cfg.alert_rule_id).toBe((testDb.db.prepare("SELECT id FROM alert_rules WHERE name = 'Visit every 30'").get() as { id: number }).id)
    expect(cfg.done_checklist_id).toBe((testDb.db.prepare("SELECT id FROM checklist_templates WHERE name = 'Intake'").get() as { id: number }).id)
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM rows').get()).toEqual({ n: 0 })
    expect(JSON.parse(setting('workspace_vocab')!).record.one).toBe('customer')
    expect(testDb.db.prepare("SELECT 1 AS x FROM letter_templates WHERE name = 'Welcome'").get()).toEqual({ x: 1 })
  })

  it('leaves out the sample caseload and refuses an empty workspace', async () => {
    const { exportWorkspaceStarter } = await starters()
    expect(() => exportWorkspaceStarter()).toThrow(/nothing to share/)
    const { createSampleCaseload } = await import('../src/main/sample-data')
    createSampleCaseload()
    expect(() => exportWorkspaceStarter()).toThrow(/nothing to share/)
  })

  it('opens an old single-list .pulse file as a one-list example', async () => {
    const { loadStarter, applyStarter } = await starters()
    const v1 = { pulse_template: '1.0', type: 'setup', name: 'Old layout', created: '2026-01-01',
      columns: [{ name: 'Name', column_type: 'text', position: 0, is_name_column: 1 }, { name: 'Due', column_type: 'date', position: 1, config: JSON.stringify({ alert_rule_name: 'Old rule' }) }],
      alert_rules: [{ name: 'Old rule', thresholds, interval_days: 0 }], checklists: [] }
    const src = fileSource(v1)
    const s = loadStarter(src)
    expect(s.vocab).toBeUndefined()
    expect(s.lists!.map(l => l.name)).toEqual(['Old layout'])
    const res = applyStarter(src, { lists: ['list'], applyWords: true, applyFeatures: true, sampleData: false })
    expect(res.workspaceChanged).toBe(false)
    expect(testDb.db.prepare("SELECT 1 AS x FROM alert_rules WHERE name = 'Old rule'").get()).toEqual({ x: 1 })
  })
})
