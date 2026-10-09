/**
 * XSS prevention tests — verify that XSS payloads stored in cells are
 * returned as-is (literal storage, not sanitized or executed).
 * This is a data layer test confirming parameterized queries preserve values.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from '../helpers'

let t: TestDb

beforeEach(() => {
  t = createTestDb()
})

afterEach(() => {
  cleanupTestDb(t)
})

const XSS_PAYLOADS = [
  { name: 'basic script tag', value: '<script>alert("xss")</script>' },
  { name: 'script with src', value: '<script src="https://evil.com/xss.js"></script>' },
  { name: 'img onerror', value: '<img src=x onerror=alert(1)>' },
  { name: 'svg onload', value: '<svg onload=alert(1)>' },
  { name: 'event handler in div', value: '<div onmouseover="alert(1)">hover me</div>' },
  { name: 'javascript: protocol', value: '<a href="javascript:alert(1)">click</a>' },
  { name: 'data: URI', value: '<a href="data:text/html,<script>alert(1)</script>">click</a>' },
  { name: 'encoded script', value: '&#60;script&#62;alert(1)&#60;/script&#62;' },
  { name: 'unicode escape', value: '\u003cscript\u003ealert(1)\u003c/script\u003e' },
  { name: 'nested script', value: '<scr<script>ipt>alert(1)</scr</script>ipt>' },
  { name: 'style expression', value: '<div style="background:url(javascript:alert(1))">' },
  { name: 'iframe injection', value: '<iframe src="javascript:alert(1)"></iframe>' },
  { name: 'body onload', value: '<body onload=alert(1)>' },
  { name: 'input onfocus', value: '<input onfocus=alert(1) autofocus>' },
  { name: 'template literal', value: '${alert(1)}' },
  { name: 'constructor trick', value: '[].constructor.constructor("alert(1)")()' },
  { name: 'object with toString', value: '{"toString":"alert(1)"}' },
  { name: 'SQL + XSS combo', value: "'; alert(1); --" },
  { name: 'null byte + script', value: 'test\x00<script>alert(1)</script>' },
  { name: 'very long payload', value: '<script>' + 'a'.repeat(10000) + '</script>' },
]

describe('XSS payloads stored and retrieved as literal strings', () => {
  for (const payload of XSS_PAYLOADS) {
    it(`stores/retrieves: ${payload.name}`, () => {
      const { gridId, columnIds, rowIds } = seedGrid(t.db, { columnCount: 1, rowCount: 1 })

      // Insert cell with XSS payload
      t.db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(rowIds[0], columnIds[0], payload.value)

      // Retrieve and verify exact match
      const cell = t.db.prepare(
        'SELECT value FROM cells WHERE row_id = ? AND column_id = ?'
      ).get(rowIds[0], columnIds[0]) as { value: string }

      expect(cell.value).toBe(payload.value)
    })
  }
})

describe('XSS payloads in grid/column names', () => {
  it('stores script tag in grid name literally', () => {
    const xssName = '<script>alert("grid-xss")</script>'
    const result = t.db.prepare(
      `INSERT INTO grids (name, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`
    ).run(xssName)
    const grid = t.db.prepare('SELECT name FROM grids WHERE id = ?').get(result.lastInsertRowid) as { name: string }
    expect(grid.name).toBe(xssName)
  })

  it('stores onerror payload in column name literally', () => {
    const { gridId } = seedGrid(t.db, { columnCount: 0, rowCount: 0 })
    const xssName = '<img src=x onerror=alert("col-xss")>'
    const result = t.db.prepare(
      `INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at)
       VALUES (?, ?, 'text', 0, 0, datetime('now'))`
    ).run(gridId, xssName)
    const col = t.db.prepare('SELECT name FROM columns WHERE id = ?').get(result.lastInsertRowid) as { name: string }
    expect(col.name).toBe(xssName)
  })
})

describe('XSS payloads in case log entries', () => {
  it('stores script payload in case log content literally', () => {
    const { gridId, rowIds } = seedGrid(t.db, { columnCount: 1, rowCount: 1 })
    const xssContent = '<script>document.cookie</script>'
    const result = t.db.prepare(`
      INSERT INTO case_log (row_id, content, log_type, created_at)
      VALUES (?, ?, 'note', datetime('now'))
    `).run(rowIds[0], xssContent)

    const entry = t.db.prepare('SELECT content FROM case_log WHERE id = ?').get(result.lastInsertRowid) as { content: string }
    expect(entry.content).toBe(xssContent)
  })
})

describe('Multiple XSS payloads in same row', () => {
  it('stores different XSS payloads across multiple columns', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { columnCount: 3, rowCount: 1 })
    const payloads = [
      '<script>alert(1)</script>',
      '<img onerror=alert(2) src=x>',
      'javascript:void(0)',
    ]

    for (let i = 0; i < 3; i++) {
      t.db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(rowIds[0], columnIds[i], payloads[i])
    }

    for (let i = 0; i < 3; i++) {
      const cell = t.db.prepare(
        'SELECT value FROM cells WHERE row_id = ? AND column_id = ?'
      ).get(rowIds[0], columnIds[i]) as { value: string }
      expect(cell.value).toBe(payloads[i])
    }
  })
})
