import type { Database } from 'better-sqlite3'

/**
 * Migration 050: remove repeating-appointment series whose record was deleted for good (P-005).
 *
 * A series keeps its record id only inside its template (no foreign key), with
 * the appointment title, location and notes. Before F-042, deleting a record for
 * good left its series behind until the series was next filled in, up to about
 * two years later. Purges now take the series with them; this removes the ones
 * already left over. A record in the Trash is still in `rows`, so its series
 * stays for a restore; series not tied to a record (no row_id) are kept. The
 * appointments those series made already went with the record (ON DELETE CASCADE).
 */
export function up(db: Database): void {
  db.exec(`DELETE FROM appointment_series
    WHERE json_extract(template, '$.row_id') IS NOT NULL
      AND json_extract(template, '$.row_id') NOT IN (SELECT id FROM rows)`)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '50')").run()
}
