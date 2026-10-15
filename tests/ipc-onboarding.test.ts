/**
 * IPC Onboarding handler tests — tests ONBOARDING_* IPC handlers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { localDateString } from '../src/shared/dates'

// ── Handler capture map ──────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-onboarding') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {},
    exit: () => {},
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '' },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    cachedStmt: (key: string, sql: string) => testDb.db.prepare(sql),
  }
})

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`)
  return await handler(fakeEvent, ...args)
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerOnboardingHandlers } = await import('../src/main/ipc/ipc-onboarding')
  registerOnboardingHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
})

afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IPC Onboarding — ONBOARDING_CHECK', () => {
  it('returns { complete: false } on fresh database', async () => {
    const result = await invoke(IPC.ONBOARDING_CHECK) as any
    expect(result.ok).toBe(true)
    expect(result.data.complete).toBe(false)
  })

  it('returns { complete: true } if onboarding_complete flag is set', async () => {
    testDb.db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('onboarding_complete', '1')").run()
    const result = await invoke(IPC.ONBOARDING_CHECK) as any
    expect(result.ok).toBe(true)
    expect(result.data.complete).toBe(true)
  })

  it('returns { complete: true } if grids already exist (existing installation)', async () => {
    seedGrid(testDb.db, { name: 'Existing Grid', rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.ONBOARDING_CHECK) as any
    expect(result.ok).toBe(true)
    expect(result.data.complete).toBe(true)
    // Should also have written the flag
    const meta = testDb.db.prepare("SELECT value FROM app_meta WHERE key = 'onboarding_complete'").get() as any
    expect(meta.value).toBe('1')
  })

  it('still answers in a read-only mode, without writing the flag (AUDIT-093)', async () => {
    const { registerReadOnlyChecker } = await import('../src/main/ipc/ipc-utils')
    seedGrid(testDb.db, { name: 'Existing Grid', rowCount: 0, columnCount: 1 })
    registerReadOnlyChecker(() => true)
    try {
      const result = await invoke(IPC.ONBOARDING_CHECK) as any
      expect(result).toEqual({ ok: true, data: { complete: true, progress: null } })
      expect(testDb.db.prepare("SELECT value FROM app_meta WHERE key = 'onboarding_complete'").get()).toBeUndefined()
    } finally {
      registerReadOnlyChecker(null)
    }
  })

  it('returns { complete: false } if onboarding_complete is "0"', async () => {
    testDb.db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('onboarding_complete', '0')").run()
    const result = await invoke(IPC.ONBOARDING_CHECK) as any
    expect(result.ok).toBe(true)
    expect(result.data.complete).toBe(false)
  })
})

describe('IPC Onboarding — ONBOARDING_COMPLETE', () => {
  it('marks onboarding as complete', async () => {
    const result = await invoke(IPC.ONBOARDING_COMPLETE) as any
    expect(result.ok).toBe(true)
    expect(result.data).toBe(true)
    // Verify flag was set
    const meta = testDb.db.prepare("SELECT value FROM app_meta WHERE key = 'onboarding_complete'").get() as any
    expect(meta.value).toBe('1')
  })

  it('is idempotent', async () => {
    await invoke(IPC.ONBOARDING_COMPLETE)
    const result = await invoke(IPC.ONBOARDING_COMPLETE) as any
    expect(result.ok).toBe(true)
  })

  it('writes all or nothing: a failing step leaves setup unfinished (A22-13)', async () => {
    testDb.db.exec(`CREATE TRIGGER fail_briefing BEFORE INSERT ON settings WHEN NEW.key = 'briefing_last_shown'
      BEGIN SELECT RAISE(ABORT, 'disk full'); END`)
    const result = await invoke(IPC.ONBOARDING_COMPLETE) as { ok: boolean }
    expect(result.ok).toBe(false)
    expect(testDb.db.prepare("SELECT value FROM app_meta WHERE key = 'onboarding_complete'").get()).toBeUndefined()
    expect(testDb.db.prepare("SELECT 1 FROM settings WHERE key = 'onboarding_completed_at'").get()).toBeUndefined()
    testDb.db.exec('DROP TRIGGER fail_briefing')
  })

  it('leaves the words to the path chosen in setup', async () => {
    await invoke(IPC.ONBOARDING_COMPLETE)
    expect(testDb.db.prepare("SELECT 1 FROM settings WHERE key = 'workspace_vocab'").get()).toBeUndefined()
  })
})

describe('IPC Onboarding — ONBOARDING_SETUP_GRID', () => {
  it('creates a grid with columns', async () => {
    const setup = {
      gridName: 'My Caseload',
      columns: [
        { name: 'Client Name', type: 'text', isNameCol: true },
        { name: 'DOB', type: 'date' },
        { name: 'Status', type: 'dropdown' },
      ],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(true)
    expect(result.data).toHaveProperty('gridId')
    expect(typeof result.data.gridId).toBe('number')

    // Verify grid was created
    const grid = testDb.db.prepare('SELECT * FROM grids WHERE id = ?').get(result.data.gridId) as any
    expect(grid.name).toBe('My Caseload')

    // Verify columns
    const cols = testDb.db.prepare('SELECT * FROM columns WHERE grid_id = ? ORDER BY position').all(result.data.gridId) as any[]
    expect(cols).toHaveLength(3)
    expect(cols[0].name).toBe('Client Name')
    expect(cols[0].is_name_column).toBe(1)
    expect(cols[1].column_type).toBe('date')

    // Setup has more questions after making the list: it isn't complete yet (audit F-02)
    const meta = testDb.db.prepare("SELECT value FROM app_meta WHERE key = 'onboarding_complete'").get() as any
    expect(meta.value).toBe('0')
    expect(((await invoke(IPC.ONBOARDING_CHECK)) as any).data.complete).toBe(false)
  })

  it('saves where an interrupted setup stopped, and forgets it once setup finishes', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0 })
    const progress = { step: 'blank', gridId, blank: { name: 'Tenants', kind: 'person', one: 'tenant', many: 'tenants' } }
    expect(((await invoke(IPC.ONBOARDING_SAVE_PROGRESS, progress)) as any).ok).toBe(true)
    // A list exists, but setup isn't treated as done
    expect(((await invoke(IPC.ONBOARDING_CHECK)) as any).data).toEqual({ complete: false, progress })
    expect(((await invoke(IPC.ONBOARDING_SAVE_PROGRESS, { step: 'nope', gridId })) as any).ok).toBe(false)
    await invoke(IPC.ONBOARDING_COMPLETE)
    expect(((await invoke(IPC.ONBOARDING_CHECK)) as any).data).toEqual({ complete: true, progress: null })
    expect(testDb.db.prepare("SELECT 1 FROM app_meta WHERE key = 'setup_progress'").get()).toBeUndefined()
  })

  it('"Getting started" shows for workspaces set up here, and counts only real entries (audit 2.9)', async () => {
    const gs = async () => ((await invoke(IPC.ONBOARDING_GETTING_STARTED)) as any).data
    expect((await gs()).show).toBe(false)
    await invoke(IPC.ONBOARDING_COMPLETE)
    expect(await gs()).toMatchObject({ show: true, record: false, reminder: false, note: false })
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2 })
    // A made-up sample entry doesn't count as "your first"
    testDb.db.prepare("INSERT INTO sample_rows (row_id, grid_id, fingerprint) VALUES (?, 1, '')").run(rowIds[1])
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Made up', 'note')").run(rowIds[1])
    expect(await gs()).toMatchObject({ record: true, note: false })
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Called', 'phone')").run(rowIds[0])
    expect((await gs()).note).toBe(true)
    testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('onboarding_getting_started_dismissed', '1')").run()
    expect((await gs()).show).toBe(false)
  })

  /** A "Due date" rule on the column: yellow 14 days before, red on the day */
  function dueDateRule(columnId: number): void {
    const thresholds = JSON.stringify([{ daysBefore: 14, bgClass: '#facc15', label: 'Due soon' }, { daysBefore: 0, bgClass: '#dc2626', label: 'Due today' }, { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' }])
    const ruleId = testDb.db.prepare("INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('Due date', 0, ?, datetime('now'))").run(thresholds).lastInsertRowid
    testDb.db.prepare("UPDATE columns SET config = json_object('alert_rule_id', ?) WHERE id = ?").run(ruleId, columnId)
  }

  it('getting started: a note or reminder on a record in the Trash, or in a list in the Trash, doesn\'t tick its step (Q-084)', async () => {
    const gs = async () => ((await invoke(IPC.ONBOARDING_GETTING_STARTED)) as any).data
    await invoke(IPC.ONBOARDING_COMPLETE)
    const trashed = seedGrid(testDb.db, { rowCount: 1, columnTypes: ['deadline'] })
    const inTrashedList = seedGrid(testDb.db, { rowCount: 1, columnTypes: ['deadline'] })
    for (const g of [trashed, inTrashedList]) {
      dueDateRule(g.columnIds[0]!)
      testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Called', 'phone')").run(g.rowIds[0])
      testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(g.rowIds[0], g.columnIds[0], localDateString())
    }
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(trashed.rowIds[0])
    testDb.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(inTrashedList.gridId)
    expect(await gs()).toMatchObject({ record: false, reminder: false, note: false })
    testDb.db.prepare('UPDATE grids SET is_active = 1 WHERE id = ?').run(inTrashedList.gridId)
    expect(await gs()).toMatchObject({ record: true, reminder: true, note: true })
  })

  it('getting started: the colour step ticks only once one of your own dates actually shows a colour (UX-A-26)', async () => {
    const gs = async () => ((await invoke(IPC.ONBOARDING_GETTING_STARTED)) as any).data
    await invoke(IPC.ONBOARDING_COMPLETE)
    const { rowIds, columnIds } = seedGrid(testDb.db, { rowCount: 2, columnTypes: ['date'] })
    dueDateRule(columnIds[0]!)
    // Filled in, but due in years: still white
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, '2099-01-01')").run(rowIds[0], columnIds[0])
    expect((await gs()).reminder).toBe(false)
    // A sample entry in a colour doesn't count as the person's own
    testDb.db.prepare("INSERT INTO sample_rows (row_id, grid_id, fingerprint) VALUES (?, 1, '')").run(rowIds[1])
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[1], columnIds[0], localDateString())
    expect((await gs()).reminder).toBe(false)
    // Within the rule's first threshold: yellow, so the step is done
    const soon = new Date(); soon.setDate(soon.getDate() + 10)
    testDb.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run(localDateString(soon), rowIds[0], columnIds[0])
    expect((await gs()).reminder).toBe(true)
  })

  it('inColouredTier follows the rule\'s own first threshold', async () => {
    const { inColouredTier } = await import('../src/main/ipc/ipc-onboarding')
    const long = JSON.stringify([{ daysBefore: 60, bgClass: '#bbf7d0', label: 'Coming up' }, { daysBefore: 0, bgClass: '#dc2626', label: 'Due today' }])
    expect(inColouredTier({ state: 'ok', daysUntil: 45, alert_thresholds: long })).toBe(true)
    expect(inColouredTier({ state: 'ok', daysUntil: 61, alert_thresholds: long })).toBe(false)
    expect(inColouredTier({ state: 'ok', daysUntil: 5, alert_thresholds: null })).toBe(true)
    expect(inColouredTier({ state: 'ok', daysUntil: 8, alert_thresholds: 'not json' })).toBe(false)
    expect(inColouredTier({ state: 'overdue', daysUntil: -3, alert_thresholds: null })).toBe(true)
    expect(inColouredTier({ state: 'done', daysUntil: 0, alert_thresholds: null })).toBe(false)
  })

  it('drops saved progress whose list was deleted', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0 })
    await invoke(IPC.ONBOARDING_SAVE_PROGRESS, { step: 'sheet-rows', gridId, listName: 'X' })
    testDb.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(gridId)
    expect(((await invoke(IPC.ONBOARDING_CHECK)) as any).data).toEqual({ complete: false, progress: null })
  })

  it('creates grid with alert rules', async () => {
    const setup = {
      gridName: 'With Alerts',
      columns: [
        { name: 'Name', type: 'text', isNameCol: true },
        { name: 'Review Date', type: 'date' },
      ],
      alertRules: [{
        columnName: 'Review Date',
        intervalDays: 90,
        thresholds: [
          { daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' },
          { daysBefore: 7, bgClass: 'alert-yellow', label: 'Soon' },
        ],
      }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(true)

    // Verify alert rule was created
    const rules = testDb.db.prepare('SELECT * FROM alert_rules').all() as any[]
    expect(rules.length).toBeGreaterThanOrEqual(1)
    const rule = rules.find((r: any) => r.name === 'Review Date')
    expect(rule).toBeDefined()
    expect(rule.interval_days).toBe(90)

    // Verify column config has alert_rule_id
    const col = testDb.db.prepare("SELECT config FROM columns WHERE name = 'Review Date' AND grid_id = ?").get(result.data.gridId) as any
    const config = JSON.parse(col.config)
    expect(config.alert_rule_id).toBe(rule.id)
  })

  it('rejects empty grid name', async () => {
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, { gridName: '', columns: [] }) as any
    expect(result.ok).toBe(false)
    expect(result.error).toBe("Give the list a name.")
  })

  it('rejects missing grid name', async () => {
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, { gridName: null, columns: [] }) as any
    expect(result.ok).toBe(false)
  })

  it('rejects whitespace-only grid name', async () => {
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, { gridName: '   ', columns: [{ name: 'A', type: 'text' }] }) as any
    expect(result.ok).toBe(false)
    expect(result.error).toBe("Give the list a name.")
  })

  it('truncates grid name to 200 chars', async () => {
    const longName = 'A'.repeat(250)
    const setup = {
      gridName: longName,
      columns: [{ name: 'Col', type: 'text' }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(true)
    const grid = testDb.db.prepare('SELECT name FROM grids WHERE id = ?').get(result.data.gridId) as any
    expect(grid.name.length).toBe(200)
  })

  it('rejects invalid column type', async () => {
    const setup = {
      gridName: 'Test',
      columns: [{ name: 'Col', type: 'invalid_type' }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Invalid column type/i)
  })

  it('rejects empty column name', async () => {
    const setup = {
      gridName: 'Test',
      columns: [{ name: '', type: 'text' }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Column name is required/i)
  })

  it('rejects column name over 200 chars', async () => {
    const setup = {
      gridName: 'Test',
      columns: [{ name: 'X'.repeat(201), type: 'text' }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Column name too long/i)
  })

  it('rejects more than 100 columns', async () => {
    const cols = Array.from({ length: 101 }, (_, i) => ({ name: `Col ${i}`, type: 'text' }))
    const setup = { gridName: 'Test', columns: cols }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/exceeds maximum/i)
  })

  it('sets default dropdown config when none provided', async () => {
    const setup = {
      gridName: 'Test',
      columns: [{ name: 'Status', type: 'dropdown' }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(true)
    const col = testDb.db.prepare("SELECT config FROM columns WHERE name = 'Status'").get() as any
    const config = JSON.parse(col.config)
    expect(config.options).toContain('Active')
  })

  it('uses provided column config', async () => {
    const setup = {
      gridName: 'Test',
      columns: [{ name: 'Status', type: 'dropdown', config: JSON.stringify({ options: ['Open', 'Closed'] }) }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(true)
    const col = testDb.db.prepare("SELECT config FROM columns WHERE name = 'Status'").get() as any
    const config = JSON.parse(col.config)
    expect(config.options).toContain('Open')
  })

  it('skips alert rule when column name does not match', async () => {
    const setup = {
      gridName: 'Test',
      columns: [{ name: 'Name', type: 'text' }],
      alertRules: [{ columnName: 'NonExistent', intervalDays: 30, thresholds: [{ daysBefore: 7, bgClass: 'alert-red', label: 'Overdue' }] }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(true)
    // When column name doesn't match, the handler skips the entire alert rule (if (!colId) continue)
    // The insertAlertRule.run is inside the "if colId found" branch, so no rule is created
    const rules = testDb.db.prepare('SELECT * FROM alert_rules').all() as any[]
    expect(rules.length).toBe(0)
  })

  it('rejects alert rule with negative intervalDays', async () => {
    const setup = {
      gridName: 'Test',
      columns: [{ name: 'Date', type: 'date' }],
      alertRules: [{ columnName: 'Date', intervalDays: -5, thresholds: [] }],
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/intervalDays/i)
  })

  it('rejects more than 50 alert rules', async () => {
    const rules = Array.from({ length: 51 }, (_, i) => ({
      columnName: `Col${i}`,
      intervalDays: 30,
      thresholds: [],
    }))
    const setup = {
      gridName: 'Test',
      columns: [{ name: 'Col', type: 'text' }],
      alertRules: rules,
    }
    const result = await invoke(IPC.ONBOARDING_SETUP_GRID, setup) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Too many alert rules/i)
  })
})

describe('IPC Onboarding — handler registration', () => {
  it('registers all 3 onboarding channels', () => {
    expect(handlers.has(IPC.ONBOARDING_CHECK)).toBe(true)
    expect(handlers.has(IPC.ONBOARDING_COMPLETE)).toBe(true)
    expect(handlers.has(IPC.ONBOARDING_SETUP_GRID)).toBe(true)
  })
})

describe('IPC Onboarding — ONBOARDING_DATE_RULES', () => {
  function gridWithDates() {
    const gridId = Number(testDb.db.prepare("INSERT INTO grids (name, position) VALUES ('Fleet', 0)").run().lastInsertRowid)
    const col = (name: string, type: string) => Number(testDb.db.prepare('INSERT INTO columns (grid_id, name, column_type, position) VALUES (?, ?, ?, 0)').run(gridId, name, type).lastInsertRowid)
    return { gridId, inspection: col('Last inspection', 'date'), registration: col('Registration due', 'date'), oil: col('Last oil change', 'date'), name: col('Truck', 'text') }
  }
  const cfg = (id: number) => JSON.parse((testDb.db.prepare('SELECT config FROM columns WHERE id = ?').get(id) as any).config)
  const ruleName = (id: number) => (testDb.db.prepare('SELECT name FROM alert_rules WHERE id = ?').get(cfg(id).alert_rule_id) as any).name

  it('links standard rules where they match and creates others once', async () => {
    const g = gridWithDates()
    const res = await invoke(IPC.ONBOARDING_DATE_RULES, g.gridId, [
      { columnId: g.inspection, repeat: 'every', n: 1, unit: 'years' },
      { columnId: g.registration, repeat: 'due' },
      { columnId: g.oil, repeat: 'every', n: 4, unit: 'months' },
    ]) as any
    expect(res).toEqual({ ok: true, data: 3 })
    expect(ruleName(g.inspection)).toBe('Every year')
    expect(ruleName(g.registration)).toBe('Due date')
    expect(ruleName(g.oil)).toBe('Every 4 months')
    expect(cfg(g.oil)).toMatchObject({ log_changes: true, alert_rule_name: 'Every 4 months' })

    const again = gridWithDates()
    await invoke(IPC.ONBOARDING_DATE_RULES, again.gridId, [{ columnId: again.oil, repeat: 'every', n: 4, unit: 'months' }])
    expect(testDb.db.prepare("SELECT COUNT(*) AS n FROM alert_rules WHERE name LIKE 'Every 4 months%'").get()).toEqual({ n: 1 })
  })

  it('a Last Contact answer that follows notes turns on "update from notes", with only real note types (persona study R4)', async () => {
    const g = gridWithDates()
    const res = await invoke(IPC.ONBOARDING_DATE_RULES, g.gridId, [
      { columnId: g.oil, repeat: 'every', n: 1, unit: 'months', followsNotes: ['visit', 'phone', 'made_up', 'visit'] },
      { columnId: g.inspection, repeat: 'every', n: 1, unit: 'years' },
    ]) as any
    expect(res).toEqual({ ok: true, data: 2 })
    expect(cfg(g.oil)).toMatchObject({ note_updates: ['visit', 'phone'], log_changes: true })
    expect(cfg(g.inspection).note_updates).toBeUndefined()
    // Not a note type key at all: refused by the schema
    expect(((await invoke(IPC.ONBOARDING_DATE_RULES, g.gridId, [{ columnId: g.oil, repeat: 'due', followsNotes: ['Not A Key!'] }])) as any).ok).toBe(false)
  })

  it("refuses columns that aren't dates in that list, and bad answers", async () => {
    const g = gridWithDates()
    expect(((await invoke(IPC.ONBOARDING_DATE_RULES, g.gridId, [{ columnId: g.name, repeat: 'due' }])) as any).error).toMatch(/isn't in this list/)
    expect(((await invoke(IPC.ONBOARDING_DATE_RULES, g.gridId, [{ columnId: g.oil, repeat: 'every', n: 0, unit: 'days' }])) as any).ok).toBe(false)
    expect(cfg(g.oil)).toEqual({})
  })
})
