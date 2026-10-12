import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  // ── 1. Materialized display_name on rows ──────────────────────────────────
  // Eliminates the correlated fullNameSubquery from 9+ query sites.
  // Maintained by triggers on cell INSERT/UPDATE/DELETE.

  // Idempotency guard: skip if column already exists (e.g., re-running migrations after restore)
  const cols = db.prepare("PRAGMA table_info('rows')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'display_name')) {
    db.exec(`ALTER TABLE rows ADD COLUMN display_name TEXT DEFAULT '(unnamed)'`)
  }

  // Backfill display_name for existing rows
  db.exec(`
    UPDATE rows SET display_name = COALESCE(
      (SELECT
        CASE WHEN last_c.value IS NOT NULL AND last_c.value != ''
          THEN COALESCE(fn_c.value, '') || ' ' || last_c.value
          ELSE fn_c.value
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

  // Trigger: update display_name when a cell in a name column is inserted or updated
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_display_name_upsert
    AFTER INSERT ON cells
    WHEN EXISTS (SELECT 1 FROM columns WHERE id = NEW.column_id AND (
      is_name_column = 1 OR LOWER(TRIM(name)) IN ('last','last name','lastname','surname','family name','lname')
    ))
    BEGIN
      UPDATE rows SET display_name = COALESCE(
        (SELECT
          CASE WHEN last_c.value IS NOT NULL AND last_c.value != ''
            THEN COALESCE(fn_c.value, '') || ' ' || last_c.value
            ELSE fn_c.value
          END
         FROM cells fn_c
         JOIN columns fn_col ON fn_col.id = fn_c.column_id
           AND fn_col.grid_id = rows.grid_id AND fn_col.is_name_column = 1
         LEFT JOIN columns last_col ON last_col.grid_id = rows.grid_id
           AND last_col.id != fn_col.id AND last_col.is_visible = 1
           AND LOWER(TRIM(last_col.name)) IN ('last','last name','lastname','surname','family name','lname')
         LEFT JOIN cells last_c ON last_c.row_id = NEW.row_id AND last_c.column_id = last_col.id
         WHERE fn_c.row_id = NEW.row_id
         LIMIT 1),
        '(unnamed)')
      WHERE id = NEW.row_id;
    END
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_display_name_update
    AFTER UPDATE OF value ON cells
    WHEN EXISTS (SELECT 1 FROM columns WHERE id = NEW.column_id AND (
      is_name_column = 1 OR LOWER(TRIM(name)) IN ('last','last name','lastname','surname','family name','lname')
    ))
    BEGIN
      UPDATE rows SET display_name = COALESCE(
        (SELECT
          CASE WHEN last_c.value IS NOT NULL AND last_c.value != ''
            THEN COALESCE(fn_c.value, '') || ' ' || last_c.value
            ELSE fn_c.value
          END
         FROM cells fn_c
         JOIN columns fn_col ON fn_col.id = fn_c.column_id
           AND fn_col.grid_id = rows.grid_id AND fn_col.is_name_column = 1
         LEFT JOIN columns last_col ON last_col.grid_id = rows.grid_id
           AND last_col.id != fn_col.id AND last_col.is_visible = 1
           AND LOWER(TRIM(last_col.name)) IN ('last','last name','lastname','surname','family name','lname')
         LEFT JOIN cells last_c ON last_c.row_id = NEW.row_id AND last_c.column_id = last_col.id
         WHERE fn_c.row_id = NEW.row_id
         LIMIT 1),
        '(unnamed)')
      WHERE id = NEW.row_id;
    END
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_display_name_delete
    AFTER DELETE ON cells
    WHEN EXISTS (SELECT 1 FROM columns WHERE id = OLD.column_id AND (
      is_name_column = 1 OR LOWER(TRIM(name)) IN ('last','last name','lastname','surname','family name','lname')
    ))
    BEGIN
      UPDATE rows SET display_name = COALESCE(
        (SELECT
          CASE WHEN last_c.value IS NOT NULL AND last_c.value != ''
            THEN COALESCE(fn_c.value, '') || ' ' || last_c.value
            ELSE fn_c.value
          END
         FROM cells fn_c
         JOIN columns fn_col ON fn_col.id = fn_c.column_id
           AND fn_col.grid_id = rows.grid_id AND fn_col.is_name_column = 1
         LEFT JOIN columns last_col ON last_col.grid_id = rows.grid_id
           AND last_col.id != fn_col.id AND last_col.is_visible = 1
           AND LOWER(TRIM(last_col.name)) IN ('last','last name','lastname','surname','family name','lname')
         LEFT JOIN cells last_c ON last_c.row_id = OLD.row_id AND last_c.column_id = last_col.id
         WHERE fn_c.row_id = OLD.row_id
         LIMIT 1),
        '(unnamed)')
      WHERE id = OLD.row_id;
    END
  `)

  // Also trigger when is_name_column flag changes on a column
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_display_name_col_change
    AFTER UPDATE OF is_name_column, name ON columns
    BEGIN
      UPDATE rows SET display_name = COALESCE(
        (SELECT
          CASE WHEN last_c.value IS NOT NULL AND last_c.value != ''
            THEN COALESCE(fn_c.value, '') || ' ' || last_c.value
            ELSE fn_c.value
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
      WHERE grid_id = NEW.grid_id;
    END
  `)

  // ── 2. Compound indexes for DASHBOARD_GET_COMPLETED ────────────────────────
  db.exec(`CREATE INDEX IF NOT EXISTS idx_checklist_completed
    ON checklist_items(is_completed, completed_at) WHERE is_completed = 1`)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_case_log_voided_type
    ON case_log(log_type, voided_at, created_at)`)

  // ── 3. Extended follow-up index including voided_at ─────────────────────────
  // The existing idx_case_log_followup doesn't cover the voided_at check
  db.exec(`CREATE INDEX IF NOT EXISTS idx_case_log_followup_v2
    ON case_log(follow_up_date, follow_up_completed, voided_at)
    WHERE follow_up_date IS NOT NULL AND follow_up_completed = 0 AND voided_at IS NULL`)

  // ── 4. Index for display_name sorting ──────────────────────────────────────
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rows_display_name
    ON rows(display_name)`)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '17')").run()
}
