/**
 * Display name formats in main: names follow the list's format through cell
 * edits, column renames and deletes, moves, duplicates, imports and exports
 * (plans/generalization/W02-list-kinds.md §3).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(tmpdir(), 'pulse-test-display-names'), getName: () => 'Pulse Test', getVersion: () => '0.0.0-test', commandLine: { appendSwitch: () => {} }, on: () => {} },
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

import { getClientName, batchGetClientNames } from '../src/main/export-shared'
import { parseImportFile, executeImport } from '../src/main/import'

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
let rowIds: number[]
let col: Record<'name' | 'year' | 'make' | 'model' | 'plate', number>

const nameOf = (rowId: number) => (testDb.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(rowId) as { display_name: string | null }).display_name

beforeEach(async () => {
  testDb = createTestDb()
  const seed = seedGrid(testDb.db, { name: 'Vehicles', columnCount: 5, rowCount: 2 })
  gridId = seed.gridId
  rowIds = seed.rowIds
  const names = ['Nickname', 'Year', 'Make', 'Model', 'Plate']
  seed.columnIds.forEach((id, i) => testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run(names[i], id))
  const [name, year, make, model, plate] = seed.columnIds as [number, number, number, number, number]
  col = { name, year, make, model, plate }
  const values: Array<[number, number, string]> = [
    [rowIds[0]!, name, 'Old blue'], [rowIds[0]!, year, '2017'], [rowIds[0]!, make, 'Honda'], [rowIds[0]!, model, 'Civic'], [rowIds[0]!, plate, 'ABC123'],
    [rowIds[1]!, name, 'Van'], [rowIds[1]!, make, 'Ford'],
  ]
  for (const [r, c, v] of values) await invoke(IPC.CELL_UPDATE, r, c, v)
})
afterEach(() => cleanupTestDb(testDb))

const setFormat = (format: string | null) => invoke(IPC.GRID_SETTINGS_UPDATE, gridId, { display_format: format })

describe('display name formats', () => {
  it('without a format, names come from the name column as before', () => {
    expect(nameOf(rowIds[0]!)).toBe('Old blue')
  })

  it('setting a format renames every row; clearing it goes back', async () => {
    expect((await setFormat('{Year} {Make} {Model} – {Plate}')).ok).toBe(true)
    expect(nameOf(rowIds[0]!)).toBe('2017 Honda Civic – ABC123')
    expect(nameOf(rowIds[1]!)).toBe('Ford')
    await setFormat('')
    expect(nameOf(rowIds[0]!)).toBe('Old blue')
    expect((testDb.db.prepare('SELECT display_format FROM grids WHERE id = ?').get(gridId) as { display_format: string | null }).display_format).toBeNull()
  })

  it('rejects formats that are too long', async () => {
    expect((await setFormat(`{Make}${'x'.repeat(300)}`)).ok).toBe(false)
  })

  it('follows edits to the columns it names, and to the name column', async () => {
    await setFormat('{Make} {Model}')
    await invoke(IPC.CELL_UPDATE, rowIds[1]!, col.model, 'Transit')
    expect(nameOf(rowIds[1]!)).toBe('Ford Transit')
    // the name-column trigger fires on this edit; the format must still win
    await invoke(IPC.CELL_UPDATE, rowIds[1]!, col.name, 'Big van')
    expect(nameOf(rowIds[1]!)).toBe('Ford Transit')
  })

  it('falls back to the name column when every token is empty', async () => {
    await setFormat('{Year} {Plate}')
    expect(nameOf(rowIds[1]!)).toBe('Van')
  })

  it('keeps names when a named column is renamed, and the format follows the rename', async () => {
    await setFormat('{Make} – {Plate}')
    expect((await invoke(IPC.COLUMN_UPDATE, col.plate, { name: 'License plate' })).ok).toBe(true)
    expect(nameOf(rowIds[0]!)).toBe('Honda – ABC123')
    const format = (testDb.db.prepare('SELECT display_format FROM grids WHERE id = ?').get(gridId) as { display_format: string }).display_format
    expect(format).toBe('{Make} – {License plate}')
  })

  it('drops a deleted column from names', async () => {
    await setFormat('{Make} – {Plate}')
    expect((await invoke(IPC.COLUMN_DELETE, col.plate)).ok).toBe(true)
    expect(nameOf(rowIds[0]!)).toBe('Honda')
  })

  it('names duplicates the same way', async () => {
    await setFormat('{Make} {Model}')
    const dup = await invoke(IPC.ROW_DUPLICATE, rowIds[0]!)
    expect(nameOf(dup.data as number)).toBe('Honda Civic')
  })

  it('a row moved to a list without a format gets that list\'s kind of name', async () => {
    await setFormat('{Make} {Model}')
    const other = seedGrid(testDb.db, { name: 'Other', columnCount: 1, rowCount: 0 })
    testDb.db.prepare("UPDATE columns SET name = 'Nickname' WHERE id = ?").run(other.columnIds[0])
    expect((await invoke(IPC.ROW_MOVE_TO_GRID, rowIds[0]!, other.gridId)).ok).toBe(true)
    expect(nameOf(rowIds[0]!)).toBe('Old blue')
  })

  it('a row copied into a list with a format is named by it', async () => {
    const other = seedGrid(testDb.db, { name: 'Fleet', columnCount: 2, rowCount: 0 })
    testDb.db.prepare("UPDATE columns SET name = 'Nickname' WHERE id = ?").run(other.columnIds[0])
    testDb.db.prepare("UPDATE columns SET name = 'Make' WHERE id = ?").run(other.columnIds[1])
    await invoke(IPC.GRID_SETTINGS_UPDATE, other.gridId, { display_format: '{Make} ({Nickname})' })
    const copy = await invoke(IPC.ROW_COPY_TO_GRID, rowIds[0]!, other.gridId)
    expect(nameOf(copy.data as number)).toBe('Honda (Old blue)')
  })

  it('imported rows are named by the format', async () => {
    await setFormat('{Make} {Model}')
    const file = join(testDb.tmpDir, 'cars.csv')
    writeFileSync(file, 'Nickname,Make,Model\nRed,Toyota,Corolla\n')
    const preview = await parseImportFile(file)
    const result = await executeImport({
      gridId, filePath: file, duplicateStrategy: 'none', cleanData: true,
      columnMappings: [{ sourceIndex: 0, action: col.name }, { sourceIndex: 1, action: col.make }, { sourceIndex: 2, action: col.model }],
    }, preview)
    expect(result.imported).toBe(1)
    const names = (testDb.db.prepare('SELECT display_name FROM rows WHERE grid_id = ?').all(gridId) as Array<{ display_name: string }>).map(r => r.display_name)
    expect(names).toContain('Toyota Corolla')
  })

  it('exports use the formatted name', async () => {
    await setFormat('{Year} {Make} {Model}')
    expect(getClientName(testDb.db, rowIds[0]!, gridId)).toBe('2017 Honda Civic')
    expect(batchGetClientNames(testDb.db, rowIds, gridId).get(rowIds[0]!)).toBe('2017 Honda Civic')
  })
})
