/**
 * Ready-made reports name records and notes with the list's own words, keeping
 * a word's own capitals ("IEPs", not "ieps") (A28-13).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
}))
vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

import { addStarterReports } from '../src/main/starter-reports'
import { listReports } from '../src/main/report-builder'
import { parseStarter } from '../src/shared/starters/schema'

beforeEach(() => { testDb = createTestDb() })
afterEach(() => cleanupTestDb(testDb))

const starter = () => {
  const parsed = parseStarter({
    pulse_template: '2.0', type: 'workspace', id: 'plans', name: 'Plans', description: 'Plans', icon: 'file',
    lists: [{ key: 'plans', name: 'Plans', kind: 'thing', columns: [{ name: 'Name', column_type: 'text', position: 0, is_name_column: 1 }] }],
  })
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.starter
}

describe('ready-made report wording', () => {
  it('keeps the capitals of words like "IEP"', () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { name: 'Plans', columnTypes: ['text', 'status'], rowCount: 0 })
    testDb.db.prepare('UPDATE columns SET is_name_column = 1 WHERE id = ?').run(columnIds[0])
    testDb.db.prepare("UPDATE columns SET name = 'Step', config = ? WHERE id = ?").run(JSON.stringify({
      options: [{ label: 'Draft', color: '#3b82f6' }, { label: 'Signed', color: '#22c55e' }],
      stage: { options: [{ value: 'Draft' }, { value: 'Signed', done: true }] },
    }), columnIds[1])
    testDb.db.prepare('UPDATE grids SET vocab = ? WHERE id = ?').run(JSON.stringify({
      record: { one: 'IEP', many: 'IEPs', article: 'an' },
      activity: { one: 'ARD note', many: 'ARD notes', article: 'an' },
    }), gridId)

    addStarterReports(starter(), { plans: gridId }, ['plans'])
    const abouts = listReports(gridId).map(r => r.config.about ?? '')
    expect(abouts).toContain('How many IEPs are at each step.')
    expect(abouts).toContain("How many ARD notes were written each month this year: a quick look at how busy it's been.")
  })
})
