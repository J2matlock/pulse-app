/**
 * Deadline rule kinds in starters and .pulse files (W05 commit 12): settings name columns, resolved on apply
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
import { parseStarter } from '../src/shared/starters/schema'
import { portableRuleFields, resolveRuleFields, refersToColumns } from '../src/main/rule-columns'

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

let dir: string
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'pulse-rule-kinds-')) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })
const fileSource = (data: unknown) => {
  const filePath = join(dir, `s-${Math.random().toString(36).slice(2)}.pulse`)
  writeFileSync(filePath, JSON.stringify(data))
  return { filePath }
}

const thresholds = JSON.stringify([{ daysBefore: 0, bgClass: '#dc2626', label: 'Due' }])
const ref = (column: string) => ({ column })
const intake = {
  pulse_template: '2.0', type: 'workspace', id: 'intake', name: 'Intake', description: 'Referrals', icon: 'inbox',
  lists: [{
    key: 'referrals', name: 'Referrals', kind: 'person',
    columns: [
      { name: 'Name', column_type: 'text', position: 0, is_name_column: 1 },
      { name: 'Referral date', column_type: 'date', position: 1 },
      { name: 'Plan written', column_type: 'date', position: 2, config: JSON.stringify({ alert_rule_name: 'Plan due' }) },
      { name: 'Status', column_type: 'status', position: 3 },
      { name: 'Taxes', column_type: 'deadline', position: 4, config: JSON.stringify({ alert_rule_name: 'Quarterly' }) },
    ],
    alertRules: [
      { name: 'Plan due', thresholds, kind: 'relative', business_days: 1,
        rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: ref('Referral date'), offset: { days: 45, direction: 'after' } }),
        rule_condition: JSON.stringify({ columnId: ref('status'), op: 'is', values: ['Active'], whenFalse: 'pause' }) },
      { name: 'Quarterly', thresholds, kind: 'calendar', rule_config: JSON.stringify({ kind: 'calendar', months: [1, 4, 6, 9], day: 15 }) },
    ],
  }],
}
const opts = { lists: ['referrals'], applyWords: false, applyFeatures: false, sampleData: false }
const col = (gridId: number, name: string) => (testDb.db.prepare('SELECT id, config FROM columns WHERE grid_id = ? AND name = ?').get(gridId, name) as { id: number; config: string })
const rule = (id: number) => testDb.db.prepare('SELECT name, kind, rule_config, rule_condition, business_days FROM alert_rules WHERE id = ?').get(id) as
  { name: string; kind: string; rule_config: string | null; rule_condition: string | null; business_days: number }

describe('column references by name', () => {
  it('swap ids for names and back', () => {
    const names: Record<number, string> = { 4: 'Referral date', 6: 'Status' }
    const portable = portableRuleFields({ kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 4, offset: { days: 45, direction: 'after' } }),
      rule_condition: JSON.stringify({ columnId: 6, op: 'empty', whenFalse: 'hide' }), business_days: 0 }, id => names[id])
    expect(JSON.parse(portable.rule_config!).anchorColumnId).toEqual(ref('Referral date'))
    expect(JSON.parse(portable.rule_condition!).columnId).toEqual(ref('Status'))
    expect(portable.business_days).toBeUndefined()
    expect(refersToColumns(portable)).toBe(true)
    const back = resolveRuleFields({ name: 'x', thresholds, ...portable }, n => ({ 'Referral date': 40, Status: 60 })[n])
    expect(back).toEqual({ missing: [], fields: { kind: 'relative', business_days: 0,
      rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 40, offset: { days: 45, direction: 'after' } }),
      rule_condition: JSON.stringify({ columnId: 60, op: 'empty', whenFalse: 'hide' }) } })
  })

  it('plain date rules gain nothing, so older versions can still read the file', () => {
    expect(portableRuleFields({ kind: 'interval', rule_config: null, rule_condition: null, business_days: 0 }, () => undefined)).toEqual({})
  })

  it('fall back to a plain rule when a column is missing or the settings are not valid', () => {
    expect(resolveRuleFields({ name: 'x', thresholds, kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: ref('Gone'), offset: { direction: 'after' } }) }, () => undefined))
      .toEqual({ missing: ['Gone'], fields: { kind: 'interval', rule_config: null, rule_condition: null, business_days: 0 } })
    expect(resolveRuleFields({ name: 'x', thresholds, kind: 'calendar', rule_config: JSON.stringify({ kind: 'calendar', months: [13], day: 1 }) }, () => undefined).fields.kind).toBe('interval')
  })
})

describe('starters with rule kinds', () => {
  it('validate, apply with the new list\'s columns, and link the columns', async () => {
    expect(parseStarter(intake)).toMatchObject({ ok: true })
    const { applyStarter } = await import('../src/main/starters')
    const res = applyStarter(fileSource(intake), opts)
    expect(res.warnings).toEqual([])
    const gridId = res.gridIds.referrals!
    const plan = JSON.parse(col(gridId, 'Plan written').config) as { alert_rule_id: number; alert_rule_name: string }
    const r = rule(plan.alert_rule_id)
    expect(r).toMatchObject({ name: 'Plan due', kind: 'relative', business_days: 1 })
    expect(JSON.parse(r.rule_config!).anchorColumnId).toBe(col(gridId, 'Referral date').id)
    expect(JSON.parse(r.rule_condition!).columnId).toBe(col(gridId, 'Status').id)
    const taxes = JSON.parse(col(gridId, 'Taxes').config) as { alert_rule_id: number }
    expect(rule(taxes.alert_rule_id)).toMatchObject({ name: 'Quarterly', kind: 'calendar' })

    // A second copy points at its own columns, so it's a separate rule
    const again = applyStarter(fileSource(intake), opts)
    const plan2 = JSON.parse(col(again.gridIds.referrals!, 'Plan written').config) as { alert_rule_id: number; alert_rule_name: string }
    expect(plan2.alert_rule_name).toBe('Plan due 2')
    expect(JSON.parse(rule(plan2.alert_rule_id).rule_config!).anchorColumnId).toBe(col(again.gridIds.referrals!, 'Referral date').id)
  })

  it('warn and keep a plain rule when the list lacks a column', async () => {
    const { applyStarter } = await import('../src/main/starters')
    const broken = structuredClone(intake)
    broken.lists[0]!.columns = broken.lists[0]!.columns.filter(c => c.name !== 'Referral date')
    const res = applyStarter(fileSource(broken), opts)
    expect(res.warnings).toEqual([expect.stringMatching(/"Plan due" uses columns Referrals doesn't have \(Referral date\)/)])
    const plan = JSON.parse(col(res.gridIds.referrals!, 'Plan written').config) as { alert_rule_id: number }
    expect(rule(plan.alert_rule_id)).toMatchObject({ kind: 'interval', rule_config: null })
  })

  it('survive sharing the workspace and opening it elsewhere', async () => {
    const { applyStarter, exportWorkspaceStarter } = await import('../src/main/starters')
    applyStarter(fileSource(intake), opts)
    const shared = exportWorkspaceStarter()
    const planRule = shared.lists![0]!.alertRules!.find(r => r.name === 'Plan due')!
    expect(JSON.parse(planRule.rule_config!).anchorColumnId).toEqual(ref('Referral date'))
    expect(JSON.stringify(shared)).not.toMatch(/"anchorColumnId":\d/)

    cleanupTestDb(testDb); testDb = createTestDb()
    const res = applyStarter(fileSource(shared), { ...opts, lists: shared.lists!.map(l => l.key) })
    const gridId = Object.values(res.gridIds)[0]!
    const plan = JSON.parse(col(gridId, 'Plan written').config) as { alert_rule_id: number }
    expect(JSON.parse(rule(plan.alert_rule_id).rule_config!).anchorColumnId).toBe(col(gridId, 'Referral date').id)
  })
})

describe('.pulse setup files with rule kinds', () => {
  it('export by name and apply to a new list', async () => {
    const { applyStarter } = await import('../src/main/starters')
    const { exportGridAsPulse, applyPulseToNewGrid, validatePulseJson } = await import('../src/main/templates')
    const gridId = applyStarter(fileSource(intake), opts).gridIds.referrals!
    const pulse = validatePulseJson(JSON.stringify(exportGridAsPulse(gridId)))
    expect(JSON.parse(pulse.alert_rules.find(r => r.name === 'Plan due')!.rule_condition!).columnId).toEqual(ref('Status'))
    const copy = applyPulseToNewGrid(pulse)
    const plan = JSON.parse(col(copy, 'Plan written').config) as { alert_rule_id: number }
    const r = rule(plan.alert_rule_id)
    expect(r.kind).toBe('relative')
    expect(JSON.parse(r.rule_config!).anchorColumnId).toBe(col(copy, 'Referral date').id)
  })
})
