/**
 * migration-list.ts — the ordered list of schema migrations.
 *
 * The single source of truth: database.ts runs it and tests/helpers.ts builds
 * test databases from it, so a migration can't be registered in one and not the
 * other. Only imports the migration files, so tests can load it without Electron.
 */
import type { Database as BetterSqlite3DB } from 'better-sqlite3'
import { removeOrphansBefore014 } from './migration-fixups'
import { up as migration001 } from './migrations/001_initial_schema'
import { up as migration002 } from './migrations/002_cell_formats'
import { up as migration003 } from './migrations/003_alert_interval'
import { up as migration004 } from './migrations/004_cond_format_rules'
import { up as migration005 } from './migrations/005_grid_position'
import { up as migration006 } from './migrations/006_contacts'
import { up as migration007 } from './migrations/007_task_position'
import { up as migration008 } from './migrations/008_manual_contacts'
import { up as migration009 } from './migrations/009_case_log_edit_history'
import { up as migration010 } from './migrations/010_case_log_void'
import { up as migration011 } from './migrations/011_acuity'
import { up as migration012 } from './migrations/012_soft_delete'
import { up as migration013 } from './migrations/013_perf_indexes'
import { up as migration014 } from './migrations/014_fk_constraints'
import { up as migration015 } from './migrations/015_perf_compound_indexes'
import { up as migration016 } from './migrations/016_perf_phase2'
import { up as migration017 } from './migrations/017_perf_phase3'
import { up as migration018 } from './migrations/018_perf_phase4'
import { up as migration019 } from './migrations/019_perf_phase5'
import { up as migration020 } from './migrations/020_perf_phase6'
import { up as migration021 } from './migrations/021_perf_phase7'
import { up as migration022 } from './migrations/022_dashboard_indexes'
import { up as migration023 } from './migrations/023_provider_link_index'
import { up as migration024 } from './migrations/024_fix_display_name'
import { up as migration025 } from './migrations/025_dashboard_perf_indexes'
import { up as migration026 } from './migrations/026_dashboard_completion_index'
import { up as migration027 } from './migrations/027_document_storage'
import { up as migration028 } from './migrations/028_checklist_groups'
import { up as migration029 } from './migrations/029_reference_board'
import { up as migration030 } from './migrations/030_task_groups'
import { up as migration031 } from './migrations/031_remove_docs_and_refboard'
import { up as migration032 } from './migrations/032_case_log_edits'
import { up as migration033 } from './migrations/033_rule_calendar_intervals'
import { up as migration034 } from './migrations/034_contact_requirements'
import { up as migration035 } from './migrations/035_case_log_time_mileage'
import { up as migration036 } from './migrations/036_workspace'
import { up as migration037 } from './migrations/037_activity_types'
import { up as migration038 } from './migrations/038_deadline_engine'
import { up as migration039 } from './migrations/039_links'
import { up as migration040 } from './migrations/040_appointments'
import { up as migration041 } from './migrations/041_forms'
import { up as migration042 } from './migrations/042_attachments'
import { up as migration043 } from './migrations/043_report_definitions'
import { up as migration044 } from './migrations/044_note_occurred_at'
import { up as migration045 } from './migrations/045_list_trash'
import { up as migration046 } from './migrations/046_deadline_done'
import { up as migration047 } from './migrations/047_sample_rows'
import { up as migration048 } from './migrations/048_appointment_note_index'
import { up as migration049 } from './migrations/049_fk_child_indexes'

export interface Migration {
  version: number
  up: (db: BetterSqlite3DB) => void
  /** Runs outside a transaction (VACUUM can't run inside one) and so can't be rolled back */
  noTransaction?: boolean
  /**
   * Rebuilds a table other tables point to (SQLite's create-new / copy / drop /
   * rename procedure). With foreign keys on, DROP TABLE on a parent cascades and
   * deletes every child row, so foreign keys are turned off around the
   * transaction and checked with foreign_key_check before commit (AUDIT-107).
   */
  rebuild?: boolean
}

/**
 * Run one migration the way its flags ask. Shared by the app's runner and the
 * tests, so a rebuild migration is tested exactly as it will run.
 */
export function applyMigration(db: BetterSqlite3DB, migration: Migration): void {
  if (migration.noTransaction && migration.rebuild) {
    throw new Error(`Migration ${migration.version} can't be both noTransaction and rebuild`)
  }
  if (migration.noTransaction) {
    // WARNING: can't be rolled back; if it fails partway the DB may be inconsistent
    migration.up(db)
    return
  }
  if (!migration.rebuild) {
    db.transaction(() => migration.up(db))()
    return
  }
  // foreign_keys can't be changed inside a transaction, so this goes first
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      migration.up(db)
      // Nothing is checked while foreign keys are off: refuse to commit broken links
      const problems = db.pragma('foreign_key_check') as Array<{ table: string; parent: string }>
      if (problems.length > 0) {
        const first = problems[0]
        throw new Error(
          `Migration ${migration.version} left ${problems.length} row(s) pointing at missing rows` +
          (first ? ` (first: ${first.table} → ${first.parent})` : '')
        )
      }
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

// IMPORTANT: Every migration MUST end by writing app_meta.schema_version.
// Without it, the migration re-runs on next launch and ALTER TABLE / CREATE TABLE
// statements fail on the second run, which kills openDatabase() and makes the app
// appear to reject the user's password. (See migration 030 incident.)
// Also: ALTER TABLE ADD COLUMN has no IF NOT EXISTS — guard with pragma_table_info.
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, up: migration001 },
  { version: 2, up: migration002 },
  { version: 3, up: migration003 },
  { version: 4, up: migration004 },
  { version: 5, up: migration005 },
  { version: 6, up: migration006 },
  { version: 7, up: migration007 },
  { version: 8, up: migration008 },
  { version: 9, up: migration009 },
  { version: 10, up: migration010 },
  { version: 11, up: migration011 },
  { version: 12, up: migration012 },
  { version: 13, up: migration013 },
  // 014 can't be edited; the fix-up clears rows its foreign keys would reject
  { version: 14, up: db => { removeOrphansBefore014(db); migration014(db) } },
  { version: 15, up: migration015 },
  { version: 16, up: migration016, noTransaction: true },  // contains VACUUM
  { version: 17, up: migration017 },
  { version: 18, up: migration018 },
  { version: 19, up: migration019 },
  { version: 20, up: migration020 },
  { version: 21, up: migration021 },
  { version: 22, up: migration022 },
  { version: 23, up: migration023 },
  { version: 24, up: migration024 },
  { version: 25, up: migration025 },
  { version: 26, up: migration026 },
  { version: 27, up: migration027 },
  { version: 28, up: migration028 },
  { version: 29, up: migration029 },
  { version: 30, up: migration030 },
  { version: 31, up: migration031 },
  { version: 32, up: migration032 },
  { version: 33, up: migration033 },
  { version: 34, up: migration034 },
  { version: 35, up: migration035 },
  { version: 36, up: migration036 },
  { version: 37, up: migration037 },
  { version: 38, up: migration038 },
  { version: 39, up: migration039 },
  { version: 40, up: migration040 },
  { version: 41, up: migration041 },
  { version: 42, up: migration042 },
  { version: 43, up: migration043 },
  { version: 44, up: migration044 },
  { version: 45, up: migration045 },
  { version: 46, up: migration046 },
  { version: 47, up: migration047 },
  { version: 48, up: migration048 },
  { version: 49, up: migration049 },
]
