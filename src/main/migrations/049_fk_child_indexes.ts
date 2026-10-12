import type { Database } from 'better-sqlite3'

/**
 * Migration 049: indexes for lookups by a foreign key that no index led with
 * (audit A22-07, A22-08; sweep plan 3.2 target 5).
 *
 * - record_links: deleting a record cascades to its links by from_row_id and
 *   by to_row_id, but both existing indexes lead with link_type_id, so every
 *   deleted record scanned the links twice (Empty Trash, purging a list).
 * - cell_history(column_id, row_id, id): the calendar rule's previous value
 *   and the meter's first reading look up a column's history per record; with
 *   only (row_id, column_id, …) that was a scan of all field history on every
 *   deadline load (dashboard, briefing, grid).
 * - column_id on the per-cell tables: deleting a column cascades to them by
 *   column_id, and deadline_progress / deadline_done are also read by column.
 *
 * Only indexes: nothing stored changes, and a downgrade ignores them.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_record_links_from_row ON record_links(from_row_id);
    CREATE INDEX IF NOT EXISTS idx_record_links_to_row ON record_links(to_row_id);
    CREATE INDEX IF NOT EXISTS idx_cell_history_col_row ON cell_history(column_id, row_id, id);
    CREATE INDEX IF NOT EXISTS idx_cell_formats_column ON cell_formats(column_id);
    CREATE INDEX IF NOT EXISTS idx_deadline_progress_column ON deadline_progress(column_id);
    CREATE INDEX IF NOT EXISTS idx_deadline_extensions_column ON deadline_extensions(column_id);
    CREATE INDEX IF NOT EXISTS idx_deadline_done_column ON deadline_done(column_id);
    CREATE INDEX IF NOT EXISTS idx_parked_cells_column ON parked_cells(column_id);
    CREATE INDEX IF NOT EXISTS idx_note_date_moves_column ON note_date_moves(column_id);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '49')").run()
}
