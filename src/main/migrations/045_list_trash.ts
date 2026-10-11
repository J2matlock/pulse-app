import type { Database } from 'better-sqlite3'

/**
 * Nothing is lost by moving or deleting (audit 2026-10, Decision D1).
 *
 * - parked_cells: when a record moves to a list without a matching column,
 *   the value (and its edit history) waits here, keyed to its old column,
 *   and comes back if the record moves back (items 1.11 / G-18 / L-11).
 * - deleted_columns: a deleted column's settings and every value in it, as
 *   JSON, restorable for 30 days (item 5.2).
 * - "Highlight all rows" used to copy a rule onto every record (L-19). Copies
 *   that cover most of a list become one column rule, so new records get it
 *   too; a few copies (a highlight on chosen records) stay per cell.
 * - grids.deleted_at / deleted_snapshot: a deleted list waits in the Trash
 *   for 30 days with a copy of its links (item 5.2). Lists deleted before
 *   this version get their 30 days from now.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parked_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      value TEXT,
      history TEXT,
      parked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (row_id, column_id)
    );
    CREATE INDEX IF NOT EXISTS idx_parked_cells_row ON parked_cells(row_id);

    CREATE TABLE IF NOT EXISTS deleted_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      column_type TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_deleted_columns_grid ON deleted_columns(grid_id);
  `)

  const gridCols = db.prepare("SELECT name FROM pragma_table_info('grids')").all() as { name: string }[]
  if (!gridCols.some(c => c.name === 'deleted_at')) {
    db.exec('ALTER TABLE grids ADD COLUMN deleted_at TEXT')
    db.exec("UPDATE grids SET deleted_at = datetime('now') WHERE is_active = 0")
  }
  if (!gridCols.some(c => c.name === 'deleted_snapshot')) {
    db.exec('ALTER TABLE grids ADD COLUMN deleted_snapshot TEXT')
  }

  migrateStampedHighlights(db)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '45')").run()
}

type Rule = Record<string, unknown> & { originRowId?: number }

function migrateStampedHighlights(db: Database): void {
  const formats = db.prepare(`SELECT cf.row_id, cf.column_id, cf.rules, r.grid_id FROM cell_formats cf JOIN rows r ON r.id = cf.row_id`).all() as
    Array<{ row_id: number; column_id: number; rules: string; grid_id: number }>
  // column → (one copy's key) → the records carrying it and the rules
  const groups = new Map<number, Map<string, { gridId: number; rows: Set<number>; rules: Rule[] }>>()
  for (const f of formats) {
    let rules: Rule[]
    try { rules = JSON.parse(f.rules) as Rule[] } catch { continue }
    if (!Array.isArray(rules)) continue
    const stamped = rules.filter(r => r && typeof r === 'object' && r.originRowId != null)
    if (!stamped.length) continue
    const key = JSON.stringify(stamped)
    const byKey = groups.get(f.column_id) ?? new Map()
    const g = byKey.get(key) ?? { gridId: f.grid_id, rows: new Set<number>(), rules: stamped }
    g.rows.add(f.row_id)
    byKey.set(key, g)
    groups.set(f.column_id, byKey)
  }
  const listSize = db.prepare('SELECT COUNT(*) AS n FROM rows WHERE grid_id = ? AND deleted_at IS NULL')
  const colFmt = db.prepare('SELECT conditional_format FROM columns WHERE id = ?')
  const saveCol = db.prepare('UPDATE columns SET conditional_format = ? WHERE id = ?')
  const getCell = db.prepare('SELECT rules FROM cell_formats WHERE row_id = ? AND column_id = ?')
  const setCell = db.prepare('UPDATE cell_formats SET rules = ? WHERE row_id = ? AND column_id = ?')
  const delCell = db.prepare('DELETE FROM cell_formats WHERE row_id = ? AND column_id = ?')
  for (const [columnId, byKey] of groups) {
    for (const [key, g] of byKey) {
      const n = (listSize.get(g.gridId) as { n: number }).n
      if (g.rows.size < 2 || g.rows.size * 2 < n) continue
      const col = colFmt.get(columnId) as { conditional_format: string | null } | undefined
      if (!col) continue
      let current: Rule[] = []
      try { current = JSON.parse(col.conditional_format || '[]') as Rule[] } catch { current = [] }
      if (!Array.isArray(current)) current = []
      const seen = new Set(current.map(r => JSON.stringify(r)))
      for (const r of g.rules) {
        const { originRowId: _origin, ...clean } = r
        void _origin
        if (!seen.has(JSON.stringify(clean))) { current.push(clean); seen.add(JSON.stringify(clean)) }
      }
      saveCol.run(JSON.stringify(current), columnId)
      for (const rowId of g.rows) {
        const cell = getCell.get(rowId, columnId) as { rules: string } | undefined
        if (!cell) continue
        let rules: Rule[] = []
        try { rules = JSON.parse(cell.rules) as Rule[] } catch { rules = [] }
        const left = rules.filter(r => !(r && r.originRowId != null && key.includes(JSON.stringify(r))))
        if (left.length) setCell.run(JSON.stringify(left), rowId, columnId)
        else delCell.run(rowId, columnId)
      }
    }
  }
}
