/** Opening and saving attachments (W09 commit 2): temp copies, wipe, exact bytes, picture previews. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
const { closeHooks, openPath } = vi.hoisted(() => ({ closeHooks: [] as Array<() => void>, openPath: vi.fn(async (_p?: string) => '') }))
vi.mock('electron', () => ({ shell: { openPath: (p: string) => openPath(p) }, app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql), registerCloseHook: (fn: () => void) => closeHooks.push(fn) }))
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

import { addAttachments } from '../src/main/attachments'
import { writeOpenedCopy, wipeOpenedFiles, openedFilesDir, saveAttachmentCopy, previewAttachment, openAttachment } from '../src/main/attachment-files'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])
const PDF = Buffer.from('%PDF-1.7\nsecret contents')
let dir: string
let rowId: number
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

beforeEach(() => {
  t = createTestDb()
  dir = mkdtempSync(join(tmpdir(), 'pulse-files-'))
  process.env.PULSE_DATA_DIR = join(dir, 'data')
  rowId = seedGrid(t.db, { rowCount: 1, columnCount: 1 }).rowIds[0]!
})
afterEach(() => { cleanupTestDb(t); rmSync(dir, { recursive: true, force: true }); delete process.env.PULSE_DATA_DIR })

const add = (name: string, data: Buffer) => { const p = join(dir, name); writeFileSync(p, data); return addAttachments(rowId, [p]).added[0]! }

describe('opening files', () => {
  it('writes a randomly named copy with the right ending, and the wipe removes it', async () => {
    const a = add('court order.pdf', PDF)
    const path = writeOpenedCopy(a.id)
    expect(path.startsWith(openedFilesDir())).toBe(true)
    expect(path).toMatch(/[0-9a-f]{24}\.pdf$/)
    expect(path).not.toMatch(/court/)
    expect(readFileSync(path).equals(PDF)).toBe(true)
    await openAttachment(a.id)
    expect(openPath).toHaveBeenCalledWith(expect.stringMatching(/\.pdf$/))
    expect(readdirSync(openedFilesDir())).toHaveLength(2)
    // Locking (closing the database) wipes them
    closeHooks.forEach(fn => fn())
    expect(readdirSync(openedFilesDir())).toEqual([])
    expect(wipeOpenedFiles()).toBe(0)
  })

  it('says when nothing can open it', async () => {
    const a = add('x.pdf', PDF)
    openPath.mockResolvedValueOnce('No application')
    await expect(openAttachment(a.id)).rejects.toThrow(/Save a copy instead/)
  })
})

describe('saving a copy and previews', () => {
  it('saves the exact bytes', async () => {
    const a = add('x.pdf', PDF)
    const dest = join(dir, 'saved.pdf')
    await saveAttachmentCopy(a.id, dest)
    expect(sha(readFileSync(dest))).toBe(sha(PDF))
  })

  it('previews pictures only', () => {
    expect(previewAttachment(add('p.png', PNG).id)).toEqual({ dataUrl: `data:image/png;base64,${PNG.toString('base64')}` })
    expect(previewAttachment(add('x.pdf', PDF).id)).toBeNull()
    expect(existsSync(openedFilesDir())).toBe(false)
  })
})
