/**
 * Your own numbers on notes (plans/generalization/W03-activity.md §3):
 * definitions, value rules, and the note handlers carrying them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(tmpdir(), 'pulse-test-measures'), getName: () => 'Pulse Test', getVersion: () => '0.0.0-test', commandLine: { appendSwitch: () => {} }, on: () => {} },
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
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  registerCloseHook: () => {},
  invalidateGridStmtCache: () => {},
  upsertCell: () => {},
  getRow: () => null,
  buildGridQuery: () => '',
}))

import { parseMeasures, parseExtraMeasures, cleanMeasureValue, formatMeasure, type MeasureDef } from '../src/shared/measures'
import { cleanExtraMeasures, listMeasures } from '../src/main/measures'

const fakeEvent = { senderFrame: { parent: null } }
async function invoke(channel: string, ...args: unknown[]): Promise<{ ok: boolean; data?: any; error?: string }> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args) as { ok: boolean; data?: any; error?: string }
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerMeasureHandlers } = await import('../src/main/ipc/ipc-measures')
  const { registerCaseLogHandlers } = await import('../src/main/ipc/ipc-caselog')
  registerMeasureHandlers(); registerCaseLogHandlers()
})

let rowId: number
beforeEach(() => {
  testDb = createTestDb()
  rowId = seedGrid(testDb.db, { rowCount: 1 }).rowIds[0]!
})
afterEach(() => cleanupTestDb(testDb))

const labor: MeasureDef = { key: 'labor', label: 'Labor', kind: 'hours', decimals: 2 }
const parts: MeasureDef = { key: 'parts', label: 'Parts', kind: 'currency', decimals: 2 }
const boxes: MeasureDef = { key: 'boxes', label: 'Boxes', unit: 'boxes', kind: 'number', decimals: 0 }

describe('value rules', () => {
  it('rounds and limits by kind', () => {
    expect(cleanMeasureValue(labor, 1.234)).toBe(1.23)
    expect(cleanMeasureValue(labor, 25)).toMatch(/24 hours/)
    expect(cleanMeasureValue(parts, 84.199)).toBe(84.2)
    expect(cleanMeasureValue(boxes, 2.6)).toBe(3)
    expect(cleanMeasureValue(boxes, -1)).toMatch(/0 or more/)
    expect(cleanMeasureValue(boxes, 'x')).toMatch(/number/)
    expect(cleanMeasureValue(parts, 2e7)).toMatch(/too large/)
    expect(cleanMeasureValue(parts, 1.005)).toBe(1.01)
    expect(cleanMeasureValue(parts, 1e-7)).toBe(0)
  })

  it('formats for badges', () => {
    expect(formatMeasure(labor, 1.5)).toBe('Labor 1.5 h')
    expect(formatMeasure(parts, 84.2)).toBe('Parts $84.20')
    expect(formatMeasure(boxes, 3)).toBe('Boxes 3 boxes')
  })

  it('drops malformed saved data', () => {
    expect(parseMeasures('[{"key":"labor","label":"Labor","kind":"hours","decimals":2},{"key":"BAD KEY"}]')).toHaveLength(1)
    expect(parseMeasures('nope')).toEqual([])
    expect(parseExtraMeasures('{"labor":1.5,"x":"no"}')).toEqual({ labor: 1.5 })
  })
})

describe('MEASURE_SAVE / MEASURE_ARCHIVE', () => {
  it('adds numbers with keys made once, never clashing with minutes or miles', async () => {
    const res = await invoke(IPC.MEASURE_SAVE, { label: 'Labor', kind: 'hours' })
    expect(res.data.measures).toEqual([{ key: 'labor', label: 'Labor', kind: 'hours', decimals: 2 }])
    await invoke(IPC.MEASURE_SAVE, { label: 'Miles', kind: 'number', unit: 'km', decimals: 1 })
    expect(listMeasures()[1]).toMatchObject({ key: 'miles_2', unit: 'km', decimals: 1 })
    await invoke(IPC.MEASURE_SAVE, { key: 'labor', label: 'Labor hours', kind: 'hours' })
    expect(listMeasures()[0]).toMatchObject({ key: 'labor', label: 'Labor hours' })
  })

  it('turns away blank names, unknown kinds, duplicates and an eleventh number', async () => {
    expect((await invoke(IPC.MEASURE_SAVE, { label: ' ', kind: 'hours' })).ok).toBe(false)
    expect((await invoke(IPC.MEASURE_SAVE, { label: 'X', kind: 'weight' })).ok).toBe(false)
    await invoke(IPC.MEASURE_SAVE, { label: 'Labor', kind: 'hours' })
    expect((await invoke(IPC.MEASURE_SAVE, { label: 'labor', kind: 'number' })).error).toMatch(/already/)
    for (let i = 2; i <= 10; i++) await invoke(IPC.MEASURE_SAVE, { label: `N${i}`, kind: 'number' })
    expect((await invoke(IPC.MEASURE_SAVE, { label: 'Eleven', kind: 'number' })).error).toMatch(/up to 10/)
    await invoke(IPC.MEASURE_ARCHIVE, 'n2', true)
    expect((await invoke(IPC.MEASURE_SAVE, { label: 'Eleven', kind: 'number' })).ok).toBe(true)
    expect((await invoke(IPC.MEASURE_ARCHIVE, 'n2', false)).error).toMatch(/up to 10/)
  })
})

describe('numbers on notes', () => {
  beforeEach(async () => {
    await invoke(IPC.MEASURE_SAVE, { label: 'Labor', kind: 'hours' })
    await invoke(IPC.MEASURE_SAVE, { label: 'Parts', kind: 'currency' })
  })
  const extraOf = (id: number) => (testDb.db.prepare('SELECT extra_measures FROM case_log WHERE id = ?').get(id) as { extra_measures: string | null }).extra_measures

  it('saves them with a new note, rounded, and only known active ones', async () => {
    const res = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Fixed sink', 'note', null, { extra: { labor: 1.255, parts: 12.5, unused: null } })
    expect(res.ok).toBe(true)
    expect(JSON.parse(res.data.extra_measures)).toEqual({ labor: 1.26, parts: 12.5 })
    expect((await invoke(IPC.CASE_LOG_CREATE, rowId, 'x', 'note', null, { extra: { made_up: 1 } })).ok).toBe(false)
    expect((await invoke(IPC.CASE_LOG_CREATE, rowId, 'x', 'note', null, { extra: { labor: 30 } })).error).toMatch(/24 hours/)
    const plain = await invoke(IPC.CASE_LOG_CREATE, rowId, 'No numbers', 'note', null, { extra: {} })
    expect(extraOf(plain.data.id)).toBeNull()
  })

  it('archived numbers can\'t go on new notes but stay on old ones through edits and undo', async () => {
    const note = (await invoke(IPC.CASE_LOG_CREATE, rowId, 'Fixed sink', 'note', null, { extra: { labor: 2 } })).data
    await invoke(IPC.MEASURE_ARCHIVE, 'labor', true)
    expect((await invoke(IPC.CASE_LOG_CREATE, rowId, 'x', 'note', null, { extra: { labor: 1 } })).ok).toBe(false)
    expect(cleanExtraMeasures({ labor: 1 }, { allowArchived: true })).toBe('{"labor":1}')

    expect((await invoke(IPC.CASE_LOG_SET_MEASURES, note.id, { minutes: null, miles: null, extra: { labor: 3, parts: 9.99 } })).ok).toBe(true)
    expect(JSON.parse(extraOf(note.id)!)).toEqual({ labor: 3, parts: 9.99 })
    // leaving extra out keeps what's there
    await invoke(IPC.CASE_LOG_SET_MEASURES, note.id, { minutes: 30, miles: null })
    expect(JSON.parse(extraOf(note.id)!)).toEqual({ labor: 3, parts: 9.99 })

    const saved = testDb.db.prepare('SELECT * FROM case_log WHERE id = ?').get(note.id) as Record<string, unknown>
    testDb.db.prepare('DELETE FROM case_log WHERE id = ?').run(note.id)
    expect((await invoke(IPC.CASE_LOG_RESTORE, saved)).ok).toBe(true)
    expect(JSON.parse(extraOf(note.id)!)).toEqual({ labor: 3, parts: 9.99 })
  })
})
