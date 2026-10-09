import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES provider_categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      org_name TEXT,
      title TEXT,
      phone_main TEXT,
      phone_direct TEXT,
      phone_fax TEXT,
      phone_cell TEXT,
      phone_after_hours TEXT,
      email TEXT,
      website TEXT,
      address TEXT,
      hours TEXT,
      languages TEXT,
      availability_status TEXT NOT NULL DEFAULT 'unknown',
      availability_notes TEXT,
      availability_checked_at TEXT,
      referral_process TEXT,
      notes TEXT,
      is_starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS provider_tags (
      provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (provider_id, tag)
    );

    CREATE TABLE IF NOT EXISTS provider_client_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      row_id INTEGER NOT NULL,
      grid_id INTEGER NOT NULL,
      linked_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      contact_type TEXT NOT NULL DEFAULT 'note',
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_custom_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES provider_categories(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS provider_custom_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      custom_field_id INTEGER NOT NULL REFERENCES provider_custom_fields(id) ON DELETE CASCADE,
      value TEXT,
      UNIQUE(provider_id, custom_field_id)
    );

    CREATE INDEX IF NOT EXISTS idx_providers_category ON providers(category_id);
    CREATE INDEX IF NOT EXISTS idx_providers_starred ON providers(is_starred);
    CREATE INDEX IF NOT EXISTS idx_providers_availability ON providers(availability_status);
    CREATE INDEX IF NOT EXISTS idx_provider_client_links_row ON provider_client_links(row_id);
    CREATE INDEX IF NOT EXISTS idx_provider_interactions_provider ON provider_interactions(provider_id);
    CREATE INDEX IF NOT EXISTS idx_provider_custom_values_provider ON provider_custom_values(provider_id);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '6')").run()
}
