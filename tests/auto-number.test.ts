/**
 * Auto-number columns: numbers handed out in main on create, duplicate, copy,
 * move and import, never typed or reused (plans/generalization/W02-list-kinds.md §4).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(tmpdir(), 'pulse-test-auto-number'), getName: () => 'Pulse Test', getVersion: () => '0.0.0-test', commandLine: { appendSwitch: () => {} }, on: () => {} },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }, on: () => {} },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }), showMessageBoxSync: () => 0 },
  shell: { openPath: async () => '', openExternal: async () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))
vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))
vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return { default: class { get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d } set(k: string, v?: unknown) { map.set(k, v) } has(k: string) { return map.has(k) } delete(k: string) { map.delete(k) } clear() { map.clear() } } }
})

let testDb: TestDb
// The real module loads only after everything has bound to this mock
// (database.ts imports contacts.ts; loading it first binds that to the real connection)
type DbModule = typeof import('../src/main/database')
let realDb: DbModule
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  invalidateGridStmtCache: () => {},
  registerCloseHook: () => {},
  buildGridQuery: (...a: Parameters<DbModule['buildGridQuery']>) => realDb.buildGridQuery(...a),
  getRow: () => null,
  upsertCell: (rowId: number, columnId: number, value: string | null) => {
    testDb.db.prepare(`INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(rowId, columnId, value)
  },
}))

import { parseImportFile, executeImport } from '../src/main/import'
import { assignAutoNumbers, freshAutoNumberConfig } from '../src/main/auto-number'
import { parseAutoNumberConfig, formatAutoNumber, autoNumberValue } from '../src/shared/autoNumber'

const fakeEvent = { senderFrame: { parent: null } }
async function invoke(channel: string, ...args: unknown[]): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args) as { ok: boolean; data?: unknown; error?: string }
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerCellHandlers } = await import('../src/main/ipc/ipc-cell')
  const { registerRowHandlers } = await import('../src/main/ipc/ipc-row')
  const { registerGridHandlers } = await import('../src/main/ipc/ipc-grid')
  const { registerWorkspaceHandlers } = await import('../src/main/ipc/ipc-workspace')
  registerCellHandlers(); registerRowHandlers(); registerGridHandlers(); registerWorkspaceHandlers()
  realDb = await vi.importActual<DbModule>('../src/main/database')
})

let gridId: number
let titleCol: number
let numCol: number

const cell = (rowId: number, columnId = numCol) =>
  (testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as { value: string } | undefined)?.value ?? null
const config = (columnId = numCol) => parseAutoNumberConfig((testDb.db.prepare('SELECT config FROM columns WHERE id = ?').get(columnId) as { config: string }).config)

async function addAutoColumn(targetGrid: number, prefix = 'J-', pad = 4): Promise<number> {
  const id = Number((await invoke(IPC.COLUMN_CREATE, targetGrid, 'Number', 'auto_number')).data)
  await invoke(IPC.COLUMN_UPDATE, id, { config: JSON.stringify({ prefix, pad, next: 1 }) })
  return id
}
const createRow = async (g = gridId) => Number((await invoke(IPC.ROW_CREATE, g)).data)

beforeEach(async () => {
  testDb = createTestDb()
  const seed = seedGrid(testDb.db, { name: 'Jobs', columnCount: 1, rowCount: 0 })
  gridId = seed.gridId
  titleCol = seed.columnIds[0]!
  testDb.db.prepare("UPDATE columns SET name = 'Title' WHERE id = ?").run(titleCol)
  numCol = await addAutoColumn(gridId)
})
afterEach(() => cleanupTestDb(testDb))

describe('auto-number config', () => {
  it('formats with prefix and padding, and reads the number back', () => {
    expect(formatAutoNumber({ prefix: 'J-', pad: 4 }, 7)).toBe('J-0007')
    expect(formatAutoNumber({ prefix: '', pad: 0 }, 12345)).toBe('12345')
    expect(autoNumberValue('J-0042')).toBe(42)
    expect(autoNumberValue('WO-12-B')).toBe(12)
    expect(autoNumberValue('none')).toBeNull()
  })

  it('falls back to safe values for odd configs', () => {
    expect(parseAutoNumberConfig('not json')).toEqual({ prefix: '', pad: 4, next: 1 })
    expect(parseAutoNumberConfig({ prefix: 'X'.repeat(50), pad: 99, next: -3 })).toEqual({ prefix: 'X'.repeat(20), pad: 10, next: 1 })
  })

  it('a column copied into a new list starts again at 1', () => {
    expect(JSON.parse(freshAutoNumberConfig(JSON.stringify({ prefix: 'J-', pad: 3, next: 88 })))).toEqual({ prefix: 'J-', pad: 3, next: 1 })
  })
})

describe('auto-number columns', () => {
  it('a new column starts at 1 with default padding', async () => {
    const id = Number((await invoke(IPC.COLUMN_CREATE, gridId, 'Ref', 'auto_number')).data)
    expect(config(id)).toEqual({ prefix: '', pad: 4, next: 1 })
  })

  it('new records get the next number in turn', async () => {
    const a = await createRow()
    const b = await createRow()
    expect([cell(a), cell(b)]).toEqual(['J-0001', 'J-0002'])
    expect(config().next).toBe(3)
  })

  it('many records numbered in one transaction get different numbers', () => {
    const ids = Array.from({ length: 20 }, (_, i) => Number(testDb.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(gridId, i).lastInsertRowid))
    testDb.db.transaction(() => assignAutoNumbers(gridId, ids))()
    const values = ids.map(id => cell(id))
    expect(new Set(values).size).toBe(20)
    expect(values[19]).toBe('J-0020')
  })

  it('can\'t be typed into', async () => {
    const a = await createRow()
    const res = await invoke(IPC.CELL_UPDATE, a, numCol, 'J-9999')
    expect(res.ok).toBe(false)
    expect(cell(a)).toBe('J-0001')
  })

  it('an existing column can\'t be turned into one', async () => {
    const res = await invoke(IPC.COLUMN_UPDATE, titleCol, { column_type: 'auto_number' })
    expect(res.ok).toBe(false)
  })

  it('a duplicate gets a new number and the original keeps its own', async () => {
    const a = await createRow()
    const dup = Number((await invoke(IPC.ROW_DUPLICATE, a)).data)
    expect(cell(a)).toBe('J-0001')
    expect(cell(dup)).toBe('J-0002')
  })

  it('trash and restore keep the number; numbers of removed records are not reused', async () => {
    const a = await createRow()
    const b = await createRow()
    await invoke(IPC.ROW_DELETE, a)
    await invoke(IPC.ROW_RESTORE_DELETED, a)
    expect(cell(a)).toBe('J-0001')
    await invoke(IPC.ROW_HARD_DELETE, b)
    expect(cell(await createRow())).toBe('J-0003')
  })

  it('numbers records already in the list, in list order, skipping the trash', async () => {
    const other = seedGrid(testDb.db, { name: 'Old jobs', columnCount: 1, rowCount: 3 })
    testDb.db.prepare('UPDATE rows SET position = 10 - position WHERE grid_id = ?').run(other.gridId) // reverse order
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(other.rowIds[1])
    const col = await addAutoColumn(other.gridId, '', 3)
    const res = await invoke(IPC.COLUMN_NUMBER_EXISTING, col)
    expect(res.data).toEqual({ numbered: 2 })
    expect(cell(other.rowIds[2]!, col)).toBe('001')
    expect(cell(other.rowIds[0]!, col)).toBe('002')
    expect(cell(other.rowIds[1]!, col)).toBeNull()
    expect(config(col).next).toBe(3)
  })

  it('a record copied or moved into the list gets the list\'s next number', async () => {
    const other = seedGrid(testDb.db, { name: 'Inbox', columnCount: 1, rowCount: 0 })
    testDb.db.prepare("UPDATE columns SET name = 'Title' WHERE id = ?").run(other.columnIds[0])
    const otherNum = await addAutoColumn(other.gridId, 'IN-', 2)
    const x = await createRow(other.gridId)
    await createRow() // J-0001 in Jobs
    const copy = Number((await invoke(IPC.ROW_COPY_TO_GRID, x, gridId)).data)
    expect(cell(copy)).toBe('J-0002')
    expect(cell(x, otherNum)).toBe('IN-01')
    await invoke(IPC.ROW_MOVE_TO_GRID, x, gridId)
    expect(cell(x)).toBe('J-0003')
  })

  it('a record moved away and back keeps its number in each list (L-11)', async () => {
    const other = seedGrid(testDb.db, { name: 'Inbox', columnCount: 1, rowCount: 0 })
    testDb.db.prepare("UPDATE columns SET name = 'Title' WHERE id = ?").run(other.columnIds[0])
    const otherNum = await addAutoColumn(other.gridId, 'IN-', 2)
    const x = await createRow()
    expect(cell(x)).toBe('J-0001')
    await invoke(IPC.ROW_MOVE_TO_GRID, x, other.gridId)
    expect(cell(x, otherNum)).toBe('IN-01')
    await invoke(IPC.ROW_MOVE_TO_GRID, x, gridId)
    expect(cell(x)).toBe('J-0001')
    await invoke(IPC.ROW_MOVE_TO_GRID, x, other.gridId)
    expect(cell(x, otherNum)).toBe('IN-01')
  })

  it('import keeps numbers it brings in and carries on after the highest', async () => {
    const file = join(testDb.tmpDir, 'jobs.csv')
    writeFileSync(file, 'Title,Number\nFix sink,J-0040\nPaint door,\n')
    const preview = await parseImportFile(file)
    await executeImport({
      gridId, filePath: file, duplicateStrategy: 'none', cleanData: true,
      columnMappings: [{ sourceIndex: 0, action: titleCol }, { sourceIndex: 1, action: numCol }],
    }, preview)
    const values = (testDb.db.prepare('SELECT value FROM cells WHERE column_id = ? ORDER BY row_id').all(numCol) as Array<{ value: string }>).map(r => r.value)
    expect(values).toEqual(['J-0040', 'J-0041'])
    expect(cell(await createRow())).toBe('J-0042')
  })

  it('import numbers every row when nothing is mapped to the column', async () => {
    const file = join(testDb.tmpDir, 'jobs2.csv')
    writeFileSync(file, 'Title\nA\nB\n')
    const preview = await parseImportFile(file)
    await executeImport({ gridId, filePath: file, duplicateStrategy: 'none', cleanData: true, columnMappings: [{ sourceIndex: 0, action: titleCol }] }, preview)
    const values = (testDb.db.prepare('SELECT value FROM cells WHERE column_id = ? ORDER BY row_id').all(numCol) as Array<{ value: string }>).map(r => r.value)
    expect(values).toEqual(['J-0001', 'J-0002'])
  })

  it('can be part of the display name', async () => {
    await invoke(IPC.GRID_SETTINGS_UPDATE, gridId, { display_format: '{Number} {Title}' })
    const a = await createRow()
    expect((testDb.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(a) as { display_name: string }).display_name).toBe('J-0001')
    await invoke(IPC.CELL_UPDATE, a, titleCol, 'Fix sink')
    expect((testDb.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(a) as { display_name: string }).display_name).toBe('J-0001 Fix sink')
  })
})
