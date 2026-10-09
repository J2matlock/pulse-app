import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  db.exec(`
    -- App metadata and migration tracking
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Grid configurations
    CREATE TABLE IF NOT EXISTS grids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'My Caseload',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      theme_config TEXT DEFAULT '{}',
      sort_config TEXT DEFAULT '[]',
      filter_config TEXT DEFAULT '[]',
      column_order TEXT DEFAULT '[]',
      frozen_columns INTEGER DEFAULT 1,
      row_height TEXT DEFAULT 'comfortable',
      show_gridlines INTEGER DEFAULT 1,
      show_row_numbers INTEGER DEFAULT 1,
      show_alternating_rows INTEGER DEFAULT 1,
      default_sort_column_id INTEGER,
      default_sort_direction TEXT DEFAULT 'asc',
      is_active INTEGER DEFAULT 1
    );

    -- Column definitions (flexible schema)
    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      column_type TEXT NOT NULL DEFAULT 'text',
      width INTEGER DEFAULT 150,
      position INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      is_required INTEGER DEFAULT 0,
      is_identifier INTEGER DEFAULT 0,
      is_name_column INTEGER DEFAULT 0,
      default_value TEXT,
      description TEXT,
      config TEXT DEFAULT '{}',
      conditional_format TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_columns_grid ON columns(grid_id);

    -- Client/case rows
    CREATE TABLE IF NOT EXISTS rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_starred INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT,
      archived_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rows_grid ON rows(grid_id);
    CREATE INDEX IF NOT EXISTS idx_rows_active ON rows(grid_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_rows_starred ON rows(grid_id, is_starred) WHERE is_starred = 1;

    -- Cell values (EAV)
    CREATE TABLE IF NOT EXISTS cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(row_id, column_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cells_row ON cells(row_id);
    CREATE INDEX IF NOT EXISTS idx_cells_column ON cells(column_id);
    CREATE INDEX IF NOT EXISTS idx_cells_value ON cells(column_id, value);

    -- Cell history (audit trail)
    CREATE TABLE IF NOT EXISTS cell_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cell_id INTEGER NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      row_id INTEGER NOT NULL,
      column_id INTEGER NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cell_history_cell ON cell_history(cell_id);
    CREATE INDEX IF NOT EXISTS idx_cell_history_row ON cell_history(row_id);
    CREATE INDEX IF NOT EXISTS idx_cell_history_date ON cell_history(changed_at);

    -- Alert rules (attached to date columns)
    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      is_system INTEGER DEFAULT 0,
      thresholds TEXT NOT NULL,
      cycle_days INTEGER,
      notify_on_open INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Checklist items (per-client tasks)
    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      is_completed INTEGER DEFAULT 0,
      due_date TEXT,
      completed_at TEXT,
      completed_by TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      priority TEXT DEFAULT 'normal',
      is_archived INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      template_source_id INTEGER,
      recurrence_rule TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_checklist_row ON checklist_items(row_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_due ON checklist_items(due_date)
      WHERE due_date IS NOT NULL AND is_completed = 0;

    -- Case log entries
    CREATE TABLE IF NOT EXISTS case_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      log_type TEXT DEFAULT 'note',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_pinned INTEGER DEFAULT 0,
      follow_up_date TEXT,
      follow_up_completed INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_case_log_row ON case_log(row_id);
    CREATE INDEX IF NOT EXISTS idx_case_log_date ON case_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_case_log_followup ON case_log(follow_up_date)
      WHERE follow_up_date IS NOT NULL AND follow_up_completed = 0;

    -- Scrap notes (one per client)
    CREATE TABLE IF NOT EXISTS scrap_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      content TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(row_id)
    );

    -- Document references
    CREATE TABLE IF NOT EXISTS document_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      relative_path TEXT,
      description TEXT,
      category TEXT,
      file_size INTEGER,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_document_refs_row ON document_refs(row_id);

    -- Checklist templates
    CREATE TABLE IF NOT EXISTS checklist_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      items TEXT NOT NULL,
      is_recurring INTEGER DEFAULT 0,
      recurrence_days INTEGER,
      is_system INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Setup templates (full grid config snapshots)
    CREATE TABLE IF NOT EXISTS setup_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      template_data TEXT NOT NULL,
      profession_tags TEXT DEFAULT '[]',
      is_system INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tags (per-grid)
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6b7280',
      UNIQUE(grid_id, name)
    );

    CREATE TABLE IF NOT EXISTS row_tags (
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (row_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_row_tags_tag ON row_tags(tag_id);

    -- Saved filter presets
    CREATE TABLE IF NOT EXISTS saved_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      filter_config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Saved views
    CREATE TABLE IF NOT EXISTS saved_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Snippets / text expander
    CREATE TABLE IF NOT EXISTS snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_text TEXT NOT NULL UNIQUE,
      expansion TEXT NOT NULL,
      category TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Letter / document templates
    CREATE TABLE IF NOT EXISTS letter_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      is_system INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Undo/redo action log
    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      previous_state TEXT,
      new_state TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      session_id TEXT NOT NULL,
      is_undone INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_action_log_session ON action_log(session_id, created_at);

    -- App settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Caseload-level tasks
    CREATE TABLE IF NOT EXISTS caseload_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER REFERENCES grids(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'normal',
      category TEXT,
      due_date TEXT,
      recurrence_rule TEXT,
      is_completed INTEGER DEFAULT 0,
      completed_at TEXT,
      snoozed_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_caseload_tasks_due ON caseload_tasks(due_date)
      WHERE is_completed = 0;
    CREATE INDEX IF NOT EXISTS idx_caseload_tasks_grid ON caseload_tasks(grid_id);

    -- Caseload task history (audit for recurring tasks)
    CREATE TABLE IF NOT EXISTS caseload_task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES caseload_tasks(id) ON DELETE CASCADE,
      completed_at TEXT NOT NULL,
      cycle_number INTEGER,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_caseload_task_history_task ON caseload_task_history(task_id);
  `)

  // Record schema version
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '1')").run()
}

export function down(db: Database): void {
  // Drop all tables in reverse dependency order
  db.exec(`
    DROP TABLE IF EXISTS caseload_task_history;
    DROP TABLE IF EXISTS caseload_tasks;
    DROP TABLE IF EXISTS settings;
    DROP TABLE IF EXISTS action_log;
    DROP TABLE IF EXISTS letter_templates;
    DROP TABLE IF EXISTS snippets;
    DROP TABLE IF EXISTS saved_views;
    DROP TABLE IF EXISTS saved_filters;
    DROP TABLE IF EXISTS row_tags;
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS setup_templates;
    DROP TABLE IF EXISTS checklist_templates;
    DROP TABLE IF EXISTS document_refs;
    DROP TABLE IF EXISTS scrap_notes;
    DROP TABLE IF EXISTS case_log;
    DROP TABLE IF EXISTS checklist_items;
    DROP TABLE IF EXISTS alert_rules;
    DROP TABLE IF EXISTS cell_history;
    DROP TABLE IF EXISTS cells;
    DROP TABLE IF EXISTS rows;
    DROP TABLE IF EXISTS columns;
    DROP TABLE IF EXISTS grids;
    DROP TABLE IF EXISTS app_meta;
  `)
}
