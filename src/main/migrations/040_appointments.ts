import type { Database } from 'better-sqlite3'

/**
 * Appointments and recurring series (generalization W07 §2).
 *
 * Times are local wall time with no zone ('YYYY-MM-DDTHH:MM', or
 * 'YYYY-MM-DD' for all-day): one person in one place, so this avoids every
 * daylight-saving bug of UTC round trips. A series' occurrences are real
 * rows for the months ahead (materialized_until); series_date is the date an
 * occurrence was made for, so a moved or deleted one isn't made again.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS appointment_series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule TEXT NOT NULL,
      template TEXT NOT NULL,
      materialized_until TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER REFERENCES rows(id) ON DELETE CASCADE,
      series_id INTEGER REFERENCES appointment_series(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      activity_type_key TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled', 'no_show')),
      case_log_id INTEGER REFERENCES case_log(id) ON DELETE SET NULL,
      notes TEXT,
      is_exception INTEGER NOT NULL DEFAULT 0,
      series_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(start_at);
    CREATE INDEX IF NOT EXISTS idx_appt_row ON appointments(row_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_appt_series ON appointments(series_id, start_at);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '40')").run()
}
