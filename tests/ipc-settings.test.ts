/**
 * IPC Settings handler tests — ipc-settings.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3-multiple-ciphers'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-set') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {}, exit: () => {}, on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
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

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`)
  return await handler(fakeEvent, ...args)
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerSettingsHandlers } = await import('../src/main/ipc/ipc-settings')
  registerSettingsHandlers()
})

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

describe('IPC Settings', () => {
  // ── SETTINGS_GET ──────────────────────────────────────────────────────────
  describe('SETTINGS_GET', () => {
    it('returns null for non-existent key', async () => {
      const result = await invoke(IPC.SETTINGS_GET, 'theme') as any
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('returns stored value', async () => {
      testDb.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('theme', 'dark')
      const result = await invoke(IPC.SETTINGS_GET, 'theme') as any
      expect(result.ok).toBe(true)
      expect(result.data).toBe('dark')
    })

    it('fails with empty key', async () => {
      const result = await invoke(IPC.SETTINGS_GET, '') as any
      expect(result.ok).toBe(false)
    })

    it('fails with non-string key', async () => {
      const result = await invoke(IPC.SETTINGS_GET, 123) as any
      expect(result.ok).toBe(false)
    })

    it('fails with key containing special chars', async () => {
      const result = await invoke(IPC.SETTINGS_GET, 'key; DROP TABLE') as any
      expect(result.ok).toBe(false)
    })

    it('fails with unknown key', async () => {
      const result = await invoke(IPC.SETTINGS_GET, 'not_a_real_key') as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Unknown settings key/)
    })

    it('allows dynamic prefixed keys', async () => {
      testDb.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('client_details_columns_1', '["a","b"]')
      const result = await invoke(IPC.SETTINGS_GET, 'client_details_columns_1') as any
      expect(result.ok).toBe(true)
      expect(result.data).toBe('["a","b"]')
    })

    it('allows onboarding_ prefixed keys', async () => {
      const result = await invoke(IPC.SETTINGS_GET, 'onboarding_step') as any
      expect(result.ok).toBe(true)
    })

    it('fails with key over 200 chars', async () => {
      const result = await invoke(IPC.SETTINGS_GET, 'a'.repeat(201)) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── SETTINGS_GET_ALL ──────────────────────────────────────────────────────
  describe('SETTINGS_GET_ALL', () => {
    it('returns empty object when no settings', async () => {
      const result = await invoke(IPC.SETTINGS_GET_ALL) as any
      expect(result.ok).toBe(true)
      expect(result.data).toEqual({})
    })

    it('returns all settings as key-value map', async () => {
      testDb.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('theme', 'dark')
      testDb.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('font_size', '16')
      const result = await invoke(IPC.SETTINGS_GET_ALL) as any
      expect(result.ok).toBe(true)
      expect(result.data.theme).toBe('dark')
      expect(result.data.font_size).toBe('16')
    })
  })

  // ── SETTINGS_UPDATE ─────────────────────────────────────────────────────
  describe('SETTINGS_UPDATE', () => {
    it('creates a new setting', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, 'theme', 'dark') as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as any
      expect(row.value).toBe('dark')
    })

    it('updates an existing setting (upsert)', async () => {
      testDb.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('theme', 'light')
      const result = await invoke(IPC.SETTINGS_UPDATE, 'theme', 'dark') as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as any
      expect(row.value).toBe('dark')
    })

    it('fails with empty key', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, '', 'value') as any
      expect(result.ok).toBe(false)
    })

    it('fails with unknown key', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, 'unknown_key_xyz', 'value') as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Unknown settings key/)
    })

    it('fails with value exceeding 100k', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, 'theme', 'x'.repeat(100_001)) as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/too large/)
    })

    it('fails with non-string key', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, 42, 'value') as any
      expect(result.ok).toBe(false)
    })

    it('fails with non-string value', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, 'theme', 42) as any
      expect(result.ok).toBe(false)
    })

    it('rejects key with invalid format (SQL injection attempt)', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, 'theme; DROP TABLE', 'dark') as any
      expect(result.ok).toBe(false)
    })

    it('allows dynamic prefixed keys for update', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, 'profile_sidebar_width', '300') as any
      expect(result.ok).toBe(true)
    })

    it('accepts the calendar\'s hidden deadline columns only as a list of column ids', async () => {
      expect((await invoke(IPC.SETTINGS_UPDATE, 'calendar_hidden_deadline_columns', '[3,9]')).ok).toBe(true)
      expect((await invoke(IPC.SETTINGS_UPDATE, 'calendar_hidden_deadline_columns', '[]')).ok).toBe(true)
      for (const bad of ['3,9', '{"a":1}', '[0]', '[-2]', '[1.5]', '["3"]', 'null', JSON.stringify(Array.from({ length: 5001 }, (_, i) => i + 1))]) {
        const res = await invoke(IPC.SETTINGS_UPDATE, 'calendar_hidden_deadline_columns', bad)
        expect(res.ok, bad).toBe(false)
        expect(res.error).not.toMatch(/JSON|SQL/)
      }
      // The refused values didn't replace the good one
      expect((await invoke(IPC.SETTINGS_GET, 'calendar_hidden_deadline_columns')).data).toBe('[]')
    })

    it('allows custom_groups_ prefixed keys', async () => {
      const result = await invoke(IPC.SETTINGS_UPDATE, 'custom_groups_grid1', '[]') as any
      expect(result.ok).toBe(true)
    })
  })

  // ── GLOBAL_NOTE_GET ─────────────────────────────────────────────────────
  describe('GLOBAL_NOTE_GET', () => {
    it('returns null for non-existent scope', async () => {
      const result = await invoke(IPC.GLOBAL_NOTE_GET, 'tasks') as any
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('returns stored note', async () => {
      testDb.db.prepare("INSERT INTO global_notes (scope, content, updated_at) VALUES (?, ?, datetime('now'))").run('tasks', 'My note content')
      const result = await invoke(IPC.GLOBAL_NOTE_GET, 'tasks') as any
      expect(result.ok).toBe(true)
      expect(result.data.content).toBe('My note content')
    })

    it('fails with non-string scope', async () => {
      const result = await invoke(IPC.GLOBAL_NOTE_GET, 123) as any
      expect(result.ok).toBe(false)
    })

    it('fails with scope over 100 chars', async () => {
      const result = await invoke(IPC.GLOBAL_NOTE_GET, 'a'.repeat(101)) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── GLOBAL_NOTE_UPDATE ──────────────────────────────────────────────────
  describe('GLOBAL_NOTE_UPDATE', () => {
    it('creates a new note', async () => {
      const result = await invoke(IPC.GLOBAL_NOTE_UPDATE, 'tasks', 'Hello world') as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT content FROM global_notes WHERE scope = ?').get('tasks') as any
      expect(row.content).toBe('Hello world')
    })

    it('updates existing note (upsert)', async () => {
      testDb.db.prepare("INSERT INTO global_notes (scope, content, updated_at) VALUES (?, ?, datetime('now'))").run('tasks', 'Old')
      const result = await invoke(IPC.GLOBAL_NOTE_UPDATE, 'tasks', 'New') as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT content FROM global_notes WHERE scope = ?').get('tasks') as any
      expect(row.content).toBe('New')
    })

    it('fails with scope over 100 chars', async () => {
      const result = await invoke(IPC.GLOBAL_NOTE_UPDATE, 'a'.repeat(101), 'content') as any
      expect(result.ok).toBe(false)
    })

    it('fails with content over 500k chars', async () => {
      const result = await invoke(IPC.GLOBAL_NOTE_UPDATE, 'tasks', 'x'.repeat(500_001)) as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/too large|500,000/)
    })

    it('fails with non-string scope', async () => {
      const result = await invoke(IPC.GLOBAL_NOTE_UPDATE, 42, 'content') as any
      expect(result.ok).toBe(false)
    })

    it('fails with non-string content', async () => {
      const result = await invoke(IPC.GLOBAL_NOTE_UPDATE, 'tasks', 42) as any
      expect(result.ok).toBe(false)
    })
  })
})
