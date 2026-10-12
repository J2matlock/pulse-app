---
name: new-migration
description: Add a SQLite schema migration to Pulse correctly — numbered file, idempotent DDL, schema_version bump, registration in migration-list.ts and the test helper, and upgrade tests.
---

# New migration — Pulse

Current latest: check the last entry of `MIGRATIONS` in `src/main/migration-list.ts`. It was 049 as of 2026-10-12.

1. Create `src/main/migrations/NNN_short_name.ts` (zero-padded, next number):
   ```ts
   import type { Database } from 'better-sqlite3'

   export function up(db: Database): void {
     // ALTER TABLE has no IF NOT EXISTS — guard it
     const cols = db.prepare("SELECT name FROM pragma_table_info('rows')").all() as { name: string }[]
     if (!cols.some(c => c.name === 'new_col')) {
       db.exec('ALTER TABLE rows ADD COLUMN new_col TEXT')
     }
     db.exec('CREATE INDEX IF NOT EXISTS idx_rows_new_col ON rows(new_col)')

     db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', 'NNN')").run()
   }
   ```
   - The migration runs inside a transaction. Add `noTransaction: true` only for VACUUM, and understand that it cannot roll back.
   - **Rebuilding a table other tables point to** (rows, grids, columns, case_log, contacts, …) needs `rebuild: true`. Foreign keys are on and can't be turned off inside a transaction, so a plain `DROP TABLE rows` cascades and deletes every cell, note and file link. With `rebuild: true` the runner (`applyMigration` in `src/main/migration-list.ts`) turns foreign keys off around the transaction, runs `PRAGMA foreign_key_check` before commit (any problem rolls the whole migration back), and turns them back on afterwards.
     - Use SQLite's order: `CREATE TABLE x_new` → `INSERT INTO x_new SELECT … FROM x` → `DROP TABLE x` → `ALTER TABLE x_new RENAME TO x`, then recreate x's indexes and triggers. Don't rename the old table first: that rewrites the child tables' foreign keys to point at the old name.
     - Triggers and views on *other* tables that mention x (e.g. `trg_display_name_upsert` on cells mentions rows) make the rename fail with "no such table". Save their SQL from `sqlite_master`, drop them before the rebuild, and recreate them at the end. `tests/database-open.test.ts` has a worked example that rebuilds `rows`.
     - Keep the same primary key values when copying, or the children will point at missing rows and the check will refuse to commit.
     - `rebuild` and `noTransaction` can't be combined. Rebuilding only child tables (like 014) doesn't need it.
   - Every statement must be safe to re-run: `IF NOT EXISTS`, table_info guards, and `INSERT OR IGNORE` backfills.
   - Never drop user data without a backfill path. `runPreMigrationBackup` runs before migrations, but restoring from it is a manual step for the user.
2. Register it in `src/main/migration-list.ts`: add the import and `{ version: NNN, up: migrationNNN }` (plus `rebuild: true` if it rebuilds a parent table).
3. `tests/helpers.ts` reads the same list, so `allMigrations` and `LATEST_SCHEMA_VERSION` follow automatically.
4. Add tests to `tests/migrations.test.ts`: fresh DB → latest; previous version → latest with data preserved; running twice is a no-op.
5. If the new column or table is reachable from renderer code, update `src/shared/types.ts` and search every exhaustive `Record`/switch that needs it.
6. Run `/verify`. The post-edit hook rejects migrations that never write `schema_version`.
