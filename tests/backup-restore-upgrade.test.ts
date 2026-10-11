/**
 * The usual path after a restore: a backup made by an older Pulse (schema v30,
 * real tables and data) is restored on a new computer with the old password,
 * then opened by the real openDatabase(), which runs every newer migration.
 * Only Electron, electron-store and the logger are mocked; auth.ts, backup.ts
 * and database.ts are the real modules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'

const state = await vi.hoisted(async () => {
  // auth.ts creates its data dir at import time, so it must exist before imports run
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  return { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-upgrade-')), stores: new Map<string, Map<string, unknown>>() }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => state.dir, getVersion: () => '9.9.9', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
  clipboard: { clear: () => {} },
  ipcMain: { handle: () => {}, removeHandler: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('electron-store', () => ({
  default: class {
    private data: Map<string, unknown>
    constructor(opts?: { name?: string }) {
      const name = opts?.name ?? 'config'
      let data = state.stores.get(name)
      if (!data) { data = new Map(); state.stores.set(name, data) }
      this.data = data
    }
    get(k: string, d?: unknown) { return this.data.has(k) ? this.data.get(k) : d }
    set(k: string | Record<string, unknown>, v?: unknown) {
      if (typeof k === 'object') for (const [key, val] of Object.entries(k)) this.data.set(key, val)
      else this.data.set(k, v)
    }
    has(k: string) { return this.data.has(k) }
    delete(k: string) { this.data.delete(k) }
    clear() { this.data.clear() }
  },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

import { setupPassword, getDbKey, lockApp } from '../src/main/auth'
// database.ts first, as in the app: it registers itself with backup.ts while loading
import { openDatabase, closeDatabase, getDb, latestSchemaVersion } from '../src/main/database'
import { runManualBackup, restoreBackupOnNewInstall, setDatabaseBridge } from '../src/main/backup'
import { seedGrid } from './helpers'
import { createProdFormatDb, countRows } from './backupTestUtils'

const OLD_PWD = 'Old-Computer-Pass-1'
const OLD_SCHEMA = 30

beforeEach(() => {
  lockApp()
  for (const m of state.stores.values()) m.clear()
})

afterEach(() => {
  try { closeDatabase() } catch { /* not open */ }
  lockApp()
  try { rmSync(state.dir, { recursive: true, force: true }) } catch { /* best effort */ }
})

describe('Restoring an older Pulse backup, then opening it', { timeout: 60_000 }, () => {
  it('a v30 backup restores on a new computer and upgrades to the current schema with its data intact', async () => {
    // ── Old computer: Pulse at schema v30, with records, notes and a record in the Trash
    const dbPath = join(state.dir, 'pulse.db')
    await setupPassword(OLD_PWD, '', dbPath)
    const keyHex = getDbKey().toString('hex')
    const old = createProdFormatDb(dbPath, { hexKey: keyHex, upToVersion: OLD_SCHEMA })
    expect((old.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe(String(OLD_SCHEMA))
    const { gridId, columnIds, rowIds } = seedGrid(old, { rowCount: 5, columnCount: 2, columnTypes: ['text', 'date'] })
    const cell = old.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    rowIds.forEach((id, i) => {
      cell.run(id, columnIds[0], `Test Person ${i}`)
      cell.run(id, columnIds[1], `2026-0${i + 1}-15`)
    })
    const note = old.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'note', datetime('now'), datetime('now'))")
    note.run(rowIds[0], 'Initial visit done')
    note.run(rowIds[1], 'Called back')
    old.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(rowIds[4])

    // The old Pulse makes its backup from the open database (VACUUM INTO)
    setDatabaseBridge({ closeDatabase: () => old.close(), getDb: () => old })
    const { destPath: backupPath } = await runManualBackup(join(state.dir, 'usb', 'old-pulse'))
    old.close()
    setDatabaseBridge({ closeDatabase, getDb })

    // ── New computer: nothing but the backup file
    lockApp()
    for (const m of state.stores.values()) m.clear()
    for (const f of readdirSync(state.dir)) if (f !== 'usb') rmSync(join(state.dir, f), { recursive: true, force: true })

    const { schemaVersion } = await restoreBackupOnNewInstall({ backupPath, secret: OLD_PWD, newPassword: 'New-Computer-Pass-1', hint: '' })
    expect(schemaVersion).toBe(OLD_SCHEMA)
    expect(getDbKey().toString('hex')).toBe(keyHex)

    // ── The real open: migrations 31..latest run on the restored data
    openDatabase()
    const db = getDb()
    const version = Number((db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value)
    expect(version).toBe(latestSchemaVersion())
    expect(version).toBeGreaterThan(OLD_SCHEMA)

    expect(countRows(db, 'rows', 'grid_id = ?', gridId)).toBe(5)
    expect(countRows(db, 'rows', 'grid_id = ? AND deleted_at IS NULL', gridId)).toBe(4)
    const names = (db.prepare('SELECT value FROM cells WHERE column_id = ? ORDER BY row_id').all(columnIds[0]) as Array<{ value: string }>).map(r => r.value)
    expect(names).toEqual(['Test Person 0', 'Test Person 1', 'Test Person 2', 'Test Person 3', 'Test Person 4'])
    expect((db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[2], columnIds[1]) as { value: string }).value).toBe('2026-03-15')
    const notes = (db.prepare('SELECT content FROM case_log ORDER BY id').all() as Array<{ content: string }>).map(r => r.content)
    expect(notes).toEqual(['Initial visit done', 'Called back'])
    // Tables from later versions exist and work
    expect(countRows(db, 'appointments')).toBe(0)
    expect(countRows(db, 'attachments')).toBe(0)

    // A safety copy was taken before the upgrade, at the restored version
    const backups = readdirSync(join(state.dir, 'backups'))
    expect(backups.some(f => f.startsWith(`pulse-pre-migration-v${OLD_SCHEMA}-to-v${latestSchemaVersion()}-`))).toBe(true)

    // And it opens again cleanly (no migration re-runs)
    closeDatabase()
    openDatabase()
    expect(Number((getDb().prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value)).toBe(latestSchemaVersion())
    expect(existsSync(join(state.dir, 'pulse.db'))).toBe(true)
  })
})
