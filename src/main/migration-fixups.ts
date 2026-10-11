/**
 * migration-fixups.ts — repairs run just before a shipped migration that can't
 * be edited any more (old installs have already run it).
 */
import type { Database as BetterSqlite3DB } from 'better-sqlite3'

/**
 * Before 014: drop format and contact-link rows that point at deleted records.
 *
 * Before v14, cell_formats and provider_client_links had no foreign keys, so
 * deleting a record left its rows behind. 014 copies both tables into new ones
 * that do have foreign keys, with INSERT OR IGNORE meant to skip such rows, but
 * OR IGNORE doesn't apply to foreign keys: one leftover row failed the whole
 * upgrade, and the app looked like it rejected the password (AUDIT-016).
 * These rows belong to nothing and could never be shown, so removing them loses nothing.
 */
export function removeOrphansBefore014(db: BetterSqlite3DB): void {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  if (row && parseInt(row.value, 10) >= 14) return

  const columnsOf = (table: string): string[] =>
    (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Array<{ name: string }>).map(c => c.name)

  const cf = columnsOf('cell_formats')
  if (cf.includes('row_id') && cf.includes('column_id')) {
    db.exec(`DELETE FROM cell_formats
      WHERE row_id NOT IN (SELECT id FROM rows) OR column_id NOT IN (SELECT id FROM columns)`)
  }

  const pcl = columnsOf('provider_client_links')
  if (pcl.includes('row_id') && pcl.includes('grid_id') && pcl.includes('provider_id')) {
    db.exec(`DELETE FROM provider_client_links
      WHERE row_id NOT IN (SELECT id FROM rows)
         OR grid_id NOT IN (SELECT id FROM grids)
         OR provider_id NOT IN (SELECT id FROM providers)`)
  }
}
