/**
 * IPC Alert Handler Tests — ALERT_RULE_* channels
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture ──────────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-test-alerts',
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
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  clipboard: { writeText: () => {} },
}))

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return {
    default: class {
      get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d }
      set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } }
      has(k: string) { return map.has(k) }
      delete(k: string) { map.delete(k) }
      clear() { map.clear() }
    },
  }
})

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    checkCloudSyncPath: () => null,
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  }
})

vi.mock('../src/main/index', () => ({
  startScheduledBackup: () => {},
  stopScheduledBackup: () => {},
}))

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerAlertHandlers } = await import('../src/main/ipc/ipc-alerts')
  registerAlertHandlers()
})

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ────────────────────────────────────────────────────────────────────

const validThresholds = JSON.stringify([{ daysBefore: 7, color: 'alert-yellow' }])

describe('ALERT_RULE_GET_ALL', () => {
  it('returns empty array when no rules exist', async () => {
    const r = await invoke(IPC.ALERT_RULE_GET_ALL) as any
    expect(r.ok).toBe(true)
    expect(r.data).toEqual([])
  })

  it('returns rules ordered by name', async () => {
    testDb.db.prepare(`INSERT INTO alert_rules (name, thresholds, created_at) VALUES (?, ?, datetime('now'))`).run('Bravo', '[]')
    testDb.db.prepare(`INSERT INTO alert_rules (name, thresholds, created_at) VALUES (?, ?, datetime('now'))`).run('Alpha', '[]')
    const r = await invoke(IPC.ALERT_RULE_GET_ALL) as any
    expect(r.ok).toBe(true)
    expect(r.data[0].name).toBe('Alpha')
    expect(r.data[1].name).toBe('Bravo')
  })
})

describe('ALERT_RULE_CREATE', () => {
  it('creates a rule and returns its ID', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, {
      name: 'Deadline Alert',
      description: 'Test description',
      thresholds: validThresholds,
      interval_days: 30,
    }) as any
    expect(r.ok).toBe(true)
    expect(typeof r.data).toBe('number')
    expect(r.data).toBeGreaterThan(0)
  })

  it('stores a relative rule with its settings, condition and business days (W05)', async () => {
    const config = JSON.stringify({ kind: 'relative', anchorColumnId: 5, offset: { days: 90, direction: 'after' } })
    const condition = JSON.stringify({ columnId: 6, op: 'is', values: ['Active'], whenFalse: 'pause' })
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'Plan due', thresholds: validThresholds, kind: 'relative', rule_config: config, rule_condition: condition, business_days: true }) as any
    expect(r.ok).toBe(true)
    const row = testDb.db.prepare('SELECT kind, rule_config, rule_condition, business_days FROM alert_rules WHERE id = ?').get(r.data) as any
    expect(row.kind).toBe('relative')
    expect(JSON.parse(row.rule_config).offset).toEqual({ days: 90, direction: 'after' })
    expect(JSON.parse(row.rule_condition).values).toEqual(['Active'])
    expect(row.business_days).toBe(1)

    // updating settings is checked against the stored kind
    expect((await invoke(IPC.ALERT_RULE_UPDATE, r.data, { rule_config: '{"kind":"relative"}' }) as any).ok).toBe(false)
    expect((await invoke(IPC.ALERT_RULE_UPDATE, r.data, { kind: 'interval' }) as any).ok).toBe(true)
    expect(testDb.db.prepare('SELECT kind, rule_config FROM alert_rules WHERE id = ?').get(r.data)).toEqual({ kind: 'interval', rule_config: null })
  })

  it('rejects unknown kinds, bad settings and incomplete conditions', async () => {
    expect((await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: validThresholds, kind: 'weekly' }) as any).ok).toBe(false)
    expect((await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: validThresholds, kind: 'relative', rule_config: '{}' }) as any).ok).toBe(false)
    expect((await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: validThresholds, rule_condition: '{"op":"is"}' }) as any).ok).toBe(false)
  })

  it('stores calendar-month intervals and end-of-month', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, {
      name: 'Every 6 months', thresholds: validThresholds, interval_months: 6, end_of_month: true,
    }) as any
    expect(r.ok).toBe(true)
    const row = testDb.db.prepare('SELECT interval_months, end_of_month FROM alert_rules WHERE id = ?').get(r.data) as any
    expect(row).toEqual({ interval_months: 6, end_of_month: 1 })
  })

  it('rejects invalid month intervals', async () => {
    for (const interval_months of [-1, 1.5, 121, 'six']) {
      const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: validThresholds, interval_months }) as any
      expect(r.ok).toBe(false)
    }
  })

  it('creates rule without optional fields', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, {
      name: 'Simple',
      thresholds: validThresholds,
    }) as any
    expect(r.ok).toBe(true)
  })

  it('rejects empty name', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: '', thresholds: validThresholds }) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/name/)
  })

  it('rejects whitespace-only name', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: '   ', thresholds: validThresholds }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects name over 200 chars', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'x'.repeat(201), thresholds: validThresholds }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects invalid JSON thresholds', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: 'not-json{{{' }) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/JSON/)
  })

  it('rejects thresholds over 10000 chars', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: 'x'.repeat(10001) }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string thresholds', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: 123 }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects negative interval_days', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: validThresholds, interval_days: -1 }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-integer interval_days', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'X', thresholds: validThresholds, interval_days: 1.5 }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string name', async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 42, thresholds: validThresholds }) as any
    expect(r.ok).toBe(false)
  })
})

describe('ALERT_RULE_UPDATE', () => {
  let ruleId: number

  beforeEach(async () => {
    const r = await invoke(IPC.ALERT_RULE_CREATE, { name: 'Test', thresholds: validThresholds }) as any
    ruleId = r.data
  })

  it('updates name', async () => {
    const r = await invoke(IPC.ALERT_RULE_UPDATE, ruleId, { name: 'Updated' }) as any
    expect(r.ok).toBe(true)
    const rules = await invoke(IPC.ALERT_RULE_GET_ALL) as any
    expect(rules.data.find((x: any) => x.id === ruleId)?.name).toBe('Updated')
  })

  it('updates thresholds', async () => {
    const newThresholds = JSON.stringify([{ daysBefore: 3, color: 'alert-red' }])
    const r = await invoke(IPC.ALERT_RULE_UPDATE, ruleId, { thresholds: newThresholds }) as any
    expect(r.ok).toBe(true)
  })

  it('updates description', async () => {
    const r = await invoke(IPC.ALERT_RULE_UPDATE, ruleId, { description: 'new desc' }) as any
    expect(r.ok).toBe(true)
  })

  it('rejects invalid id', async () => {
    const r = await invoke(IPC.ALERT_RULE_UPDATE, -1, { name: 'X' }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects empty name', async () => {
    const r = await invoke(IPC.ALERT_RULE_UPDATE, ruleId, { name: '' }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects invalid thresholds JSON', async () => {
    const r = await invoke(IPC.ALERT_RULE_UPDATE, ruleId, { thresholds: '{{invalid' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails with no valid fields', async () => {
    const r = await invoke(IPC.ALERT_RULE_UPDATE, ruleId, { bogus: 'value' }) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/No valid/)
  })
})

describe('ALERT_RULE_DELETE', () => {
  it('deletes a non-system rule', async () => {
    const cr = await invoke(IPC.ALERT_RULE_CREATE, { name: 'Deletable', thresholds: validThresholds }) as any
    const r = await invoke(IPC.ALERT_RULE_DELETE, cr.data) as any
    expect(r.ok).toBe(true)
    const all = await invoke(IPC.ALERT_RULE_GET_ALL) as any
    expect(all.data.find((x: any) => x.id === cr.data)).toBeUndefined()
  })

  it('rejects deleting a system rule', async () => {
    testDb.db.prepare(`INSERT INTO alert_rules (name, is_system, thresholds, created_at) VALUES (?, 1, ?, datetime('now'))`).run('System Rule', '[]')
    const all = await invoke(IPC.ALERT_RULE_GET_ALL) as any
    const sysRule = all.data.find((x: any) => x.is_system === 1)
    const r = await invoke(IPC.ALERT_RULE_DELETE, sysRule.id) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Built-in deadline rules can't be deleted/)
  })

  it('fails for non-existent rule', async () => {
    const r = await invoke(IPC.ALERT_RULE_DELETE, 999999) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not found/)
  })

  it('rejects invalid id', async () => {
    const r = await invoke(IPC.ALERT_RULE_DELETE, 0) as any
    expect(r.ok).toBe(false)
  })

  it('unlinks every column that uses the rule, in one step, and returns what Undo needs (D-05)', async () => {
    const db = testDb.db
    const cr = await invoke(IPC.ALERT_RULE_CREATE, { name: 'Every year', thresholds: validThresholds, interval_months: 12 }) as any
    const g1 = Number(db.prepare("INSERT INTO grids (name, position) VALUES ('A', 1)").run().lastInsertRowid)
    const g2 = Number(db.prepare("INSERT INTO grids (name, position) VALUES ('B', 2)").run().lastInsertRowid)
    const col = (g: number, name: string, cfg: object) => Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, ?, 'date', 0, ?)").run(g, name, JSON.stringify(cfg)).lastInsertRowid)
    const c1 = col(g1, 'Last visit', { alert_rule_id: cr.data, log_changes: true })
    const c2 = col(g2, 'Lease renewal', { alert_rule_id: cr.data, alert_rule_name: 'Every year' })
    const other = col(g2, 'Other', { alert_rule_id: 999 })

    const usage = await invoke(IPC.ALERT_RULE_USAGE) as any
    expect(usage.data.filter((u: any) => u.rule_id === cr.data).map((u: any) => [u.column_name, u.grid_name])).toEqual([['Last visit', 'A'], ['Lease renewal', 'B']])

    const r = await invoke(IPC.ALERT_RULE_DELETE, cr.data) as any
    expect(r.ok).toBe(true)
    expect(r.data.rule.name).toBe('Every year')
    expect(r.data.columnIds.sort()).toEqual([c1, c2].sort())
    const cfg = (id: number) => JSON.parse((db.prepare('SELECT config FROM columns WHERE id = ?').get(id) as { config: string }).config)
    expect(cfg(c1)).toEqual({ log_changes: true })
    expect(cfg(c2)).toEqual({})
    expect(cfg(other)).toEqual({ alert_rule_id: 999 })

    // Undo brings the rule back with its id and relinks the columns
    const back = await invoke(IPC.ALERT_RULE_RESTORE, r.data) as any
    expect(back.ok).toBe(true)
    expect(back.data).toBe(cr.data)
    expect(cfg(c1).alert_rule_id).toBe(cr.data)
    expect(cfg(c2).alert_rule_id).toBe(cr.data)
    const rule = db.prepare('SELECT name, interval_months FROM alert_rules WHERE id = ?').get(cr.data)
    expect(rule).toEqual({ name: 'Every year', interval_months: 12 })
  })

  it('restore leaves a column alone that was given another rule since', async () => {
    const db = testDb.db
    const cr = await invoke(IPC.ALERT_RULE_CREATE, { name: 'R', thresholds: validThresholds }) as any
    const g = Number(db.prepare("INSERT INTO grids (name, position) VALUES ('A', 1)").run().lastInsertRowid)
    const c = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'D', 'date', 0, ?)").run(g, JSON.stringify({ alert_rule_id: cr.data })).lastInsertRowid)
    const r = await invoke(IPC.ALERT_RULE_DELETE, cr.data) as any
    db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: 77 }), c)
    await invoke(IPC.ALERT_RULE_RESTORE, r.data)
    expect(JSON.parse((db.prepare('SELECT config FROM columns WHERE id = ?').get(c) as { config: string }).config).alert_rule_id).toBe(77)
  })

  it('stores "move to the next working day" as business_days 2 (D-18)', async () => {
    const cr = await invoke(IPC.ALERT_RULE_CREATE, { name: 'Court', thresholds: validThresholds, interval_days: 10, business_days: 2 }) as any
    expect((testDb.db.prepare('SELECT business_days FROM alert_rules WHERE id = ?').get(cr.data) as { business_days: number }).business_days).toBe(2)
    await invoke(IPC.ALERT_RULE_UPDATE, cr.data, { business_days: 1 })
    expect((testDb.db.prepare('SELECT business_days FROM alert_rules WHERE id = ?').get(cr.data) as { business_days: number }).business_days).toBe(1)
  })

  it('restore rejects a malformed snapshot', async () => {
    expect((await invoke(IPC.ALERT_RULE_RESTORE, { rule: { id: 0, name: 'x', thresholds: '[]' }, columnIds: [] }) as any).ok).toBe(false)
    expect((await invoke(IPC.ALERT_RULE_RESTORE, { rule: { id: 5, name: 'x', thresholds: '[]' }, columnIds: ['a'] }) as any).ok).toBe(false)
  })
})
