/**
 * Backup and restore safety net (sweep plan 1.4), through the real Settings
 * restore handlers: ipc-export.ts → backup.ts → database.ts → every migration,
 * on a real SQLCipher database seeded with the full workspace generator
 * (records, notes, attachments with their bytes, custom columns, links,
 * tasks, appointments, trashed and archived records).
 *
 * Only Electron, electron-store, the logger and the key store are faked. The
 * restore-on-a-new-computer paths (password, recovery key, wrong secret,
 * newer backup, a failed credential rebuild) are in
 * tests/backup-new-install.test.ts, which uses the real auth.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync, truncateSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3'
import { IPC } from '../../src/shared/ipc-channels'

const KEY_HEX = 'c3'.repeat(32)

const h = vi.hoisted(() => ({
  storedPath: '',
  stores: new Map<string, Map<string, unknown>>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => process.env.PULSE_DATA_DIR ?? '/nonexistent',
    getVersion: () => '9.9.9',
    getName: () => 'Pulse Test',
    on: () => {},
  },
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(ch, fn) }, on: () => {}, removeHandler: () => {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  safeStorage: { isEncryptionAvailable: () => false },
  clipboard: { clear: () => {} },
  dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '' },
}))

vi.mock('electron-store', () => ({
  default: class {
    private data: Map<string, unknown>
    constructor(opts?: { name?: string }) {
      const name = opts?.name ?? 'config'
      if (!h.stores.has(name)) h.stores.set(name, new Map())
      this.data = h.stores.get(name) as Map<string, unknown>
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

vi.mock('../../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../../src/main/auth', () => ({
  getDbKey: () => Buffer.from(KEY_HEX, 'hex'),
  setStoredDbPath: (p: string) => { h.storedPath = p },
  getStoredDbPath: () => h.storedPath,
  isPasswordSetup: () => true,
  getKeyEnvelope: () => null,
  isValidKeyEnvelope: () => false,
  unwrapKeyEnvelope: () => { throw new Error('not used') },
  adoptRestoredDbKey: () => { throw new Error('not used') },
}))

import { openDatabase, closeDatabase, getDb, latestSchemaVersion } from '../../src/main/database'
import { runAutoBackup, listAutoBackups } from '../../src/main/backup'
import { registerExportHandlers } from '../../src/main/ipc/ipc-export'
import { MIGRATIONS } from '../../src/main/migration-list'
import { seedWorkspace } from '../seedWorkspace'

registerExportHandlers()

let dir: string

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string }

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`No handler for ${channel}`)
  return await fn({ senderFrame: { parent: null, url: 'app://bundle/index.html' } }, ...args) as Result<T>
}

/** Open a file the way the app does (same cipher settings and key) */
function openRaw(path: string): Database {
  const db = new BetterSqlite3(path) as Database
  db.pragma(`cipher='sqlcipher'`)
  db.pragma(`key='${KEY_HEX}'`)
  db.pragma('kdf_iter=256000')
  db.pragma('cipher_page_size=4096')
  db.pragma('cipher_hmac_algorithm=HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
  db.pragma('foreign_keys = ON')
  return db
}

/**
 * Every row of every table, in rowid order, with BLOBs as hex: two dumps are
 * equal only if the data is identical, attachment bytes included.
 */
function dumpAll(db: Database): Record<string, unknown[]> {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map(t => t.name)
  const out: Record<string, unknown[]> = {}
  for (const t of tables) {
    const hasRowid = !(db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(t) as { sql: string }).sql.includes('WITHOUT ROWID')
    const rows = db.prepare(`SELECT * FROM "${t}"${hasRowid ? ' ORDER BY rowid' : ''}`).all() as Array<Record<string, unknown>>
    out[t] = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? `x'${v.toString('hex')}'` : v])))
  }
  return out
}

const count = (db: Database, table: string, where = '1=1') => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n
const preRestoreCopies = () => existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).filter(f => f.startsWith('pulse-pre-restore-')) : []

/** Damage the live data the way a user would before reaching for a backup */
function changeEverything(db: Database): void {
  db.prepare('DELETE FROM rows WHERE id IN (SELECT id FROM rows ORDER BY id LIMIT 5)').run()
  db.prepare("UPDATE cells SET value = 'changed after the backup'").run()
  db.prepare("UPDATE attachment_blobs SET data = x'00ff'").run()
  db.prepare("INSERT INTO grids (name) VALUES ('Made after the backup')").run()
}

beforeEach(() => {
  for (const m of h.stores.values()) m.clear()
  dir = mkdtempSync(join(tmpdir(), 'pulse-restore-safety-'))
  process.env.PULSE_DATA_DIR = dir
  openDatabase()
  seedWorkspace(getDb(), { records: 40, customColumns: 8, today: '2026-10-11' })
})

afterEach(() => {
  try { closeDatabase() } catch { /* already closed */ }
  delete process.env.PULSE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('Restore from Settings brings back exactly what was backed up', () => {
  it('a .pulse-backup: every table identical, attachment bytes included', async () => {
    const before = dumpAll(getDb())
    expect(count(getDb(), 'attachment_blobs')).toBeGreaterThan(0)
    const made = await invoke<{ destPath: string }>(IPC.BACKUP_MANUAL_CREATE, join(dir, 'usb', 'round-trip'))
    if (!made.ok) throw new Error(made.error)

    changeEverything(getDb())
    const res = await invoke<{ safetyPath: string }>(IPC.BACKUP_RESTORE_FILE, made.data.destPath)
    expect(res).toMatchObject({ ok: true })

    expect(dumpAll(getDb())).toEqual(before)
    expect(getDb().pragma('integrity_check', { simple: true })).toBe('ok')
  })

  it('an auto-backup (.db): every table identical, attachment bytes included', async () => {
    const before = dumpAll(getDb())
    await runAutoBackup()
    const [auto] = listAutoBackups()
    expect(auto).toBeDefined()

    changeEverything(getDb())
    const res = await invoke(IPC.BACKUP_RESTORE_AUTO, auto)
    expect(res).toMatchObject({ ok: true })
    expect(dumpAll(getDb())).toEqual(before)
  })
})

describe('A damaged backup is refused and the current data stays as it is', () => {
  /** An auto-backup of the seeded data, then a different live state to protect */
  async function autoBackupThenChange(): Promise<{ auto: string; live: Record<string, unknown[]> }> {
    await runAutoBackup()
    const [auto] = listAutoBackups()
    if (!auto) throw new Error('no auto-backup')
    changeEverything(getDb())
    return { auto, live: dumpAll(getDb()) }
  }

  it('a truncated auto-backup fails verification, and restoring it leaves the current data untouched (A24-04)', async () => {
    const { auto, live } = await autoBackupThenChange()
    // Cut on a page boundary, so every page left still decrypts
    truncateSync(auto, Math.floor(statSync(auto).size * 0.6 / 4096) * 4096)

    const verify = await invoke<{ valid: boolean }>(IPC.BACKUP_VERIFY, auto)
    expect(verify).toMatchObject({ ok: true, data: { valid: false } })

    const res = await invoke(IPC.BACKUP_RESTORE_AUTO, auto)
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/damaged/) })
    expect(dumpAll(getDb())).toEqual(live)
    expect(getDb().pragma('integrity_check', { simple: true })).toBe('ok')
  })

  it('a .db backup with damaged bytes in the middle is refused, and the current data is untouched (A24-04)', async () => {
    const { auto, live } = await autoBackupThenChange()
    const bytes = readFileSync(auto)
    const at = Math.floor(bytes.length / 2)
    for (let i = 0; i < 4096; i++) bytes[at + i] = (bytes[at + i] ?? 0) ^ 0x5a
    writeFileSync(auto, bytes)

    expect(await invoke(IPC.BACKUP_VERIFY, auto)).toMatchObject({ ok: true, data: { valid: false, otherPulse: false } })
    const res = await invoke(IPC.BACKUP_RESTORE_FILE, auto)
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/damaged/) })
    expect(dumpAll(getDb())).toEqual(live)
    expect(preRestoreCopies()).toEqual([])
  })

  it('a truncated .pulse-backup is refused before anything is replaced', async () => {
    const made = await invoke<{ destPath: string }>(IPC.BACKUP_MANUAL_CREATE, join(dir, 'usb', 'cut-short'))
    if (!made.ok) throw new Error(made.error)
    changeEverything(getDb())
    const live = dumpAll(getDb())
    truncateSync(made.data.destPath, Math.floor(statSync(made.data.destPath).size * 0.6))

    expect(await invoke(IPC.BACKUP_VERIFY, made.data.destPath)).toMatchObject({ ok: true, data: { valid: false } })
    const res = await invoke(IPC.BACKUP_RESTORE_FILE, made.data.destPath)
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/damaged/) })
    expect(dumpAll(getDb())).toEqual(live)
  })
})

describe('Backups from other schema versions', () => {
  it('a backup from an older Pulse (schema 30) is upgraded on restore and keeps its data', async () => {
    mkdirSync(join(dir, 'usb'), { recursive: true })
    const old = join(dir, 'usb', 'pulse-v30.db')
    const db = openRaw(old)
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of MIGRATIONS) {
      if (m.version > 30) break
      if (m.noTransaction) m.up(db)
      else db.transaction(() => m.up(db))()
    }
    const gridId = Number(db.prepare("INSERT INTO grids (name) VALUES ('Old list')").run().lastInsertRowid)
    const colId = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, is_name_column) VALUES (?, 'Name', 'text', 0, 1)").run(gridId).lastInsertRowid)
    const rowId = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 0)').run(gridId).lastInsertRowid)
    db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, 'Kept Person')").run(rowId, colId)
    db.prepare("INSERT INTO case_log (row_id, content) VALUES (?, 'Kept note')").run(rowId)
    db.close()

    const res = await invoke(IPC.BACKUP_RESTORE_FILE, old)
    expect(res).toMatchObject({ ok: true })
    const live = getDb()
    expect(Number((live.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value)).toBe(latestSchemaVersion())
    expect((live.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, colId) as { value: string }).value).toBe('Kept Person')
    expect(count(live, 'case_log', "content = 'Kept note'")).toBe(1)
    expect(live.pragma('integrity_check', { simple: true })).toBe('ok')
  })

  it.each(['.db', '.pulse-backup'])('a %s backup from a newer Pulse is refused with a clear message, and the current data is untouched (A24-03)', async (kind) => {
    // A backup of this very data, marked as written by a later schema
    let backupPath: string
    if (kind === '.db') {
      await runAutoBackup()
      backupPath = listAutoBackups()[0] ?? ''
      const db = openRaw(backupPath)
      db.prepare("UPDATE app_meta SET value = ? WHERE key = 'schema_version'").run(String(latestSchemaVersion() + 1))
      db.close()
    } else {
      getDb().prepare("UPDATE app_meta SET value = ? WHERE key = 'schema_version'").run(String(latestSchemaVersion() + 1))
      const made = await invoke<{ destPath: string }>(IPC.BACKUP_MANUAL_CREATE, join(dir, 'usb', 'newer'))
      if (!made.ok) throw new Error(made.error)
      backupPath = made.data.destPath
      getDb().prepare("UPDATE app_meta SET value = ? WHERE key = 'schema_version'").run(String(latestSchemaVersion()))
    }
    changeEverything(getDb())
    const live = dumpAll(getDb())

    const res = await invoke(IPC.BACKUP_RESTORE_FILE, backupPath)
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/newer version of Pulse/) })
    expect(dumpAll(getDb())).toEqual(live)
    // Refused before the live file was touched: no safety copy was needed
    expect(preRestoreCopies()).toEqual([])
  })
})

describe('A backup taken while changes are being saved', () => {
  it('is one consistent moment: its hash matches, it passes an integrity check, and it holds exactly the data at the moment it started', async () => {
    const db = getDb()
    const gridId = (db.prepare('SELECT id FROM grids ORDER BY id LIMIT 1').get() as { id: number }).id
    const ins = db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, 1000, datetime('now'), datetime('now'))")

    // Writes keep landing while the backup hashes and zips its snapshot
    let writing = true
    let written = 0
    const writer = (async () => {
      while (writing) {
        db.transaction(() => { ins.run(gridId); written++ })()
        await new Promise(r => setImmediate(r))
      }
    })()
    // The writer's first insert ran synchronously; the next waits for the event loop
    const rowsAtStart = count(db, 'rows')
    const made = await invoke<{ destPath: string }>(IPC.BACKUP_MANUAL_CREATE, join(dir, 'usb', 'busy'))
    writing = false
    await writer
    if (!made.ok) throw new Error(made.error)
    expect(written).toBeGreaterThan(0)

    expect(await invoke(IPC.BACKUP_VERIFY, made.data.destPath)).toMatchObject({ ok: true, data: { valid: true } })
    const res = await invoke(IPC.BACKUP_RESTORE_FILE, made.data.destPath)
    expect(res).toMatchObject({ ok: true })
    expect(count(getDb(), 'rows')).toBe(rowsAtStart)
    expect(getDb().pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
