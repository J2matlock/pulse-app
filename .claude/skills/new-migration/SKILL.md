---
name: new-migration
description: Add a SQLite schema migration to Pulse correctly — numbered file, idempotent DDL, schema_version bump, registration in database.ts and the test helper, and upgrade tests.
---

# New migration — Pulse

Current latest: check the last entry of `migrations[]` in `src/main/database.ts`. It was 031 as of 2026-09.

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
   - Every statement must be safe to re-run: `IF NOT EXISTS`, table_info guards, and `INSERT OR IGNORE` backfills.
   - Never drop user data without a backfill path. `runPreMigrationBackup` runs before migrations, but restoring from it is a manual step for the user.
2. Register it in `src/main/database.ts`: add the import and `{ version: NNN, up: migrationNNN }`.
3. Update `tests/helpers.ts`: add it to `allMigrations` and bump `LATEST_SCHEMA_VERSION`.
4. Add tests to `tests/migrations.test.ts`: fresh DB → latest; previous version → latest with data preserved; running twice is a no-op.
5. If the new column or table is reachable from renderer code, update `src/shared/types.ts` and search every exhaustive `Record`/switch that needs it.
6. Run `/verify`. The post-edit hook rejects migrations that never write `schema_version`.
