/**
 * Contact and directory PDFs: availability wording, wrapping of long details,
 * and category colors saved before colors were checked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, setDbWords, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-contact-pdf', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportContactPdf, exportDirectoryPdf } from '../src/main/export-pdf'

beforeEach(() => {
  testDb = createTestDb()
  setDbWords(testDb.db)
})
afterEach(() => cleanupTestDb(testDb))

const dest = (name: string) => join(testDb.tmpDir, name)
/** The text runs jsPDF wrote: "(text) Tj" */
const runs = (path: string) => (readFileSync(path, 'latin1').match(/\((?:\\.|[^\\)])*\) Tj/g) ?? []).map(r => r.slice(1, -4))

function addProvider(data: Record<string, unknown>): number {
  const cols = Object.keys(data)
  const r = testDb.db.prepare(`INSERT INTO providers (${cols.join(', ')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, datetime('now'), datetime('now'))`)
    .run(...Object.values(data))
  return Number(r.lastInsertRowid)
}

describe('contact PDF', () => {
  it('prints availability the way the app says it, not the stored key', async () => {
    const id = addProvider({ name: 'Full Clinic', availability_status: 'full' })
    await exportContactPdf(id, dest('c.pdf'))
    const text = runs(dest('c.pdf')).join(' ')
    expect(text).toContain('Not Accepting')
    expect(text).not.toMatch(/\bfull\b/)
  })

  it('wraps a long address onto more lines instead of running off the page', async () => {
    const address = 'Suite 400, Building C, 1234 Long Industrial Parkway Extension, Northeast Business District, Springfield, Illinois 62701, United States'
    const id = addProvider({ name: 'Long Address', address })
    await exportContactPdf(id, dest('c.pdf'))
    const all = runs(dest('c.pdf'))
    expect(all.some(r => r === address)).toBe(false)
    expect(all.join(' ')).toContain('United States')
  })
})

describe('directory PDF', () => {
  it('prints a category whose color was typed as a word', async () => {
    const cat = testDb.db.prepare("INSERT INTO provider_categories (name, color, position) VALUES ('Old', 'red', 0)").run()
    addProvider({ name: 'In Old', category_id: Number(cat.lastInsertRowid), availability_status: 'full' })
    await expect(exportDirectoryPdf({}, dest('d.pdf'))).resolves.toBeUndefined()
    expect(runs(dest('d.pdf')).join(' ')).toContain('Not Accepting')
  })
})
