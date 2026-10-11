/** The workspace seed generator (tests/seedWorkspace.ts) makes what it promises, and the app reads it. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))

import { buildGridQuery } from '../src/main/database'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { seedWorkspace, DEADLINE_MIX } from './seedWorkspace'
import { engineRuleFrom, evaluate, buildRecordContext } from '../src/shared/deadlineEngine'

const TODAY = '2026-03-08'  // a US daylight-saving day, on purpose

let t: TestDb
beforeEach(() => { t = createTestDb() })
afterEach(() => cleanupTestDb(t))

const count = (sql: string, ...args: unknown[]) => (t.db.prepare(sql).get(...args) as { n: number }).n

describe('seedWorkspace', () => {
  it('makes N records × M custom columns with every kind of data', () => {
    const s = seedWorkspace(t.db, { records: 40, customColumns: 12, today: TODAY })

    expect(s.rowIds).toHaveLength(40)
    expect(s.customColumnIds).toHaveLength(12)
    expect(count('SELECT COUNT(*) n FROM columns WHERE grid_id = ?', s.gridId)).toBe(14)  // name + deadline + 12

    // Every record kind, partitioning the list
    expect(s.trashedRowIds).toHaveLength(4)
    expect(s.archivedRowIds.length).toBeGreaterThan(0)
    expect(s.activeRowIds.length + s.archivedRowIds.length + s.trashedRowIds.length).toBe(40)
    expect(count('SELECT COUNT(*) n FROM rows WHERE grid_id = ? AND deleted_at IS NOT NULL', s.gridId)).toBe(4)
    expect(count('SELECT COUNT(*) n FROM rows WHERE grid_id = ? AND archived_at IS NOT NULL AND deleted_at IS NULL', s.gridId)).toBe(s.archivedRowIds.length)

    // Child data on trashed records too, so soft-delete leaks are visible
    const trashed = s.trashedRowIds.join(',')
    for (const table of ['case_log', 'appointments', 'attachments']) {
      expect(count(`SELECT COUNT(*) n FROM ${table} WHERE row_id IN (${trashed})`)).toBeGreaterThan(0)
    }
    expect(count(`SELECT COUNT(*) n FROM record_links WHERE from_row_id IN (${trashed})`)).toBeGreaterThan(0)

    expect(s.noteIds).toHaveLength(80)
    expect(s.taskIds).toHaveLength(12)
    expect(count('SELECT COUNT(*) n FROM caseload_tasks WHERE recurrence_rule IS NOT NULL')).toBeGreaterThan(0)
    expect(count("SELECT COUNT(DISTINCT status) n FROM appointments")).toBeGreaterThan(2)
    expect(s.links.length).toBe(20)
    expect(s.linkedRowIds.length).toBe(8)

    // The display-name trigger saw the name cells
    const name = t.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(s.rowIds[0]) as { display_name: string }
    expect(name.display_name).toMatch(/^Ada Park 1$/)
  })

  it('stores attachment bytes exactly, NUL bytes included', () => {
    const s = seedWorkspace(t.db, { records: 10, customColumns: 2, today: TODAY })
    expect(s.attachmentIds.length).toBe(4)
    for (const id of s.attachmentIds) {
      const row = t.db.prepare('SELECT a.sha256, a.size_bytes, b.data FROM attachments a JOIN attachment_blobs b ON b.attachment_id = a.id WHERE a.id = ?')
        .get(id) as { sha256: string; size_bytes: number; data: Buffer }
      expect(Buffer.compare(row.data, s.attachmentBytes.get(id)!)).toBe(0)
      expect(row.size_bytes).toBe(row.data.length)
      expect(row.sha256).toBe(createHash('sha256').update(row.data).digest('hex'))
    }
  })

  it('gives deadlines in every state, as the engine sees them', () => {
    const s = seedWorkspace(t.db, { records: DEADLINE_MIX.length * 2, customColumns: 0, today: TODAY, trashEvery: 0, archiveEvery: 0 })
    const rule = engineRuleFrom(t.db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(s.ruleId) as Parameters<typeof engineRuleFrom>[0])
    const states = new Set<string>()
    for (const rowId of s.rowIds) {
      const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, s.deadlineColumnId) as { value: string } | undefined
      const res = evaluate(rule, buildRecordContext(rule, { today: TODAY, columnDate: cell?.value ?? null }))
      expect(res.daysUntil).toBe(s.deadlineDays.get(rowId))
      states.add(res.state)
    }
    expect([...states].sort()).toEqual(['due', 'none', 'ok', 'overdue', 'soon'])
  })

  it('is deterministic for the same options', () => {
    const a = seedWorkspace(t.db, { records: 15, customColumns: 8, today: TODAY, seed: 7 })
    const valuesOf = (gridId: number) => t.db.prepare(
      'SELECT c.value FROM cells c JOIN rows r ON r.id = c.row_id WHERE r.grid_id = ? ORDER BY r.position, c.column_id'
    ).all(gridId).map(r => (r as { value: string }).value)
    const first = valuesOf(a.gridId)
    const b = seedWorkspace(t.db, { records: 15, customColumns: 8, today: TODAY, seed: 7 })
    expect(valuesOf(b.gridId)).toEqual(first)
  })

  it('loads through the production pivot query, without trashed records', () => {
    const s = seedWorkspace(t.db, { records: 30, customColumns: 6, today: TODAY })
    const columnIds = [s.nameColumnId, s.deadlineColumnId, ...s.customColumnIds]
    const rows = t.db.prepare(buildGridQuery(columnIds, true)).all(s.gridId) as Array<{ row_id: number }>
    const ids = new Set(rows.map(r => r.row_id))
    expect(rows).toHaveLength(30 - s.trashedRowIds.length)
    for (const id of s.trashedRowIds) expect(ids.has(id)).toBe(false)
    for (const id of [...s.activeRowIds, ...s.archivedRowIds]) expect(ids.has(id)).toBe(true)
  })

  it('seeds 5,000 × 40 quickly enough for performance runs', () => {
    const start = performance.now()
    const s = seedWorkspace(t.db, { records: 5000, customColumns: 40, notesPerRecord: 1, appointmentsPerRecord: 1 })
    const ms = performance.now() - start
    expect(s.rowIds).toHaveLength(5000)
    expect(count('SELECT COUNT(*) n FROM cells')).toBeGreaterThan(5000 * 30)
    expect(ms).toBeLessThan(30_000)
  }, 60_000)
})
