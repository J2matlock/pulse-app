/**
 * Undo for library items deleted for good (UX pass Q4, B2): the delete keeps a
 * copy in main and hands out a token; restoring puts the row back under the
 * same id, once, and refuses when something else took its place.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => require('os').tmpdir(), getName: () => 'Pulse Test', getVersion: () => '0.0.0-test', on: () => {} },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }, on: () => {} },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: {},
  shell: {},
}))
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

let testDb: TestDb
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => testDb.db, cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql) }
})

import { deleteKeepingCopy, restoreLibraryItem, forgetLibraryCopies, LibraryRestoreError, MAX_KEPT } from '../src/main/library-restore'
import { deleteForm } from '../src/main/forms'
import { deleteReport } from '../src/main/report-builder'
import { deleteSetupTemplate, deleteLetterTemplate } from '../src/main/templates'

const fakeEvent = { senderFrame: { parent: null } }
async function invoke(channel: string, ...args: unknown[]): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`No handler for ${channel}`)
  return await h(fakeEvent, ...args) as { ok: boolean; data?: unknown; error?: string }
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerLibraryHandlers } = await import('../src/main/ipc/ipc-library')
  registerLibraryHandlers()
})
beforeEach(() => { testDb = createTestDb(); forgetLibraryCopies() })
afterEach(() => { cleanupTestDb(testDb) })

const one = (sql: string, ...args: unknown[]) => testDb.db.prepare(sql).get(...args) as Record<string, unknown> | undefined
const insert = (sql: string, ...args: unknown[]) => Number(testDb.db.prepare(sql).run(...args).lastInsertRowid)

function seedAll() {
  const { gridId } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
  return {
    gridId,
    checklist: insert("INSERT INTO checklist_templates (name, description, items, is_recurring, recurrence_days) VALUES ('Intake', 'First visit', '[{\"title\":\"Call\"}]', 1, 90)"),
    letter: insert("INSERT INTO letter_templates (name, description, content) VALUES ('Reminder', NULL, 'Dear {{client_name}}')"),
    setup: insert("INSERT INTO setup_templates (name, description, template_data) VALUES ('Waiver list', 'Columns', '{\"columns\":[]}')"),
    form: insert("INSERT INTO forms (grid_id, name, fields, position) VALUES (?, 'Intake form', '[{\"columnId\":1}]', 3)", gridId),
    report: insert("INSERT INTO report_definitions (name, grid_id, config) VALUES ('Monthly', ?, '{\"source\":\"records\"}')", gridId),
    snippet: insert("INSERT INTO snippets (trigger_text, expansion, category) VALUES ('hv', 'Home visit completed.', 'Visits')"),
  }
}

describe('library restore: the same id and fields come back (Q4)', () => {
  it('checklist template, letter template, list template, form, report and snippet', () => {
    const ids = seedAll()
    const cases = [
      { kind: 'checklist-template' as const, table: 'checklist_templates', id: ids.checklist, del: () => { testDb.db.prepare('DELETE FROM checklist_templates WHERE id = ?').run(ids.checklist) } },
      { kind: 'letter-template' as const, table: 'letter_templates', id: ids.letter, del: () => deleteLetterTemplate(ids.letter) },
      { kind: 'setup-template' as const, table: 'setup_templates', id: ids.setup, del: () => deleteSetupTemplate(ids.setup) },
      { kind: 'form' as const, table: 'forms', id: ids.form, del: () => deleteForm(ids.form) },
      { kind: 'report' as const, table: 'report_definitions', id: ids.report, del: () => deleteReport(ids.report) },
      { kind: 'snippet' as const, table: 'snippets', id: ids.snippet, del: () => { testDb.db.prepare('DELETE FROM snippets WHERE id = ?').run(ids.snippet) } },
    ]
    for (const c of cases) {
      const before = one(`SELECT * FROM ${c.table} WHERE id = ?`, c.id)
      const token = deleteKeepingCopy(c.kind, c.id, c.del)
      expect(token, c.kind).toMatch(/^[0-9a-f-]{36}$/)
      expect(one(`SELECT * FROM ${c.table} WHERE id = ?`, c.id), c.kind).toBeUndefined()
      expect(restoreLibraryItem(token!)).toEqual({ kind: c.kind, id: c.id })
      expect(one(`SELECT * FROM ${c.table} WHERE id = ?`, c.id), c.kind).toEqual(before)
    }
  })

  it('a report comes back pinned to the dashboard where it was', () => {
    const { gridId, report } = seedAll()
    const other = insert("INSERT INTO report_definitions (name, grid_id, config) VALUES ('Weekly', ?, '{}')", gridId)
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dashboard_reports', ?)").run(JSON.stringify([report, other]))
    const token = deleteKeepingCopy('report', report, () => deleteReport(report))!
    expect(JSON.parse(String(one("SELECT value FROM settings WHERE key = 'dashboard_reports'")!.value))).toEqual([other])
    restoreLibraryItem(token)
    expect(JSON.parse(String(one("SELECT value FROM settings WHERE key = 'dashboard_reports'")!.value))).toEqual([report, other])
  })

  it('a column that adds a checklist when done still points at the template', () => {
    const { checklist } = seedAll()
    const token = deleteKeepingCopy('checklist-template', checklist, () => { testDb.db.prepare('DELETE FROM checklist_templates WHERE id = ?').run(checklist) })!
    restoreLibraryItem(token)
    expect(one('SELECT name FROM checklist_templates WHERE id = ?', checklist)?.name).toBe('Intake')
  })
})

describe('library restore: refusals', () => {
  it('a token works once', () => {
    const { letter } = seedAll()
    const token = deleteKeepingCopy('letter-template', letter, () => deleteLetterTemplate(letter))!
    restoreLibraryItem(token)
    expect(() => restoreLibraryItem(token)).toThrow(LibraryRestoreError)
  })

  it('locking, quitting or restoring a backup (the database closing) forgets every kept copy', async () => {
    const ids = seedAll()
    const token = deleteKeepingCopy('snippet', ids.snippet, () => { testDb.db.prepare('DELETE FROM snippets WHERE id = ?').run(ids.snippet) })
    const { closeDatabase } = await import('../src/main/database')
    closeDatabase()
    expect(() => restoreLibraryItem(token)).toThrow(LibraryRestoreError)
  })

  it('an unknown token is refused in plain words', () => {
    expect(() => restoreLibraryItem('not-a-token')).toThrow("That can't be brought back any more.")
  })

  it('refuses when the id has been taken', () => {
    const { letter } = seedAll()
    const token = deleteKeepingCopy('letter-template', letter, () => deleteLetterTemplate(letter))!
    testDb.db.prepare("INSERT INTO letter_templates (id, name, content) VALUES (?, 'Squatter', 'x')").run(letter)
    expect(() => restoreLibraryItem(token)).toThrow("That can't be brought back: something new is using its place.")
    expect(one('SELECT name FROM letter_templates WHERE id = ?', letter)?.name).toBe('Squatter')
  })

  it('refuses a snippet whose shortcut another snippet took', () => {
    const { snippet } = seedAll()
    const token = deleteKeepingCopy('snippet', snippet, () => { testDb.db.prepare('DELETE FROM snippets WHERE id = ?').run(snippet) })!
    insert("INSERT INTO snippets (trigger_text, expansion) VALUES ('hv', 'Something else')")
    expect(() => restoreLibraryItem(token)).toThrow(/another one uses its shortcut/)
  })

  it('refuses a form whose list was deleted for good, and leaves nothing half-done', () => {
    const { form, gridId } = seedAll()
    const token = deleteKeepingCopy('form', form, () => deleteForm(form))!
    testDb.db.pragma('foreign_keys = ON')
    testDb.db.prepare('DELETE FROM grids WHERE id = ?').run(gridId)
    expect(() => restoreLibraryItem(token)).toThrow(LibraryRestoreError)
    expect(one('SELECT 1 AS x FROM forms WHERE id = ?', form)).toBeUndefined()
  })

  it('nothing to delete gives no token; a failed delete keeps no copy', () => {
    expect(deleteKeepingCopy('snippet', 9999, () => { testDb.db.prepare('DELETE FROM snippets WHERE id = ?').run(9999) })).toBeNull()
    expect(() => deleteKeepingCopy('form', 9999, () => deleteForm(9999))).toThrow('That form no longer exists.')
  })

  it('keeps only the newest copies', () => {
    seedAll()
    const tokens: string[] = []
    for (let i = 0; i < MAX_KEPT + 1; i++) {
      const id = insert("INSERT INTO snippets (trigger_text, expansion) VALUES (?, 'x')", `t${i}`)
      tokens.push(deleteKeepingCopy('snippet', id, () => { testDb.db.prepare('DELETE FROM snippets WHERE id = ?').run(id) })!)
    }
    expect(() => restoreLibraryItem(tokens[0]!)).toThrow(LibraryRestoreError)
    expect(restoreLibraryItem(tokens.at(-1)!).kind).toBe('snippet')
  })
})

describe('LIBRARY_RESTORE (IPC)', () => {
  it('restores by token and says why when it can\'t', async () => {
    const { snippet } = seedAll()
    const token = deleteKeepingCopy('snippet', snippet, () => { testDb.db.prepare('DELETE FROM snippets WHERE id = ?').run(snippet) })!
    expect(await invoke(IPC.LIBRARY_RESTORE, token)).toEqual({ ok: true, data: { kind: 'snippet', id: snippet } })
    expect(await invoke(IPC.LIBRARY_RESTORE, token)).toEqual({ ok: false, error: "That can't be brought back any more." })
  })

  it('takes only a short string, never a table, columns or values', async () => {
    for (const bad of [undefined, 42, '', 'x'.repeat(101), { table: 'snippets', row: { id: 1 } }]) {
      const r = await invoke(IPC.LIBRARY_RESTORE, bad)
      expect(r.ok).toBe(false)
    }
  })
})
