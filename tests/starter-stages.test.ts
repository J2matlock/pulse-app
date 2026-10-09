/**
 * Stages in starters and shared files (W06 §8): checklist and date column by name, resolved on apply
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
import { stageConfigOf } from '../src/shared/stages'

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

let dir: string
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'pulse-starter-stages-')) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })
const fileSource = (data: unknown) => {
  const filePath = join(dir, `s-${Math.random().toString(36).slice(2)}.pulse`)
  writeFileSync(filePath, JSON.stringify(data))
  return { filePath }
}

const jobs = {
  pulse_template: '2.0', type: 'workspace', id: 'jobs', name: 'Jobs', description: 'Repair jobs', icon: 'wrench',
  lists: [{
    key: 'jobs', name: 'Jobs', kind: 'job',
    columns: [
      { name: 'Job', column_type: 'text', position: 0, is_name_column: 1 },
      { name: 'Status', column_type: 'status', position: 1, config: JSON.stringify({ options: [{ label: 'Estimate', color: '#3b82f6' }, { label: 'Ready', color: '#22c55e' }], stage: { options: [{ value: 'Ready', onEnter: { checklistTemplateId: 999 } }] } }) },
      { name: 'Ready on', column_type: 'date', position: 2 },
    ],
    checklists: [{ name: 'Pickup', items: JSON.stringify(['Call customer']) }],
    stage: { column: 'Status', hideDoneAfterDays: 7, options: [
      { value: 'Estimate', color: 'blue' },
      { value: 'Ready', done: true, onEnter: { checklist: 'Pickup', stampColumn: 'ready on', activityType: 'note' } },
    ] },
  }],
}
const opts = { lists: ['jobs'], applyWords: false, applyFeatures: false, sampleData: false }
const status = (gridId: number) => testDb.db.prepare("SELECT id, column_type, config FROM columns WHERE grid_id = ? AND name = 'Status'").get(gridId) as { id: number; column_type: string; config: string }
const colId = (gridId: number, name: string) => (testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND name = ?').get(gridId, name) as { id: number }).id
const checklistId = (name: string) => (testDb.db.prepare('SELECT id FROM checklist_templates WHERE name = ?').get(name) as { id: number }).id

describe('stages in starter files', () => {
  it('set up the stage with its checklist and date column found by name (ids in column settings are ignored)', async () => {
    expect(parseStarter(jobs)).toMatchObject({ ok: true })
    const { applyStarter } = await import('../src/main/starters')
    const res = applyStarter(fileSource(jobs), opts)
    expect(res.warnings).toEqual([])
    const gridId = res.gridIds.jobs!
    expect(stageConfigOf(status(gridId))).toEqual({ hideDoneAfterDays: 7, options: [
      { value: 'Estimate', color: 'blue' },
      { value: 'Ready', done: true, onEnter: { checklistTemplateId: checklistId('Pickup'), stampColumnId: colId(gridId, 'Ready on'), activityTypeKey: 'note' } },
    ] })
    expect(JSON.parse(status(gridId).config).log_changes).toBe(true)
  })

  it('warn about what they can\'t find', async () => {
    const { applyStarter } = await import('../src/main/starters')
    const broken = structuredClone(jobs)
    broken.lists[0]!.checklists = []
    broken.lists[0]!.stage.options[1]!.onEnter = { checklist: 'Nope', stampColumn: 'Gone', activityType: 'note' }
    const res = applyStarter(fileSource(broken), opts)
    expect(res.warnings).toEqual([expect.stringMatching(/checklist "Nope"/), expect.stringMatching(/date "Gone"/)])
    expect(stageConfigOf(status(res.gridIds.jobs!))!.options[1]!.onEnter).toEqual({ activityTypeKey: 'note' })
    const mismatch = structuredClone(jobs)
    mismatch.lists[0]!.stage.options.pop()
    const res2 = applyStarter(fileSource(mismatch), opts)
    expect(res2.warnings).toEqual([expect.stringMatching(/has no stage: The stages must be the options of "Status"/)])
  })

  it('round-trip through sharing the workspace and single-list setup files', async () => {
    const { applyStarter, exportWorkspaceStarter } = await import('../src/main/starters')
    const { exportGridAsPulse, applyPulseToNewGrid, validatePulseJson } = await import('../src/main/templates')
    const gridId = applyStarter(fileSource(jobs), opts).gridIds.jobs!
    const shared = exportWorkspaceStarter()
    expect(shared.lists![0]!.stage).toEqual({ column: 'Status', hideDoneAfterDays: 7, options: [
      { value: 'Estimate', color: 'blue' }, { value: 'Ready', done: true, onEnter: { checklist: 'Pickup', stampColumn: 'Ready on', activityType: 'note' } },
    ] })
    expect(JSON.stringify(shared.lists![0]!.columns)).not.toMatch(/stage/)
    const pulse = validatePulseJson(JSON.stringify(exportGridAsPulse(gridId)))

    cleanupTestDb(testDb); testDb = createTestDb()
    const again = applyStarter(fileSource(shared), { ...opts, lists: shared.lists!.map(l => l.key) })
    const g2 = Object.values(again.gridIds)[0]!
    expect(stageConfigOf(status(g2))!.options[1]!.onEnter).toEqual({ checklistTemplateId: checklistId('Pickup'), stampColumnId: colId(g2, 'Ready on'), activityTypeKey: 'note' })

    const g3 = applyPulseToNewGrid(pulse)
    expect(stageConfigOf(status(g3))!.options[1]!.onEnter).toEqual({ checklistTemplateId: checklistId('Pickup'), stampColumnId: colId(g3, 'Ready on'), activityTypeKey: 'note' })
    expect(JSON.parse(status(g3).config).stage_portable).toBeUndefined()
  })
})
