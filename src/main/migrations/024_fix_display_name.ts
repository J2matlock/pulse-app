import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Re-backfill display_name for all rows — previous import backfill only used the
  // first-name column and overwrote the trigger's correct first+last concatenation.
  db.exec(`
    UPDATE rows SET display_name = COALESCE(
      (SELECT
        CASE WHEN last_c.value IS NOT NULL AND TRIM(last_c.value) != ''
          THEN TRIM(COALESCE(fn_c.value, '')) || ' ' || TRIM(last_c.value)
          ELSE TRIM(fn_c.value)
        END
       FROM cells fn_c
       JOIN columns fn_col ON fn_col.id = fn_c.column_id
         AND fn_col.grid_id = rows.grid_id AND fn_col.is_name_column = 1
       LEFT JOIN columns last_col ON last_col.grid_id = rows.grid_id
         AND last_col.id != fn_col.id AND last_col.is_visible = 1
         AND LOWER(TRIM(last_col.name)) IN ('last','last name','lastname','surname','family name','lname')
       LEFT JOIN cells last_c ON last_c.row_id = rows.id AND last_c.column_id = last_col.id
       WHERE fn_c.row_id = rows.id
       LIMIT 1),
      '(unnamed)')
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '24')").run()
}
