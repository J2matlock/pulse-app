/**
 * ATTACHMENT_ADD_PATHS when some files are new and some already attached, and
 * "Attach again" then fails: the new ones were saved, so the record is told.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const sent: Array<[string, unknown]> = []

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-ipc-attachments', getName: () => 'Pulse Test', getVersion: () => '0.0.0-test', commandLine: { appendSwitch: () => {} }, on: () => {} },
  ipcMain: { handle: (channel: string, h: (...args: unknown[]) => unknown) => { handlers.set(channel, h) }, on: () => {} },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (ch: string, arg: unknown) => { sent.push([ch, arg]) } } }] },
  dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

let testDb: TestDb
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => testDb.db, cachedStmt: (_k: string, sql: string) => testDb.db.prepare(sql) }
})

const calls = vi.hoisted(() => ({ n: 0 }))
vi.mock('../src/main/attachments', async () => {
  const actual = await vi.importActual<typeof import('../src/main/attachments')>('../src/main/attachments')
  return {
    ...actual,
    addAttachments: (_rowId: number, paths: string[]) => {
      calls.n++
      if (calls.n === 1) return { added: [{ id: 1, file_name: 'new.pdf' }], duplicates: [{ path: paths[1], fileName: 'old.pdf', existingDate: '2026-10-01 10:00:00' }] }
      throw new actual.AttachmentError('That would use more than the space set aside for files.')
    },
  }
})

const fakeEvent = { senderFrame: { parent: null } }
let rowId: number

beforeAll(async () => {
  testDb = createTestDb()
  const { registerAttachmentHandlers } = await import('../src/main/ipc/ipc-attachments')
  registerAttachmentHandlers()
})
beforeEach(() => {
  testDb = createTestDb()
  rowId = seedGrid(testDb.db, { rowCount: 1 }).rowIds[0]!
  calls.n = 0
  sent.length = 0
})
afterEach(() => cleanupTestDb(testDb))

describe('ATTACHMENT_ADD_PATHS with "Attach again"', () => {
  it('when attaching again fails, the files that were added still show, and the message says so', async () => {
    const res = await handlers.get(IPC.ATTACHMENT_ADD_PATHS)!(fakeEvent, rowId, ['/tmp/pulse-test-ipc-attachments/new.pdf', '/tmp/pulse-test-ipc-attachments/old.pdf']) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/1 new file was added/)
    expect(sent).toContainEqual([IPC.ATTACHMENTS_CHANGED, rowId])
  })
})
