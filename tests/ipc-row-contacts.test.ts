/**
 * 3.19 (R-27): contact info added on the record page is audited, searchable and exported.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── Handler capture map ──────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-row-contacts') },
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
    getRow: (gridId: number, rowId: number) => {
      const cols = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ id: number }>
      if (cols.length === 0) return null
      const query = actual.buildGridQuery(cols.map(c => c.id), true)
      const rows = testDb.db.prepare(query).all(gridId) as Record<string, unknown>[]
      // buildGridQuery aliases r.id as row_id
      return rows.find(r => r.row_id === rowId) ?? null
    },
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
  const { registerRowHandlers } = await import('../src/main/ipc/ipc-row')
  registerRowHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
})

afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ─────────────────────────────────────────────────────────────────────

const guardian = { type: 'phone', label: 'Guardian cell', value: '555-0199' }

describe('contact info added on the record page', () => {
  it('notes additions and removals on the timeline (and so the audit trail)', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowIds[0], [guardian])
    await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowIds[0], [])
    const sys = testDb.db.prepare("SELECT content FROM case_log WHERE row_id = ? AND log_type = 'system' ORDER BY id").all(rowIds[0]) as Array<{ content: string }>
    expect(sys.map(r => r.content)).toEqual(['Contact info added: Guardian cell 555-0199', 'Contact info removed: Guardian cell 555-0199'])
  })

  it('is found by search', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2, columnCount: 1 })
    testDb.db.prepare("UPDATE rows SET display_name = 'Maria' WHERE id = ?").run(rowIds[0])
    testDb.db.prepare("UPDATE rows SET display_name = 'Robert', manual_contacts = 'not json' WHERE id = ?").run(rowIds[1])
    await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowIds[0], [guardian])
    const res = await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, '0199') as any
    expect(res.data.map((r: { clientName: string }) => r.clientName)).toEqual(['Maria'])
    expect((await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, 'Rob') as any).data.map((r: { clientName: string }) => r.clientName)).toEqual(['Robert'])
  })

  it('is exported to CSV as "Other contact info"', async () => {
    const { gridId, rowIds, columnIds } = seedGrid(testDb.db, { rowCount: 2, columnCount: 1 })
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], 'Maria')
    testDb.db.prepare('UPDATE rows SET manual_contacts = ? WHERE id = ?').run(JSON.stringify([guardian]), rowIds[0])
    const { exportCsv } = await import('../src/main/export-csv')
    const dest = join(testDb.tmpDir, 'out.csv')
    await exportCsv({ gridId, columnIds: [], activeRowIds: [], destPath: dest, dateFormat: 'iso' })
    const csv = readFileSync(dest, 'utf-8')
    expect(csv.split(/\r?\n/)[0]).toMatch(/Other contact info$/)
    expect(csv).toContain('Guardian cell: 555-0199')
  })
})
