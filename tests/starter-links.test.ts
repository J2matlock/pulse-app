/**
 * Links in starters and shared workspaces (W04 commit 8): by list key, sample links, export round trip
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

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })


let dir: string
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'pulse-starter-links-')) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })
const fileSource = (data: unknown) => {
  const filePath = join(dir, `s-${Math.random().toString(36).slice(2)}.pulse`)
  writeFileSync(filePath, JSON.stringify(data))
  return { filePath }
}
const shop = {
  pulse_template: '2.0', type: 'workspace', id: 'shop', name: 'Shop', description: 'Customers and vehicles', icon: 'wrench',
  lists: [
    { key: 'customers', name: 'Customers', kind: 'person', columns: [{ name: 'Name', column_type: 'text', position: 0, is_name_column: 1 }] },
    {
      key: 'vehicles', name: 'Vehicles', kind: 'thing',
      columns: [{ name: 'Vehicle', column_type: 'text', position: 0, is_name_column: 1 }, { name: 'Stray link', column_type: 'link', position: 1, config: '{"link_type_id":99}' }],
      links: [{ to: 'customers', label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' }],
    },
  ],
  sampleData: {
    records: { customers: [{ Name: 'Jane Smith' }], vehicles: [{ Vehicle: '2017 Civic' }, { Vehicle: '2019 F-150' }] },
    links: [{ from: 'vehicles#0', to: 'customers#0', link: 'owner' }, { from: 'vehicles#1', to: 'customers#0', link: 'Owner' }],
  },
}
const all = { lists: ['customers', 'vehicles'], applyWords: false, applyFeatures: false, sampleData: true }
const linkCols = () => testDb.db.prepare("SELECT grid_id, name, config FROM columns WHERE column_type = 'link' ORDER BY id").all() as Array<{ grid_id: number; name: string; config: string }>

describe('links in starter files', () => {
  it('must point at lists the file has, with distinct names', () => {
    expect(parseStarter(shop)).toMatchObject({ ok: true })
    const bad = structuredClone(shop)
    bad.lists[1]!.links![0]!.to = 'nowhere'
    expect(parseStarter(bad)).toEqual({ ok: false, error: 'This template file links "Vehicles" to a list it doesn\'t have.' })
    const twice = structuredClone(shop)
    twice.lists[1]!.links!.push({ ...twice.lists[1]!.links![0]!, label_forward: 'OWNER' })
    expect(parseStarter(twice)).toMatchObject({ ok: false, error: expect.stringMatching(/two links with the same name/) })
  })

  it('apply as link types with columns on both lists, plus sample links', async () => {
    const { applyStarter } = await import('../src/main/starters')
    const res = applyStarter(fileSource(shop), all)
    expect(res.warnings).toEqual([])
    const cols = linkCols()
    expect(cols.map(c => [c.grid_id, c.name, JSON.parse(c.config).direction])).toEqual([
      [res.gridIds.vehicles, 'Owner', 'forward'], [res.gridIds.customers, 'Vehicles', 'backward'],
    ])
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM record_links').get()).toEqual({ n: 2 })
  })

  it('skip a link whose other list was not chosen', async () => {
    const { applyStarter } = await import('../src/main/starters')
    const res = applyStarter(fileSource(shop), { ...all, lists: ['vehicles'], sampleData: false })
    expect(res.warnings).toEqual([expect.stringMatching(/"Owner" wasn't added because its other list wasn't chosen/)])
    expect(linkCols()).toEqual([])
  })

  it('round-trip through sharing the workspace; single-list setup files leave links out', async () => {
    const { applyStarter, exportWorkspaceStarter } = await import('../src/main/starters')
    const { exportGridAsPulse } = await import('../src/main/templates')
    const first = applyStarter(fileSource(shop), { ...all, sampleData: false })
    const shared = exportWorkspaceStarter()
    const vehiclesList = shared.lists!.find(l => l.name === 'Vehicles')!
    expect(vehiclesList.links).toEqual([{ to: 'customers', label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' }])
    expect(vehiclesList.columns.some(c => c.column_type === 'link')).toBe(false)
    expect(exportGridAsPulse(first.gridIds.vehicles!).columns.some(c => c.column_type === 'link')).toBe(false)

    cleanupTestDb(testDb); testDb = createTestDb()
    const again = applyStarter(fileSource(shared), { ...all, sampleData: false, lists: shared.lists!.map(l => l.key) })
    expect(again.warnings).toEqual([])
    expect(linkCols()).toHaveLength(2)
  })
})
