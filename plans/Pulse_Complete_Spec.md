# CASECONNECT PULSE — Complete Technical Specification

## For Claude Code Implementation

**Version:** 3.0 (Combined Final)  
**Date:** February 2026  
**Stack:** Electron + React + TypeScript + SQLite + Tailwind CSS

> **BUILD INSTRUCTIONS**: Build in phase order (Section 12). Each phase produces a working build before proceeding. Favor simplicity and the user's workflow over technical elegance.

---

## 1. Project Overview

CaseConnect Pulse is an offline-first, local-storage desktop application that replaces Excel spreadsheets for caseload management. It targets individual care coordinators, social workers, case managers, special education coordinators, probation officers, therapists, and any professional managing a caseload of people with recurring deadlines.

### Core Philosophy
- **Offline-first**: Zero internet required. Ever. No telemetry, no analytics, no phone-home.
- **Local data**: Single encrypted SQLite database file on the user's machine. Password-protected at rest.
- **Cross-platform**: Single codebase → Windows (.exe), Linux (.AppImage/.deb), macOS (.dmg).
- **Boomer-friendly**: Every feature discoverable without docs. Tooltips, clear labels, obvious buttons. Base font 14-15px minimum. Thick focus rings. Chunky, clickable UI. Descriptive error messages ("Date must be after 1900"), not just red borders.
- **Professional aesthetics**: Clean, confident. Never pure black (#000000) — use slate-900. Designed for meetings.

### Cloud Sync Safety
Users WILL try to put the database in Dropbox/OneDrive/iCloud. This corrupts SQLite.
- **Startup check**: If database path contains "OneDrive", "Dropbox", "Google Drive", or "iCloud", show a warning modal explaining the risk.
- **Pack & Go feature**: Creates a compressed, timestamped snapshot for moving between computers safely (rather than live cloud syncing).

### Ctrl+F Limitation
Virtual scrolling means browser Ctrl+F won't find off-screen rows. The custom search bar in the toolbar IS the search. Consider adding a tooltip on first use: "Use this search bar to find clients — Ctrl+F only searches visible rows."

---

## 2. Tech Stack & Dependencies

```
Core:
- electron (latest stable)
- electron-builder (packaging)
- react 18+
- typescript 5+
- @journeyapps/sqlcipher (SQLCipher-enabled SQLite — drop-in replacement for better-sqlite3 with AES-256 full-database encryption)
- tailwindcss 3+

UI Libraries:
- @tanstack/react-table (headless grid)
- @tanstack/react-virtual (virtual scrolling)
- lucide-react (icons)
- react-router-dom (navigation)
- date-fns (date math)
- zustand (state management)
- react-hot-toast (notifications)
- @dnd-kit/core + @dnd-kit/sortable (drag-and-drop)
- cmdk (command palette)
- tiptap + @tiptap/starter-kit (rich text for notes/case log)

Export/Data:
- papaparse (CSV import/export)
- xlsx (SheetJS — Excel .xlsx/.xls import)
- jspdf + jspdf-autotable (PDF export)
- electron-store (app preferences)
- archiver (backup compression)
```

---

## 3. Project Structure

```
caseconnect-pulse/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── src/
│   ├── main/                          # Electron main process
│   │   ├── index.ts                   # Window creation, app lifecycle
│   │   ├── database.ts                # SQLite init, migrations, connection
│   │   ├── migrations/                # Sequential migration files
│   │   │   ├── 001_initial_schema.ts
│   │   │   └── ...
│   │   ├── ipc-handlers.ts            # All IPC handler registrations
│   │   ├── auth.ts                    # Password hashing, verification, key derivation
│   │   ├── backup.ts                  # Backup/restore logic
│   │   ├── template-io.ts             # Template import/export (.pulse files)
│   │   ├── file-association.ts        # .pulse file association registration + open-file handling
│   │   ├── csv-io.ts                  # CSV import/export
│   │   ├── excel-io.ts                # Excel .xlsx/.xls parsing via SheetJS
│   │   ├── pdf-export.ts              # PDF generation (profiles, grid, supervisor report)
│   │   └── license.ts                 # License key validation (Phase 5)
│   ├── preload/
│   │   └── index.ts                   # contextBridge API
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── stores/
│   │   │   ├── gridStore.ts           # Columns, rows, cells
│   │   │   ├── dashboardStore.ts
│   │   │   ├── profileStore.ts
│   │   │   ├── settingsStore.ts
│   │   │   ├── sortStore.ts
│   │   │   ├── filterStore.ts
│   │   │   ├── selectionStore.ts
│   │   │   ├── authStore.ts           # Lock state, session management
│   │   │   └── uiStore.ts
│   │   ├── views/
│   │   │   ├── GridView.tsx
│   │   │   ├── DashboardView.tsx
│   │   │   ├── ProfileView.tsx
│   │   │   ├── SettingsView.tsx
│   │   │   ├── TemplateManagerView.tsx
│   │   │   ├── OnboardingView.tsx
│   │   │   ├── LockScreenView.tsx         # Password entry on app launch
│   │   │   ├── PasswordSetupView.tsx      # First-time password creation
│   │   │   └── KeyboardShortcutsView.tsx
│   │   ├── components/
│   │   │   ├── grid/
│   │   │   │   ├── DataGrid.tsx
│   │   │   │   ├── GridToolbar.tsx
│   │   │   │   ├── ColumnHeader.tsx
│   │   │   │   ├── SortIndicator.tsx
│   │   │   │   ├── CellRenderer.tsx
│   │   │   │   ├── CellEditor.tsx
│   │   │   │   ├── ColumnConfigModal.tsx
│   │   │   │   ├── FilterPanel.tsx
│   │   │   │   ├── GroupingBar.tsx
│   │   │   │   ├── RowNumberColumn.tsx
│   │   │   │   ├── ConditionalFormatPanel.tsx
│   │   │   │   └── GridStatusFooter.tsx
│   │   │   ├── dashboard/
│   │   │   │   ├── PriorityList.tsx
│   │   │   │   ├── WeekView.tsx
│   │   │   │   ├── MonthView.tsx
│   │   │   │   ├── CaseloadStats.tsx
│   │   │   │   ├── CalendarHeatmap.tsx
│   │   │   │   ├── CompletionChart.tsx
│   │   │   │   └── RecentlyArchived.tsx
│   │   │   ├── profile/
│   │   │   │   ├── ProfileHeader.tsx
│   │   │   │   ├── DeadlinePanel.tsx
│   │   │   │   ├── Checklist.tsx
│   │   │   │   ├── ChecklistItem.tsx
│   │   │   │   ├── ScratchPad.tsx     # tiptap
│   │   │   │   ├── CaseLog.tsx
│   │   │   │   ├── CaseLogEntry.tsx
│   │   │   │   ├── ContactInfo.tsx
│   │   │   │   ├── GridDataSummary.tsx
│   │   │   │   ├── ActivityTimeline.tsx
│   │   │   │   ├── RelatedDocuments.tsx
│   │   │   │   └── ProfilePrintLayout.tsx
│   │   │   ├── alerts/
│   │   │   │   ├── AlertRuleEditor.tsx
│   │   │   │   ├── AlertBadge.tsx
│   │   │   │   ├── AlertPreview.tsx   # Timeline visualization
│   │   │   │   └── AlertRuleTemplates.tsx
│   │   │   ├── templates/
│   │   │   │   ├── TemplateCard.tsx
│   │   │   │   ├── TemplateImport.tsx
│   │   │   │   ├── TemplateExport.tsx
│   │   │   │   └── ChecklistTemplateEditor.tsx
│   │   │   ├── shared/
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── TopBar.tsx
│   │   │   │   ├── CommandPalette.tsx  # Ctrl+K
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── ConfirmDialog.tsx
│   │   │   │   ├── DatePicker.tsx
│   │   │   │   ├── ColorPicker.tsx
│   │   │   │   ├── TagInput.tsx
│   │   │   │   ├── EmptyState.tsx
│   │   │   │   ├── UndoToast.tsx
│   │   │   │   ├── Breadcrumb.tsx
│   │   │   │   ├── ImportWizard.tsx    # Multi-step CSV/Excel import
│   │   │   │   ├── Tooltip.tsx
│   │   │   │   └── LoadingSpinner.tsx
│   │   │   └── onboarding/
│   │   │       ├── WelcomeStep.tsx
│   │   │       ├── TemplatePickerStep.tsx
│   │   │       ├── CustomizeStep.tsx
│   │   │       └── TourOverlay.tsx
│   │   ├── hooks/
│   │   │   ├── useDatabase.ts
│   │   │   ├── useDeadlines.ts
│   │   │   ├── useKeyboardShortcuts.ts
│   │   │   ├── useAutoSave.ts
│   │   │   ├── useUndoRedo.ts
│   │   │   ├── useGridNavigation.ts
│   │   │   ├── useSort.ts
│   │   │   ├── useFilter.ts
│   │   │   ├── useClipboard.ts
│   │   │   ├── useContextMenu.ts
│   │   │   └── usePrint.ts
│   │   ├── utils/
│   │   │   ├── deadlineCalc.ts
│   │   │   ├── exportCSV.ts
│   │   │   ├── exportPDF.ts
│   │   │   ├── templateSchema.ts
│   │   │   ├── search.ts
│   │   │   ├── sorting.ts
│   │   │   ├── filtering.ts
│   │   │   ├── colorUtils.ts
│   │   │   ├── dateUtils.ts
│   │   │   ├── validators.ts
│   │   │   ├── clipboardUtils.ts
│   │   │   └── statisticsCalc.ts
│   │   ├── types/
│   │   │   ├── grid.ts
│   │   │   ├── alerts.ts
│   │   │   ├── checklist.ts
│   │   │   ├── profile.ts
│   │   │   ├── template.ts
│   │   │   ├── sort.ts
│   │   │   ├── filter.ts
│   │   │   └── settings.ts
│   │   └── styles/
│   │       ├── globals.css
│   │       ├── print.css
│   │       ├── animations.css
│   │       └── themes.ts
│   └── shared/
│       ├── ipc-channels.ts
│       ├── schema.ts
│       └── constants.ts
├── resources/
│   ├── icon.png
│   ├── icon.ico
│   └── default-templates/
│       ├── opwdd-care-coordinator.json
│       ├── social-worker-general.json
│       ├── iep-coordinator.json
│       ├── probation-officer.json
│       └── therapist-client-panel.json
└── build/
    └── entitlements.mac.plist
```

---

## 4. Database Schema (SQLite + SQLCipher)

### Design Principles
- INTEGER PRIMARY KEY for auto-increment IDs
- Dates as ISO 8601 text (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
- JSON columns sparingly, only for flexible config blobs
- Foreign keys with CASCADE deletes
- Indexes on frequently queried columns
- WAL mode for better read performance

### Encryption (SQLCipher)
The entire database is encrypted at rest using SQLCipher (AES-256-CBC). This is NOT optional — all user data is always encrypted.

**How it works:**
- On first launch, user sets a password during onboarding
- Password is run through PBKDF2 to derive the SQLCipher encryption key
- The `.db` file on disk is fully encrypted — unreadable without the password
- On every subsequent app launch, user enters password → key is derived → database is unlocked
- If wrong password: database cannot be opened, error shown
- Password hash (for validation only) is stored separately in electron-store (NOT in the encrypted database)

**Key implementation details:**
```typescript
// Opening the database with SQLCipher (key wrapping pattern)
import Database from '@journeyapps/sqlcipher';

// The actual DB encryption key is a random 256-bit key, NOT derived from the password.
// The password (or recovery key) unwraps the DB key from electron-store.
// See "Recovery Key System" below for the full key wrapping architecture.

function openDatabase(dbPath: string, dbKey: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma(`key = '${dbKey}'`);            // Use the unwrapped DB encryption key
  db.pragma('cipher_compatibility = 4');     // SQLCipher v4
  // Test if key is correct by running a simple query
  try {
    db.pragma('schema_version');             // Will throw if wrong key
  } catch (e) {
    throw new Error('Incorrect password');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}

function createDatabase(dbPath: string, dbKey: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma(`key = '${dbKey}'`);
  db.pragma('cipher_compatibility = 4');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  // Run initial schema creation...
  return db;
}
```

**Password storage (electron-store, NOT the database):**
```typescript
// electron-store holds ONLY:
{
  "password_hash": "<bcrypt hash>",       // For quick validation before attempting DB open
  "password_hint": "My cat's name",       // Optional user-set hint
  "auto_lock_minutes": 30,                // Auto-lock after inactivity (0 = disabled, default 30)
  "db_path": "/home/user/.pulse/data.db", // Database file location
  "recovery_key_hash": "<bcrypt hash>"    // Hash of the recovery key (if user generated one)
}
```

### Recovery Key System (Optional Lifeline)

**The problem**: "No recovery by design" is the right security posture, but in practice, social workers set a password six months ago and forget it. Their entire caseload is locked. Backups use the same password. The "write it down" advice is what every service says, and nobody does it.

**The solution**: An optional recovery key — conceptually similar to a BitLocker recovery key. No backdoor, no master password, no server-side recovery. Just a second key that can unlock the database, generated once and printable.

**How it works:**
- During onboarding (Step 2), after setting password: "Would you like to generate a Recovery Key? If you ever forget your password, this key can unlock your data."
- User clicks "Generate Recovery Key"
- App generates a cryptographically random 24-character key (format: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`, alphanumeric, unambiguous charset — no 0/O, 1/l/I)
- App displays the key ONE TIME with prominent instructions: **"Print this or write it down. Store it somewhere safe — NOT on this computer. This key will never be shown again."**
- Buttons: [Print Recovery Key] [Copy to Clipboard] [I've Saved It — Continue]
- Under the hood: the recovery key is run through the same PBKDF2 derivation and stored as an alternative SQLCipher key via `db.pragma("rekey")` — actually, SQLCipher only supports one key. Instead:
  - The actual database encryption key is a random 256-bit key (not derived from the password directly)
  - The user's password derives a key via PBKDF2 that encrypts/wraps the actual DB key, stored in electron-store
  - The recovery key derives a SECOND wrapping key via PBKDF2 that encrypts the same DB key, also stored in electron-store
  - On unlock: either the password OR the recovery key can unwrap the actual DB key → open the database
  - This is the standard "key wrapping" pattern used by BitLocker, FileVault, LUKS, etc.
- The recovery key hash (bcrypt) is stored in electron-store for quick pre-validation
- Recovery key is NOT stored anywhere — only its wrapping output and validation hash

**Lock screen integration:**
- "Forgot Password?" now shows TWO options:
  1. "I have a Recovery Key" → recovery key input field → if valid, unlocks database AND prompts user to set a new password immediately
  2. "I don't have a Recovery Key" → existing message: "Your data is encrypted. Without your password or recovery key, data cannot be recovered. If you have a backup, you can restore from it."

**Settings → Security:**
- "Recovery Key" section:
  - If no key exists: [Generate Recovery Key] button
  - If key exists: "Recovery key is active. You can regenerate it if you've lost it (this invalidates the old key)." [Regenerate Recovery Key] button (requires current password)
  - [Revoke Recovery Key] button (requires current password) — deletes the recovery key wrapping, password-only access

**Implementation notes:**
```typescript
// Key wrapping approach (in src/main/auth.ts):
// 1. Generate random 256-bit DB encryption key
// 2. Derive password wrapping key: PBKDF2(password, salt1) → wrapKey1
// 3. Encrypt DB key with wrapKey1 → store as "wrapped_db_key_password" in electron-store
// 4. If recovery key generated:
//    Derive recovery wrapping key: PBKDF2(recoveryKey, salt2) → wrapKey2
//    Encrypt DB key with wrapKey2 → store as "wrapped_db_key_recovery" in electron-store
// 5. Open database: unwrap DB key with either password or recovery key → db.pragma(`key = '${dbKey}'`)
// 6. Password change: unwrap with old password, re-wrap with new password. Recovery key unaffected.
// 7. Recovery key regeneration: unwrap with password, generate new recovery key, re-wrap with new recovery key.
```

**What this changes from the simpler model:**
- The database key is no longer derived directly from the password — it's a random key wrapped by the password
- This adds complexity but enables both password changes (without re-keying the entire database) and recovery keys
- `db.pragma("rekey")` is no longer needed for password changes — only the wrapping in electron-store changes
- The SQLCipher database itself always uses the same underlying key

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- App metadata and migration tracking
CREATE TABLE app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Grid configurations (supports multiple grids/workspaces)
CREATE TABLE grids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'My Caseload',
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    theme_config TEXT DEFAULT '{}',
    sort_config TEXT DEFAULT '[]',        -- JSON: [{columnId, direction, priority}]
    filter_config TEXT DEFAULT '[]',
    column_order TEXT DEFAULT '[]',       -- JSON: ordered column IDs
    frozen_columns INTEGER DEFAULT 1,
    row_height TEXT DEFAULT 'comfortable', -- compact(36px), comfortable(44px), spacious(52px)
    show_gridlines INTEGER DEFAULT 1,
    show_row_numbers INTEGER DEFAULT 1,
    show_alternating_rows INTEGER DEFAULT 1,
    default_sort_column_id INTEGER,
    default_sort_direction TEXT DEFAULT 'asc',
    is_active INTEGER DEFAULT 1
);

-- Column definitions (flexible schema)
CREATE TABLE columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    column_type TEXT NOT NULL DEFAULT 'text',
    -- Types: text, date, number, checkbox, dropdown, phone, email, tag,
    --        currency, url, notes, status, address, age_from_dob, calculated_days
    width INTEGER DEFAULT 150,
    position INTEGER NOT NULL DEFAULT 0,
    is_visible INTEGER DEFAULT 1,
    is_required INTEGER DEFAULT 0,
    is_identifier INTEGER DEFAULT 0,      -- Show in profile header
    is_name_column INTEGER DEFAULT 0,     -- THE clickable name column
    default_value TEXT,
    description TEXT,                      -- Tooltip on header
    config TEXT DEFAULT '{}',              -- JSON: type-specific config
    -- dropdown: {"options": ["Active","Inactive"], "colors": {"Active":"#22c55e"}}
    -- date: {"alert_rule_id": 3, "format": "MM/DD/YYYY"}
    -- currency: {"symbol": "$", "decimals": 2}
    -- tag: {"color_map": {"urgent": "#e74c3c"}}
    -- status: {"options": [{"label":"Active","color":"#22c55e"}], "sort_order": ["Active","Pending","Discharged"]}
    -- age_from_dob: {"source_column_id": 5}
    -- calculated_days: {"source_column_id": 8, "label": "days until"}
    conditional_format TEXT DEFAULT '[]',  -- JSON: per-column formatting rules
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_columns_grid ON columns(grid_id);

-- Client/case rows
CREATE TABLE rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER DEFAULT 1,          -- 1=active, 0=archived
    is_starred INTEGER DEFAULT 0,
    color_label TEXT,                      -- Optional row highlight color
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT,
    archived_reason TEXT                   -- "Discharged", "Transferred", etc.
);
CREATE INDEX idx_rows_grid ON rows(grid_id);
CREATE INDEX idx_rows_active ON rows(grid_id, is_active);
CREATE INDEX idx_rows_starred ON rows(grid_id, is_starred) WHERE is_starred = 1;

-- Cell values (EAV pattern for flexible columns)
CREATE TABLE cells (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(row_id, column_id)
);
CREATE INDEX idx_cells_row ON cells(row_id);
CREATE INDEX idx_cells_column ON cells(column_id);
CREATE INDEX idx_cells_value ON cells(column_id, value);

-- Cell history (audit trail)
CREATE TABLE cell_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cell_id INTEGER NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
    row_id INTEGER NOT NULL,
    column_id INTEGER NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cell_history_cell ON cell_history(cell_id);
CREATE INDEX idx_cell_history_row ON cell_history(row_id);
CREATE INDEX idx_cell_history_date ON cell_history(changed_at);

-- Cell history retention:
-- With 200 clients × 20 columns × 10 edits/cell/year = 40,000 history rows after year one.
-- Not a performance problem for SQLite, but unbounded growth is bad hygiene.
--
-- Retention policy (configurable in Settings → Data):
--   Default: Keep last 12 months of history (auto-prune on app startup, runs silently)
--   Options: 6 months / 12 months / 24 months / Forever
--   Manual: Settings → Data → "Compact History" button with date picker:
--     "Delete edit history older than [date]. Current values are never affected."
--
-- Pruning query (runs on startup if retention is not "Forever"):
--   DELETE FROM cell_history WHERE changed_at < date('now', '-12 months');
--
-- The pruning ONLY deletes history rows. Current cell values are never touched.
-- Date column history that's relevant to alert cycling is preserved in case_log
-- system entries regardless of cell_history pruning.

-- Alert rules (attached to date columns)
CREATE TABLE alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    is_system INTEGER DEFAULT 0,
    thresholds TEXT NOT NULL,              -- JSON array of threshold configs
    cycle_days INTEGER,                    -- Auto-cycle interval
    notify_on_open INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Checklist items (per-client tasks)
CREATE TABLE checklist_items (
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
    priority TEXT DEFAULT 'normal',        -- low, normal, high, urgent
    is_archived INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    template_source_id INTEGER,
    recurrence_rule TEXT                    -- JSON: {"type":"cycle","days":90}
);
CREATE INDEX idx_checklist_row ON checklist_items(row_id);
CREATE INDEX idx_checklist_due ON checklist_items(due_date) WHERE due_date IS NOT NULL AND is_completed = 0;

-- Case log entries
CREATE TABLE case_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    log_type TEXT DEFAULT 'note',          -- note, phone_call, meeting, email, visit, system
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_pinned INTEGER DEFAULT 0,
    follow_up_date TEXT,
    follow_up_completed INTEGER DEFAULT 0
);
CREATE INDEX idx_case_log_row ON case_log(row_id);
CREATE INDEX idx_case_log_date ON case_log(created_at);
CREATE INDEX idx_case_log_followup ON case_log(follow_up_date) WHERE follow_up_date IS NOT NULL AND follow_up_completed = 0;

-- Scrap notes (one per client)
CREATE TABLE scrap_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    content TEXT DEFAULT '',               -- HTML from tiptap
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(row_id)
);

-- Document references (local file paths per client)
CREATE TABLE document_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,               -- Original filename (e.g., "Assessment_JohnDoe.pdf")
    file_path TEXT NOT NULL,               -- Absolute local path (primary lookup)
    relative_path TEXT,                    -- Path relative to documents_root (if configured)
    description TEXT,
    category TEXT,                          -- Assessment, Consent, Correspondence, Legal, Medical, Other
    file_size INTEGER,                     -- Size in bytes at time of attachment (for identification)
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_document_refs_row ON document_refs(row_id);

-- Checklist templates
CREATE TABLE checklist_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    items TEXT NOT NULL,                    -- JSON array
    is_recurring INTEGER DEFAULT 0,
    recurrence_days INTEGER,
    is_system INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Setup templates (full grid config snapshots)
CREATE TABLE setup_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    template_data TEXT NOT NULL,
    profession_tags TEXT DEFAULT '[]',
    is_system INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tags (per-grid)
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6b7280',
    UNIQUE(grid_id, name)
);

CREATE TABLE row_tags (
    row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (row_id, tag_id)
);
CREATE INDEX idx_row_tags_tag ON row_tags(tag_id);

-- Saved filter presets
CREATE TABLE saved_filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filter_config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Saved views (column visibility + sort + filter combos)
CREATE TABLE saved_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config TEXT NOT NULL,                  -- JSON: {columns_visible, sort_config, filter_config, grouping}
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Snippet/text expander (shortcodes for common phrases)
CREATE TABLE snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_text TEXT NOT NULL UNIQUE,     -- e.g., "/lm"
    expansion TEXT NOT NULL,               -- e.g., "Left message on voicemail."
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Letter/document templates (mail merge)
CREATE TABLE letter_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,                 -- Markdown/HTML with {{placeholders}}
    is_system INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Undo/redo action log
CREATE TABLE action_log (
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
CREATE INDEX idx_action_log_session ON action_log(session_id, created_at);

-- App settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### Migration Strategy
- Schema version in `app_meta` table
- Sequential migrations in `src/main/migrations/`
- Each migration: TypeScript with `up()` and `down()` inside a transaction
- Never delete columns; add new ones and migrate data

### Performance-Critical Query Patterns

> **⚠️ IMPORTANT FOR CLAUDE CODE**: The EAV (Entity-Attribute-Value) pattern used by the `cells` table is flexible but creates a major performance trap. With 500 clients × 20 columns = 10,000 cell rows, the naive approach (load rows, then loop N+1 to load cells per row) will produce a 2-second grid load instead of a 50ms one. **Always use the pivot query pattern below. Never query cells in a loop per row.**

**Grid Load — The Single Most Important Query in the App:**
```sql
-- CORRECT: Single pivot query returns one wide row per client
-- This is the ONLY acceptable pattern for loading the grid.
SELECT
  r.id AS row_id,
  r.position,
  r.is_active,
  r.is_starred,
  r.color_label,
  r.created_at,
  r.updated_at,
  MAX(CASE WHEN c.column_id = 1 THEN c.value END) AS col_1,
  MAX(CASE WHEN c.column_id = 2 THEN c.value END) AS col_2,
  MAX(CASE WHEN c.column_id = 3 THEN c.value END) AS col_3
  -- ... dynamically generate a CASE for each column in the grid
FROM rows r
LEFT JOIN cells c ON c.row_id = r.id
WHERE r.grid_id = ? AND r.is_active = 1
GROUP BY r.id
ORDER BY r.position;
```

```sql
-- ❌ WRONG: N+1 query pattern — NEVER do this
-- Step 1: SELECT * FROM rows WHERE grid_id = ?
-- Step 2: FOR EACH row: SELECT * FROM cells WHERE row_id = ?
-- This generates 501 queries for 500 clients. Unacceptable.
```

**Building the pivot query dynamically:**
```typescript
// In database.ts or a query builder:
function buildGridQuery(gridId: number, columnIds: number[]): string {
  const columnCases = columnIds
    .map(id => `MAX(CASE WHEN c.column_id = ${id} THEN c.value END) AS col_${id}`)
    .join(',\n  ');

  return `
    SELECT r.id AS row_id, r.position, r.is_active, r.is_starred,
           r.color_label, r.created_at, r.updated_at,
           ${columnCases}
    FROM rows r
    LEFT JOIN cells c ON c.row_id = r.id
    WHERE r.grid_id = ? AND r.is_active = 1
    GROUP BY r.id
    ORDER BY r.position
  `;
}
```

**Cell update — single cell write (most common operation):**
```sql
-- Upsert pattern for cell edits
INSERT INTO cells (row_id, column_id, value, updated_at)
VALUES (?, ?, ?, datetime('now'))
ON CONFLICT(row_id, column_id)
DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
```

**Dashboard deadline query — aggregate across grids:**
```sql
-- Get all date cells with alert rules for the deadline engine
SELECT r.id AS row_id, r.grid_id,
       name_cell.value AS client_name,
       c.column_id, c.value AS date_value,
       col.name AS column_name,
       col.config AS column_config
FROM cells c
JOIN rows r ON r.id = c.row_id AND r.is_active = 1
JOIN columns col ON col.id = c.column_id AND col.column_type = 'date'
LEFT JOIN cells name_cell ON name_cell.row_id = r.id
  AND name_cell.column_id = (
    SELECT id FROM columns WHERE grid_id = r.grid_id AND is_name_column = 1 LIMIT 1
  )
WHERE c.value IS NOT NULL AND c.value != '';
```

**General rules for database access:**
- **Batch reads**: Always use JOINs and GROUP BY, never loops
- **Batch writes**: Use transactions for multi-cell updates (`db.transaction(...)`)
- **Prepared statements**: Prepare frequently-used queries once, execute many times
- **Index awareness**: The `idx_cells_column` and `idx_cells_value` indexes exist for a reason — filter and sort queries should leverage them
- **Profile load**: Single query joining cells + checklist count + case log count for the profile view, not separate round-trips

---

## 5. Column Types Reference

| Type | Editor | Display | Validation | Sort |
|------|--------|---------|------------|------|
| `text` | Text input | Plain text, ellipsis | None | Alphabetical (case-insensitive) |
| `date` | Date picker | Formatted date | Valid date | Chronological |
| `number` | Number input | Formatted number | Numeric | Numeric |
| `checkbox` | Click toggle | Checkmark/empty | Boolean | Unchecked→checked or reverse |
| `dropdown` | Select menu | Value + optional color badge | From options | Alphabetical or custom order |
| `phone` | Phone input | (xxx) xxx-xxxx | Phone format | Alphabetical |
| `email` | Text input | Clickable mailto | Email format | Alphabetical |
| `tag` | Tag selector | Colored badges (multi) | From tag set | By first tag |
| `currency` | Number input | $X,XXX.XX | Numeric | Numeric |
| `url` | Text input | Clickable link | URL format | Alphabetical |
| `notes` | Textarea popup | Truncated 50 chars | None | Alphabetical |
| `status` | Custom dropdown | Color-coded badge | From statuses | Custom order |
| `address` | Multi-line text | Truncated first line | None | Alphabetical |
| `age_from_dob` | Read-only | "34 yrs" auto-calc | N/A | Numeric by age |
| `calculated_days` | Read-only | "12 days" / "Due today" / "5 days overdue" auto-calc | N/A | Numeric by value |

**Empty/null values always sort to BOTTOM regardless of direction.**

#### calculated_days Display Logic

The `calculated_days` column computes the number of days between today and a source date column. The raw value is a signed integer (positive = future, zero = today, negative = past), but the DISPLAY must be human-readable and context-aware:

| Raw Value | Display Text | Text Color | Icon |
|-----------|-------------|-----------|------|
| > 30 | "45 days" | Default text color | None |
| 8–30 | "12 days" | Default text color | 📅 |
| 1–7 | "3 days" | Orange (alert color) | ⏰ |
| 0 | "Due today" | Red (alert color) | ⚠️ |
| -1 to -7 | "3 days overdue" | Red text | ⚠️ |
| -8 to -30 | "15 days overdue" | Red text, bold | ⚠️ |
| < -30 | "47 days overdue" | Dark red text, bold | 🔴 |
| null/empty source | "—" | Muted text | None |

**Important**: The alert system colors the DATE cell based on alert thresholds. The calculated_days column is a SEPARATE rendering path — it does its own color/icon logic based on the raw day count, independent of any alert rules. Both can be visible simultaneously (date column shows "03/15/2026" with yellow background from alert rule; calculated_days column shows "26 days" with default styling). They complement each other but don't share rendering logic.

**Sort behavior**: Sort by the raw signed integer. Negative values (overdue) sort before positive values (upcoming) in ascending order — this puts the most urgent items at top, which is what users expect.

---

## 6. Sorting System (Complete)

### Single-Column Sort
- Click header → ascending → click again → descending → click again → remove sort
- Arrow icon: ↑ ascending, ↓ descending

### Multi-Column Sort
- **Shift+click** additional headers to add secondary, tertiary sorts (max 5)
- Priority number badges (1, 2, 3) next to each arrow
- Shift+click a sorted header to remove that sort level
- Click WITHOUT Shift resets to single-column sort

### Sort Persistence
- Saved to `grids.sort_config` JSON
- Persists across sessions
- New rows auto-sort into position
- Edited cells trigger re-sort with brief row highlight animation

### Sort Access Points
- Column header click
- Column header right-click → Sort Asc / Sort Desc / Remove Sort / Clear All
- Toolbar "Sort" button → config panel (drag to reorder priority, toggle direction)

### Default Sort
- `grids.default_sort_column_id` + `grids.default_sort_direction`
- Applies when no explicit sort is active
- Set in grid settings

### Dashboard Sorting (Fixed)
- Priority List: urgency (most overdue first)
- This Week/Month: chronological per day, urgency within same day
- Calendar Heatmap: spatial
- Completed: completion date, newest first
- Archived: archive date, newest first

### Profile Sorting
- Deadline Panel: urgency, fixed
- Checklist: manual drag default; toggle: Due Date | Priority | Category | Created
- Case Log: newest first default; toggle oldest first; pinned always top
- Activity Timeline: newest first; toggleable
- Grid Data Summary: column order from grid

---

## 7. Feature Specifications

### 7.1 Customizable Grid View (Main Screen)

#### Grid Interactions
- Click cell → edit mode
- Single-click client name → Profile View
- Tab/Shift+Tab → next/prev cell
- Enter → confirm + move down; Shift+Enter → move up
- Arrow keys → navigate when not editing
- Escape → cancel edit or deselect
- F2 → enter edit mode (like Excel)
- Ctrl+Z/Y → undo/redo
- Ctrl+F → focus search bar
- Ctrl+N → quick-add row
- Ctrl+K → command palette
- Ctrl+D → duplicate row
- Ctrl+C/V → copy/paste cell; Ctrl+Shift+C → copy with label
- Ctrl+A → select all rows
- Delete → clear cell (confirmation for row delete)
- Space → toggle checkbox or enter edit
- Double-click column border → auto-fit width
- Drag column header → reorder
- Drag row handle → reorder (disabled during active sort)
- Home/End → first/last cell in row
- Ctrl+Home/End → first/last cell in grid
- Right-click → context menu

#### Grid Toolbar (left to right)
- **Search bar**: real-time filter, debounced 150ms, scope indicator
- **Filter button** (badge: active count): opens FilterPanel sidebar
- **Sort button** (badge: active count): opens sort config panel
- **Group by dropdown**: group by dropdown/tag/status column (see Grouping below)
- **View toggles**: Grid | Dashboard
- **+ Add Row** (primary), **+ Add Column** (secondary)
- **⋮ More**: Import CSV, Export CSV, Print, Grid Settings

#### Grouping System

Grouping organizes rows into collapsible sections based on a dropdown, status, or tag column value. It's a visual layer on top of the existing sort/filter — it doesn't change data.

**Display:**
- Each group renders as a collapsible section with a header bar:
  - `▶ Active (23)` or `▼ Hospital Admit (4)` — group value + row count
  - Header bar uses the column's color configuration if available (e.g., status column colors)
  - Rows within each group maintain their current sort order
- **Ungrouped / empty value**: Rows with no value in the grouped column appear in a "(No Value)" group at the bottom
- Groups are alphabetically ordered by default, or by the column's custom sort order if defined (e.g., status columns with `sort_order` config)

**Interactions:**
- Click group header → collapse/expand that group
- **Collapse All / Expand All** buttons in the toolbar (appear when grouping is active)
- **Drag a row between groups** → changes the cell value for that column to match the target group. This is a real data edit (fires auto-save, creates undo entry, generates system case log entry if it's a status column). Visual confirmation: row briefly highlights in the new group.
- Right-click group header → "Select All in Group", "Collapse Others", "Hide This Group"
- Grid footer updates: "47 clients (3 groups, 23 shown)" when groups are collapsed

**Limitations (kept simple for v1):**
- Single-level grouping only (no nested groups)
- Only columns of type `dropdown`, `status`, and `tag` can be grouped by
- Virtual scrolling still applies within groups — large groups don't load all rows at once
- Grouping state persists in `grids.filter_config` JSON alongside active filters

**Phase**: Grouping is part of Phase 5 (Polish & Launch). The toolbar dropdown appears in Phase 1 but is disabled/hidden until Phase 5 implementation.

#### Advanced Filtering (FilterPanel)
- Per-condition rows: [Column] [Operator] [Value]
- Operators per type:
  - Text: contains, not contains, equals, starts with, ends with, empty, not empty
  - Date: before, after, between, within next 7/14/30/60/90 days, overdue, empty
  - Number/Currency: equals, greater than, less than, between, empty
  - Dropdown/Status: is, is not, is any of, empty
  - Checkbox: checked, not checked
  - Tag: has tag, not has tag, has any, has none
- AND/OR logic toggle
- Save as named preset (max 20 per grid)
- Active filters as dismissible chips above grid
- Row count: "Showing 23 of 47 clients"

#### Conditional Formatting
- Per-column rules in column config → Conditional Formatting tab
- Text: contains/equals → background/text color
- Number: greater/less/between → color
- Multiple rules, first match wins

#### Row Features
- **Archiving**: right-click → Archive → optional reason → hidden by default, "Show Archived" toggle, grayed+strikethrough, reactivate option, excluded from dashboard
- **Starring**: star icon per row, filter "Starred only", sort "Starred first"
- **Color Labels**: right-click → Color Label → 8 presets + Clear, subtle 10-15% opacity tint
- **Move to Grid**: right-click → Move to Grid → select target grid from list. Columns with matching names and types transfer data automatically; unmatched columns left blank in target. User chooses: archive original row, delete it, or keep a copy. Supports multi-select (move several rows at once). Use case: moving clients from "Outreach" to "Active Caseload" to "Discharged."
- **Duplication**: Ctrl+D, copies cells, clears name/checklists/logs
- **Row Numbers**: optional column, toggleable, shows visible position
- **Multi-Select**: Shift+click range, Ctrl+click individual, Ctrl+A all → bulk action bar: Tag, Template, Set Value, Archive, Delete, **Print Selected**

#### Grid Footer Strip
- Left: "47 clients (23 shown)"
- Center: "3 selected"
- Right: "Sum: $4,250 | Avg: $1,416.67" (for selected numeric cells) + "Saved ✓"

#### Copy/Paste
- Ctrl+C cell → plain text
- Ctrl+C selected row → tab-separated (Excel-compatible)
- Ctrl+V → validates against column type
- Ctrl+Shift+C → "Column Name: Value" (for case notes)

#### Destructive Action Safety

**NEVER use a simple "Are you sure?" modal for destructive actions.** Users click through confirmation dialogs on autopilot. Destructive actions require friction proportional to their severity.

**Deleting a single client row:**
- Modal: "You are about to permanently delete [Client Name] and all their data (checklists, case notes, documents). Type **DELETE** to confirm."
- Text input that must match "DELETE" exactly before the confirm button enables
- Confirm button stays grayed out until text matches
- Cancel button is the visually prominent one (primary color). Delete button is red and secondary.

**Bulk deleting multiple rows:**
- Modal: "You are about to permanently delete **X clients** and all their data. This cannot be undone. Type **DELETE X** to confirm." (where X is the count)
- Same pattern: text input must match exactly

**Deleting a column:**
- Modal: "Deleting the column **[Column Name]** will permanently erase this data from all X clients. Type the column name to confirm: **[Column Name]**"
- Text input must match the column name

**Deleting a grid/workspace:**
- Modal: "Deleting the grid **[Grid Name]** will permanently erase X clients and all their data. Type **DELETE [GRID NAME]** to confirm."

**Archiving** (non-destructive — data preserved):
- Simple confirmation is fine: "Archive [Client Name]? They will be hidden from the grid and dashboard but all data is preserved. You can reactivate them anytime."
- This is NOT a destructive action, so no typing required.

**App Reset (Settings → Danger Zone):**
- "This will permanently delete ALL data, ALL grids, ALL backups, and reset the app to factory state. Type **RESET EVERYTHING** to confirm."

**Design pattern**: Red button + typed confirmation = the user had to think about it. This prevents the "I accidentally deleted my whole caseload" email.

#### Undo/Redo System

Undo is the first line of defense. Every user action that changes data should be undoable.

**Scope — these actions are ALL undoable:**
- Cell edits (value changes)
- Row creation, deletion, archiving, unarchiving
- Row reordering
- Column creation, deletion, renaming, reordering, type changes
- Checklist item creation, completion, deletion, reordering
- Tag assignment/removal
- Case log entry creation, editing, deletion
- Scrap note edits
- Bulk operations (undo reverses the entire batch)

**Implementation:**
- Undo stack depth: **100 actions** per session
- Stored in the `action_log` table with full before/after state snapshots
- Each action: `{action_type, entity_type, entity_id, previous_state (JSON), new_state (JSON), session_id, timestamp}`
- Ctrl+Z undoes most recent; repeated Ctrl+Z walks back through stack
- Ctrl+Y or Ctrl+Shift+Z redoes
- Session-scoped: undo history clears on app close (not persisted between sessions)

**UX:**
- **Undo toast**: When a destructive action happens (especially row delete), show bottom-center toast: "[Client Name] deleted. **[Undo]** (8s)" with a countdown bar
- Clicking [Undo] in the toast immediately reverses the action
- Toast auto-dismisses after 8 seconds
- After toast dismisses: action is still in the undo stack, still Ctrl+Z-able
- Status bar briefly shows "Undone" / "Redone" after undo/redo

**NOT undoable (with clear warnings):**
- Database restore from backup
- App reset
- Password change (but old backups keep old password)
- These actions show: "⚠️ This action cannot be undone."

### 7.2 Smart Deadline Engine

#### Alert Rule Structure
```typescript
interface AlertRule {
  id: number;
  name: string;
  description?: string;
  isSystem: boolean;
  cycleDays?: number;
  notifyOnOpen: boolean;
  thresholds: AlertThreshold[];
}

interface AlertThreshold {
  daysBefore: number;     // 0=due date, negative=overdue
  color: string;
  textColor?: string;
  style: 'background' | 'border' | 'text' | 'pulse' | 'badge' | 'bold';
  label: string;
  icon?: string;
}
```

#### Visual Preview
When editing rules, show horizontal timeline:
```
|----[green]----[yellow]----[orange]----[red]----||---[pulse]---→
90d             30d         14d         7d       0d
```

#### Pre-Built Templates
| Name | Cycle | Thresholds |
|------|-------|------------|
| Annual Assessment | 365d | 90d green, 60d yellow, 30d orange, 14d red, 0d pulse, -30d dark-pulse |
| Semi-Annual Review | 180d | 45d yellow, 21d orange, 7d red, 0d pulse |
| Quarterly Check-In | 90d | 21d yellow, 10d orange, 5d red, 0d pulse |
| Monthly Contact | 30d | 10d yellow, 5d orange, 2d red, 0d pulse |
| Plan of Care | 180d | 45d yellow, 21d orange, 7d red, 0d pulse |
| IEP Annual Review | 365d | 90d green, 60d yellow, 30d orange, 14d red, 0d pulse |
| Triennial Re-Eval | 1095d | 180d yellow, 90d orange, 30d red, 0d pulse |
| Court Date | no cycle | 30d yellow, 14d orange, 7d red, 0d pulse |

#### Auto-Cycling
When date column has cycleDays and user enters new date: old date saved to cell_history, alert resets, case log auto-entry generated.

#### Startup Notification
On app open with overdue/today items: toast "X overdue, Y due today" → click → Dashboard. Configurable on/off.

### 7.3 Client Profile Pages

#### Navigation
- Click name → `/profile/:rowId`
- Back button / Escape → grid (scroll position preserved)
- Prev/Next buttons (◀ ▶) with "(3 of 47)" indicator; Alt+Left/Right
- Breadcrumb: Grid Name > Client Name
- Recent profiles: last 10 from TopBar dropdown

#### Profile Layout (top to bottom)

**1. Header**: Large name, DOB, age, identifiers, star, status badge, tags, color label, quick actions: [+ Note] [+ Task] [📎 Attach] [🖨 Print] [← Grid]

**2. Deadline Panel**: Card per date column — name, date, human-readable urgency, alert color, progress bar. Sorted by urgency (fixed). Click to edit.

**3. Checklist**: Drag-to-reorder items with checkbox, title, due date (color-coded), priority badge (🔴🟠⚪🔵), category. Sort toggle: Manual|Due Date|Priority|Category. Progress bar "7/12". Apply Template button. Completed section (collapsible, timestamped). Individual recurring items.

**4. Contact Info**: Auto-populated from phone/email/address columns. Click-to-copy. Hidden if no contact columns.

**5. Scrap Notes**: tiptap rich text (bold, italic, bullets, numbered). Warm sticky-note background. Auto-save 2s. Resize handle.

**6. Case Log**: Quick interaction log — NOT formal documentation (users have Therap/NetSmart for that). Reverse-chrono default (toggle). Add entry: type selector (📝📞🤝✉️🏠), plain text content, optional follow-up date. That's it — three fields, three seconds. Each entry: timestamp, relative time, type icon, content, pin/edit/delete. Pinned section at top. Search. Follow-up tracking with completion. Edited entries show "edited" indicator with original timestamp preserved.

**Auto-generated system entries** (type: `system`) for:
- Date column updates (e.g., "POC Expiration updated: 06/15/2026 → 12/15/2026")
- Date auto-cycling (e.g., "Annual Assessment cycled — new deadline: 03/15/2027")
- **Status column changes** (e.g., "Status changed: Active → Hospital Admit")
- **Archive/unarchive** (e.g., "Client archived — Reason: Discharged" / "Client reactivated")
- **Tag additions/removals** (e.g., "Tag added: Priority" / "Tag removed: Pending Transfer")
- Checklist completions (e.g., "Checklist item completed: Submit Life Plan")
- Checklist cycle resets (e.g., "Monthly Check-In checklist reset for new cycle")

These breadcrumbs matter when a supervisor asks "what happened with this client in October?" The audit trail should capture every meaningful state change, not just date updates. System entries are visually distinct (muted styling, system icon) so they don't clutter the manual log entries.

**7. Document References**: List of local file path references. Attach File → system picker. Category, description. Click to open in system app.

**Resilient file path handling:**
Absolute file paths break the moment someone moves a file, renames a folder, or switches computers via Pack & Go. When ALL document refs break at once (because the user moved their Documents folder), a wall of red warnings creates panic.

- **Store three identifiers per file**: absolute path (primary), original filename, and optional relative path from a user-configured "documents root" folder
- **Documents root** (Settings → General): User can set a root folder (e.g., `C:\Users\James\Documents\Clients\`). When set, new attachments also store the path relative to this root. If the user moves the root folder to a new location and updates the setting, all relative paths resolve automatically.
- **File resolution order**: Try absolute path first → if missing, try documents_root + relative_path → if still missing, show friendly warning
- **Broken reference UX**: Instead of just "File not found", show: "Can't find **Assessment_JohnDoe.pdf** at its original location. [Locate File] [Remove Reference]". The locate dialog opens a file picker pre-filtered to the original filename so the user can point to where the file moved.
- **Bulk re-link**: If 5+ document refs are broken simultaneously (common after folder moves), show a single banner: "X document references can't find their files. [Re-link All] opens a wizard that lets the user point to the new root folder and auto-resolves all relative paths at once."
- **Pack & Go note**: When using Pack & Go to move between computers, document refs will break because files don't travel with the database. The Pack & Go summary should note: "Document references point to files on your original computer. You'll need to re-link them after restoring on a new machine."

**8. Activity Timeline**: Aggregated chronological feed of all events. Filterable by type. Paginated (50 at a time).

**9. Grid Data Summary**: Two-column key-value of all non-identifier columns. Editable inline (syncs to grid). Date fields show alert badge.

#### Print Layout
Print button → clean formatted output. Includes: header, deadlines, active checklist, last 10 case log entries, scrap notes. Footer: "Printed [date] — CaseConnect Pulse — pulse.caseconnect.com — CONFIDENTIAL".

#### Batch Print (Multi-Client PDF)

Twice a year, care coordinators prep for state audits. The auditor says "show me documentation for these 12 clients." Without batch print, the coordinator clicks into each profile, prints, clicks back, repeats twelve times. Batch print turns a 15-minute fumble into a 10-second action.

**Access points:**
- Multi-select rows in grid → bulk action bar → "Print Selected"
- File → Print → "Print All Active Clients" / "Print Filtered Clients" (if filter is active)
- Dashboard → right-click multiple items → "Print Selected Profiles"

**Output:**
- Single multi-page PDF with page breaks between clients
- Each client section uses the same Profile Print Layout (header, deadlines, active checklist, last 10 case log entries, scrap notes)
- Cover page (optional, on by default): "Caseload Report — [Worker Name] — [Date] — [X] Clients" with a table of contents listing client names and page numbers
- Footer on every page: "Page X of Y — Printed [date] — CaseConnect Pulse — pulse.caseconnect.com — CONFIDENTIAL"

**Options dialog** (shown before generating):
- Client list with checkboxes (pre-checked based on selection) — user can add/remove before printing
- Sort order: Current grid order / Alphabetical by name / By urgency (most overdue first)
- Include sections: ☑ Deadlines ☑ Checklist ☑ Case Log (last __ entries) ☑ Scrap Notes ☑ Contact Info ☐ Grid Data Summary ☐ Cover Page
- Output: [Print] (system print dialog) / [Save as PDF] (file save dialog)

**Performance**: Generate PDF in main process via jspdf. Show progress bar: "Generating page 7 of 12..." For 50+ clients, warn: "This may take a moment."

**Phase**: Phase 4 (Templates & Data) alongside other PDF export work.

### 7.4 Dashboard View

#### Summary Cards (top row)
- Total Active Clients
- Overdue Items (red if > 0)
- Due This Week
- Due This Month
- Follow-Ups Due

#### Tabs
**Priority List** (default): Full list by urgency. Filter chips: All|Overdue|This Week|This Month. Search. Click → profile.

**This Week**: Grouped by day, chronological, urgency within day. Today highlighted.

**This Month**: Same as Week but full month, grouped by week.

**Calendar Heatmap**: Monthly grid, color-coded by item count per day. Click day → popover with items. Navigate months.

**Completed**: Last 30 days of completed items. Grouped by date. For supervisor reporting.

**Archived**: Archived clients with date, reason, search, reactivate button.

### 7.5 Checklist System

#### Template Structure
```typescript
interface ChecklistTemplate {
  id: number;
  name: string;
  description?: string;
  items: { title: string; description?: string; category?: string; relativeDueDays?: number; priority?: string; }[];
  isRecurring: boolean;
  recurrenceDays?: number;
  isSystem: boolean;
}
```

#### Pre-Built Templates
- **New Client Intake** (8 items: consent, insurance, assessment, PCP, plan, follow-up, provider letters, system entry)
- **Annual Review Prep** (7 items: review plan, contact providers, schedule, records, documentation, submit, distribute)
- **Discharge Planning** (6 items: notify, summary, transfer, billing, closure letters, archive)
- **Home Visit Prep** (5 items: address, documents, review goals, confirm, safety assessment)
- **Monthly Check-In** (4 items: review goals, document contact, update status, schedule next)

#### Recurring Checklists
On ALL items complete: dialog "Reset for next cycle?" → uncheck all, recalculate due dates, archive completed cycle with number.

### 7.6 Template System

#### .pulse-template Format (JSON)
Contains: pulse_version, template_type, name, description, author, profession_tags, grid_config (columns with types/widths/alerts, alert_rules, checklist_templates, theme, default_sort, tags).

#### Import Flow
File picker → validate → preview (columns, rules, checklists, theme) → "Create New Grid" or "Apply to Current Grid" (merge options) → apply.

#### Export Flow
Template Manager → "Create from Current Grid" → name, description, tags → choose what to include → save as .pulse-template.

### 7.7 Snippet / Text Expander System

Case managers type the same phrases constantly. Local text expander saves hours.

- **Database**: `snippets` table (trigger_text, expansion, category)
- **UX**: User types `/lm` in any text field → auto-expands to "Left message on voicemail on 02/17/2026."
- **Management**: Settings → Snippets → create, edit, delete, organize by category
- **Implementation**: Listen for trigger prefix "/" in tiptap editors and case log. Show autocomplete dropdown matching typed trigger.

#### Date-Aware Snippet Variables

Snippet expansions support a small set of magic variables using `{variable}` syntax. This is NOT a full template engine — it's five variables and a regex replacement. But the time savings compound across 50 clients and 20 phone calls a day.

**Supported variables:**
| Variable | Expands To | Example |
|----------|-----------|---------|
| `{today}` | Current date in user's configured format | `02/17/2026` |
| `{today+N}` | Date N days from now | `{today+7}` → `02/24/2026` |
| `{today-N}` | Date N days ago | `{today-1}` → `02/16/2026` |
| `{client_name}` | Current client's name (only works in profile context — case log, scrap notes, checklists) | `Maria Rodriguez` |
| `{now}` | Current time in user's configured format | `2:30 PM` |

**Implementation**: Simple regex pass on expansion text before insertion. If a variable can't be resolved (e.g., `{client_name}` used outside a profile), insert the literal text unchanged and log no error — user will see `{client_name}` and understand they're not in a profile context.

#### Pre-Built Snippets (user can modify)

**Static snippets:**
- `/nm` → "No answer, no machine."
- `/met` → "Met with client at residence."
- `/nc` → "Client reports no changes in medical status."
- `/ref` → "Referral submitted to "
- `/fup` → "Follow-up needed regarding "

**Date-aware snippets:**
- `/lm` → "Left message on voicemail on {today}."
- `/att` → "Attempted to contact client on {today}."
- `/fup7` → "Follow up by {today+7}."
- `/fup14` → "Follow up by {today+14}."
- `/fup30` → "Follow up by {today+30}."
- `/vc` → "Visited {client_name} at residence on {today}."
- `/tc` → "Telephone contact with {client_name} on {today} at {now}."

**Snippet editor**: When creating/editing a snippet, show a "Variables" helper below the expansion text field listing available variables with click-to-insert. Live preview shows what the expansion will look like with current values.

### 7.8 Document Generation (Mail Merge Lite)

- "Generate Letter" button on Profile View
- Letter templates stored in `letter_templates` table
- Templates use `{{placeholders}}`: `{{client_name}}`, `{{dob}}`, `{{age}}`, `{{case_manager_name}}`, `{{today_date}}`, `{{medicaid_cin}}`, plus any column name as `{{column_name}}`
- Preview with placeholders filled from client data
- Output: Copy to clipboard (for pasting into Word/Email) or export as PDF
- Pre-built templates:
  - **Introduction Letter**: Standard intro to new providers
  - **Referral Request**: Request for services
  - **Status Update**: Progress summary for team
- Users can create, edit, and save custom letter templates

### 7.9 Morning Briefing

Caseload professionals start every day with the same question: "What do I need to handle today?" Pulse answers it in 3 seconds.

- **Appears on launch** after password unlock, before the grid loads
- **Three big numbers**, centered on screen:
  - 🔴 **Overdue** — items past their deadline (click to expand list)
  - 🟡 **Due This Week** — items due in the next 7 days (click to expand)
  - 🔵 **Follow-Ups Pending** — case log follow-ups awaiting action (click to expand)
- **Expanded view**: each item shows client name, what's due, and a quick-action button (navigate to profile, mark complete, snooze)
- **"Start My Day" button** → dismisses briefing, opens grid
- **Settings**: toggle Morning Briefing on/off (default: on). Option to skip if no items are urgent.
- **Design**: clean, calm, not alarming. The point is clarity, not anxiety. Even when there are overdue items, the tone is "here's what needs attention" not "YOU'RE BEHIND."
- This screen becomes the daily ritual. It's the thing users describe when recommending Pulse: "I open it every morning and it tells me exactly what I need to do."

### 7.10 Focus Mode / Today View

Caseloads are overwhelming. 50+ clients creates cognitive overload.

- Accessible via: Ctrl+Shift+F or sidebar icon or command palette "Focus Mode"
- **Simplified interface**: Hides grid, sidebar collapses. Shows ONLY:
  1. **Calls to Make Today** — clients with items due today/overdue, showing name + what's due + phone number
  2. **Documentation Due Today** — checklist items and deadlines due today
  3. **Follow-Ups Due** — case log follow-ups due today
- Each item has a big, satisfying **[Complete ✓]** button
- Completing an item: brief celebration animation (subtle checkmark), item slides away
- "Exit Focus Mode" button returns to normal view
- Designed for: Monday morning "what do I do first" or end-of-day "did I forget anything"

### 7.11 Caseload-Level Tasks

Every caseload professional has recurring obligations that aren't tied to any specific client: monthly billing submissions, weekly team meeting prep, quarterly documentation audits, annual training renewals, Friday afternoon overdue reviews. These tasks are currently invisible in Pulse because the entire data model is organized around client rows. There's nowhere to put "Submit monthly billing by the 5th" — it doesn't belong on any one client's profile.

Without a home for these tasks, users will do one of two things: keep a separate to-do list (defeating the "one place for everything" promise), or create a fake client row called "ADMIN TASKS" and abuse the checklist system. Both are terrible.

#### Design Philosophy
- **Keep it dead simple.** This is a task list, not a project management tool. Title, optional description, due date, recurrence, done/not done. That's it.
- **No nesting, no subtasks, no dependencies.** The moment you add subtasks, you're building Todoist. Pulse is a caseload tool, not a GTD app.
- **Surface alongside client work, not in a separate universe.** Caseload tasks appear in the Morning Briefing, Focus Mode, and Dashboard right next to client deadlines — because that's how the user's actual day works. "Call Maria about her POC" and "Submit monthly billing" are both things they need to do today.
- **Per-grid or global.** Some tasks are caseload-specific ("review all overdue items in Active grid"). Others are role-wide ("complete annual training"). Both should be supported.

#### Data Model

```sql
CREATE TABLE caseload_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grid_id INTEGER REFERENCES grids(id) ON DELETE CASCADE,  -- NULL = global (all grids)
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'normal',        -- low, normal, high, urgent (matches checklist priority)
    category TEXT,                          -- Billing, Documentation, Meetings, Training, Admin, Other
    due_date TEXT,                          -- ISO 8601: YYYY-MM-DD
    recurrence_rule TEXT,                   -- JSON (see Recurrence below)
    is_completed INTEGER DEFAULT 0,
    completed_at TEXT,
    snoozed_until TEXT,                    -- If snoozed, hidden from briefing/focus until this date
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_caseload_tasks_due ON caseload_tasks(due_date) WHERE is_completed = 0;
CREATE INDEX idx_caseload_tasks_grid ON caseload_tasks(grid_id);

-- Completed history for recurring tasks (preserves the audit trail)
CREATE TABLE caseload_task_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES caseload_tasks(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL,
    cycle_number INTEGER,                  -- 1, 2, 3... for recurring tasks
    notes TEXT                             -- Optional: "Submitted to fiscal dept"
);
CREATE INDEX idx_caseload_task_history_task ON caseload_task_history(task_id);
```

#### Recurrence System

Recurrence uses the same JSON pattern as checklist recurrence to keep the codebase consistent:

```typescript
interface CaseloadTaskRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;            // Every N periods (default 1)
  days_of_week?: number[];     // For weekly: [1,3,5] = Mon/Wed/Fri (1-indexed, Sunday=0)
  day_of_month?: number;       // For monthly: 1-28 (avoid 29-31 edge cases) or -1 for last day
  end?: {
    type: 'never' | 'count' | 'until';
    count?: number;            // Stop after N occurrences
    until?: string;            // Stop after this date (ISO 8601)
  };
}
```

**Common recurrence patterns (pre-built):**
| Pattern | Recurrence Rule | Example |
|---------|----------------|---------|
| Weekly (specific day) | `{"frequency":"weekly","interval":1,"days_of_week":[3]}` | "Prepare for Wednesday team meeting" |
| Monthly (specific date) | `{"frequency":"monthly","interval":1,"day_of_month":5}` | "Submit billing by the 5th" |
| Monthly (last day) | `{"frequency":"monthly","interval":1,"day_of_month":-1}` | "End-of-month documentation review" |
| Quarterly | `{"frequency":"monthly","interval":3,"day_of_month":15}` | "Quarterly self-care plan submission" |
| Yearly | `{"frequency":"yearly","interval":1}` | "Annual training renewal" |
| Every weekday | `{"frequency":"weekly","interval":1,"days_of_week":[1,2,3,4,5]}` | "Check voicemail" |
| Biweekly | `{"frequency":"weekly","interval":2,"days_of_week":[5]}` | "Biweekly supervision prep" |

**Cycle completion behavior:**
- When a recurring task is marked complete:
  1. Current completion is saved to `caseload_task_history` with timestamp and optional notes
  2. `due_date` advances to the next occurrence based on `recurrence_rule`
  3. `is_completed` resets to 0
  4. Task reappears in briefing/focus when the new due date approaches
- One-time tasks (no recurrence): marked complete and hidden from active views. Visible in "Completed Tasks" list.

#### Management Interface

**Sidebar item**: 📌 Tasks (between Focus and Templates in the sidebar nav)

**Tasks View** (`/tasks`):
```
┌─────────────────────────────────────────────────┐
│  📌 Caseload Tasks                    [+ Add]   │
│                                                  │
│  Scope: [All Grids ▾]  Filter: [All ▾] [Due ▾] │
│                                                  │
│  ── Overdue ──────────────────────────────────── │
│  🔴 Submit monthly billing (5 days overdue)  [✓] │
│     Monthly · Billing · All Grids                │
│                                                  │
│  ── Due This Week ────────────────────────────── │
│  🟡 Prepare for team meeting (Wed)           [✓] │
│     Weekly · Meetings · Active Caseload          │
│  🟡 Friday overdue review (Fri)              [✓] │
│     Weekly · Admin · All Grids                   │
│                                                  │
│  ── Upcoming ─────────────────────────────────── │
│  ⚪ Quarterly documentation audit (Mar 15)   [✓] │
│     Quarterly · Documentation · All Grids        │
│  ⚪ Annual training renewal (Jun 30)         [✓] │
│     Yearly · Training · All Grids                │
│                                                  │
│  ── Completed (last 30 days) ─── [collapse ▴] ── │
│  ✓ Submit monthly billing — Feb 5             📝 │
│  ✓ Prepare for team meeting — Feb 12          📝 │
└─────────────────────────────────────────────────┘
```

**Task card interactions:**
- Click [✓] → mark complete (recurring: advances to next cycle; one-time: moves to completed)
- Click task title → expand inline to show description, recurrence details, completion history
- Right-click → Edit, Snooze (1 day / 3 days / 1 week / custom), Delete
- Completed items show an optional 📝 icon to add a note (e.g., "Submitted to fiscal dept — confirmation #4521")

**Add Task dialog** (minimal — three fields visible, rest expandable):
- **Title** (required): "Submit monthly billing"
- **Due date** (required for recurring, optional for one-time): date picker
- **Recurrence** (optional): dropdown with presets (Weekly, Monthly, Quarterly, Yearly, Custom) or "One-time"
- **Expandable section** ("More options"):
  - Priority: Low / Normal / High / Urgent
  - Category: Billing / Documentation / Meetings / Training / Admin / Other (or custom text)
  - Grid scope: All Grids / [specific grid name]
  - Description: plain text area

#### Integration with Existing Features

**Morning Briefing** — Add a fourth section below the three big numbers:

```
┌─────────────────────────────────────────────────┐
│                                                  │
│      🔴 3 Overdue    🟡 7 This Week    🔵 2 Follow-Ups    │
│                                                  │
│  ── 📌 Caseload Tasks Today ──────────────────── │
│  🔴 Submit monthly billing (5 days overdue)      │
│  🟡 Prepare for team meeting (due Wed)           │
│                                                  │
│                [Start My Day →]                   │
└─────────────────────────────────────────────────┘
```

- Only shows tasks that are overdue or due within 3 days (keeps the briefing tight)
- If no caseload tasks are due, this section is hidden (no empty section clutter)
- Tasks show inline [✓] complete buttons — user can knock out a quick task right from the briefing
- Count of caseload tasks is NOT included in the three big numbers (those remain client-focused). Caseload tasks are their own section to maintain clarity.

**Focus Mode** — Add a fourth section:

```
── 📌 Admin Tasks Due Today ──
🔴 Submit monthly billing                    [Complete ✓]
🟡 Prepare for team meeting                  [Complete ✓]
```

- Appears after "Follow-Ups Due" section
- Same satisfying complete animation as client items
- Section hidden if no caseload tasks are due today

**Dashboard** — Two integration points:

1. **Summary cards row**: Add a "📌 Tasks Due" card alongside Total Active Clients, Overdue Items, etc. Shows count of overdue + due-this-week caseload tasks. Click → navigates to Tasks view.

2. **Priority List tab**: Caseload tasks appear interleaved with client deadlines, sorted by urgency. Visually distinct — a small 📌 badge and "Caseload Task" label differentiates them from client items. This is intentional: the priority list should reflect the user's actual priority, which includes both client and admin work.

**Command Palette** — Add commands:
| Command | Action |
|---------|--------|
| `tasks` | Navigate to Tasks view |
| `add task` | Open Add Task dialog |
| `billing` / `meeting` / etc. | Fuzzy-match caseload task titles for quick completion |

**Supervisor Report** — Add optional section:
- "Caseload Task Summary": tasks completed in the reporting period, tasks currently overdue
- Off by default (toggle in export options) — some supervisors care about admin compliance, others don't

#### Pre-Built Task Templates

On first launch (during onboarding) or when accessing Tasks view for the first time, offer to seed common tasks based on the role selected during setup:

| Role | Suggested Tasks |
|------|----------------|
| Care Coordinator | Monthly billing submission (monthly, day 5), Service plan documentation review (quarterly), Team meeting prep (weekly), Annual training renewal (yearly) |
| Social Worker | Monthly contact log submission (monthly, last day), Quarterly case review prep (quarterly), Supervision prep (biweekly) |
| IEP Coordinator | Progress report distribution (quarterly), Parent communication log (monthly), Annual training (yearly) |
| Probation Officer | Monthly court report submission (monthly), Case review prep (weekly), Documentation audit (quarterly) |
| Therapist | Treatment plan review prep (quarterly), Session notes batch (weekly, Friday), Insurance billing submission (monthly) |

User can check/uncheck from the suggested list, or dismiss entirely: "I'll add my own later."

#### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Shift+T | Quick-add caseload task (from anywhere) |
| Ctrl+3 | Navigate to Tasks view (alongside Ctrl+1 Grid, Ctrl+2 Dashboard) |

#### IPC Channels

```typescript
// Add to existing IPC channels:
CASELOAD_TASK_GET_ALL: 'caseload-task:get-all',
CASELOAD_TASK_CREATE: 'caseload-task:create',
CASELOAD_TASK_UPDATE: 'caseload-task:update',
CASELOAD_TASK_DELETE: 'caseload-task:delete',
CASELOAD_TASK_COMPLETE: 'caseload-task:complete',    // Handles cycle advancement for recurring
CASELOAD_TASK_SNOOZE: 'caseload-task:snooze',
CASELOAD_TASK_GET_HISTORY: 'caseload-task:get-history',
CASELOAD_TASK_GET_DUE: 'caseload-task:get-due',      // For briefing/focus/dashboard queries
```

#### Project Structure Additions

```
src/renderer/views/TasksView.tsx
src/renderer/stores/taskStore.ts
src/renderer/components/tasks/
    TaskList.tsx
    TaskCard.tsx
    TaskAddDialog.tsx
    TaskCategoryBadge.tsx
    TaskRecurrenceConfig.tsx
src/renderer/types/tasks.ts
src/main/caseload-tasks.ts                   # Task CRUD, completion, cycle advancement
```

#### Phase Assignment

**Build in Phase 3** (Profiles & Workflow) — not deferred to v1.1. The data model, sidebar item, Tasks view, and basic CRUD should ship with v1. The Morning Briefing/Focus Mode/Dashboard integrations can follow in Phase 5 (Polish & Launch) since those views are already complex.

**Phase 3 scope**: Table creation, task CRUD, Tasks view, add/complete/delete, recurrence engine, sidebar nav item, Ctrl+Shift+T shortcut, pre-built task templates during onboarding.

**Phase 5 scope**: Morning Briefing integration, Focus Mode integration, Dashboard summary card, Priority List interleaving, Command Palette commands, Supervisor Report section, snooze functionality.

### 7.12 Portable-First Architecture

Pulse is designed as a **portable-first application**. It always runs without requiring installation.

**Distribution Formats:**
- **Windows**: Portable `.exe` (primary) + optional `.zip` containing the exe + Data folder. No installer, no `%APPDATA%` dependency. Also offer a traditional `.exe` installer for users who prefer it.
- **Linux**: `.AppImage` (already inherently portable) + `.deb` for users who prefer system installation
- **macOS**: `.dmg`

**Storage Strategy:**
- App always checks for a `Data/` folder relative to the executable FIRST
- If `Data/` exists next to the exe: portable mode — all data stays in `Data/pulse.db`, backups in `Data/backups/`
- If no relative `Data/` folder: falls back to OS standard location (`~/.pulse/` on Linux, `%APPDATA%/CaseConnect Pulse/` on Windows, `~/Library/Application Support/CaseConnect Pulse/` on macOS)
- First launch in non-portable mode: app creates the OS standard folder automatically
- To convert installed → portable: user creates a `Data/` folder next to the exe and moves their database into it
- **Security note**: Even if the USB stick is lost, the database is encrypted via SQLCipher. Without the password, the data is unreadable.

**The Pitch**: "Works on any computer. Keep it on a USB drive. No IT approval needed. No installation. Plug in, work, unplug."

**Why this matters**: Probation officers using shared terminals. School social workers who don't have admin rights. Care coordinators who work from three different offices. They carry their entire caseload on a USB stick and leave zero footprint on the host machine.

**Shared terminals — multiple workers, one computer:**

Pulse's model is one encrypted database per install, not one database per user. There is no user account system and no multi-user login. This is by design — it keeps the app simple and avoids the complexity of user management.

When multiple workers share a physical computer (common in county offices, probation departments, school districts), each worker needs their OWN Pulse instance with their OWN database and their OWN password. The recommended pattern:

- **Best approach**: Each worker carries their own USB stick with portable Pulse + Data folder. Plug in, work, unplug. Each stick is encrypted with that worker's password. Zero data left on the shared machine. Zero risk of seeing someone else's caseload.
- **Alternative**: Multiple installed copies are NOT practical (they'd share the same AppData path). Instead, use portable mode with multiple Data folders on the local machine (e.g., `C:\Pulse\James\Data\`, `C:\Pulse\Sarah\Data\`) with separate shortcuts pointing to each. This is messier and less secure than the USB approach but works for environments where USB drives are prohibited by IT policy.
- **What to document on your website FAQ**: "Pulse is designed for individual caseloads. If you share a computer with coworkers, we recommend each person use their own USB drive with Pulse in portable mode. Your data never touches the shared computer, and it's encrypted with your personal password."
- **What NOT to build**: A multi-user login system. The moment you add user accounts to a local app, you inherit password reset flows, user management UI, access controls, and audit logging — none of which are core to the product. Keep it one-person-one-database.

### 7.13 Auto-Update System

The target user demographic will not hunt for updates manually. The app needs to handle this gracefully while respecting the offline-first philosophy.

#### Update Architecture

Uses `electron-updater` (part of `electron-builder`, already in the stack). Release artifacts hosted on GitHub Releases, which integrates natively with `electron-updater` at zero cost.

**How it works:**
1. On app launch (after password unlock), the app makes a single small HTTP request to check `latest.yml` at the GitHub Releases URL
2. If a newer version exists, a non-blocking banner appears at the top of the screen (below the TopBar, above the grid):
   - "Pulse 1.2 is available — improved dashboard and new export options. [Download Update] [Remind Me Later] [Skip This Version]"
3. User clicks [Download Update] → update downloads in the background with a subtle progress indicator in the status bar
4. When download completes: "Update ready. It will install next time you restart Pulse. [Restart Now]"
5. On next launch: new version is active. "What's New" modal appears.

**Installed versions** (.exe installer, .deb, .dmg):
- Full auto-update flow as described above
- `electron-updater` handles download, verification, and installation on restart
- The update replaces the application binary; the database and Data folder are untouched

**Portable versions** (.exe portable, .AppImage):
- Auto-update in place is not reliable — the .exe may be locked by the OS while running, the USB stick may be read-only, or the user may not have write permissions to the app's location
- Instead, the update banner shows: "Pulse 1.2 is available. [Download from Website] [Remind Me Later] [Skip This Version]"
- [Download from Website] opens the default browser to `pulse.caseconnect.com/download`
- User downloads the new portable .exe, replaces the old one next to their Data folder, done
- Data is untouched because it lives in the `Data/` folder, not inside the executable

#### Update Behavior Rules

- **Check once per launch**, not continuously. Single HTTP request on startup.
- **If no internet, fail silently.** No error, no warning, no indication that a check was attempted. The app works perfectly without updates. Most users will never have internet while using Pulse.
- **Never auto-restart.** Never interrupt work. Never download anything without the user initiating it.
- **Never force an update.** [Skip This Version] hides that specific version permanently. The user is never nagged about a version they've explicitly skipped. The next version they haven't skipped will trigger the banner.
- **[Remind Me Later]** suppresses the banner for 3 days.
- **Settings → About → "Check for Updates"** button for manual check.
- **Settings → General → "Check for updates on launch"** toggle (on by default). Can be turned off for truly air-gapped environments or users who don't want any network activity.
- The update check URL is the ONLY network request besides the one-time LemonSqueezy license activation. No telemetry, no analytics, no usage tracking is transmitted during the update check.

#### Database Migrations on Update

When a new version adds tables, columns, or changes schema, the database must be migrated on first launch of the new version. The migration system (Section 4) handles this automatically, but the update flow adds safety:

1. App launches with new version
2. Checks `schema_version` in `app_meta` table
3. If behind current version: **automatically creates a silent backup BEFORE running migrations** (separate from the regular auto-backup-on-close, named `pulse-pre-migration-YYYY-MM-DD-from-vX.X-to-vY.Y.db`)
4. Runs pending migrations in sequence, each inside a transaction
5. Updates `schema_version`
6. If any migration fails: rolls back the transaction, shows error: "Update requires a database change that failed. Your data is safe — a backup was created automatically. [Contact Support] [Try Again] [Restore Pre-Update Backup]"
7. On success: app loads normally, pre-migration backup is retained for 30 days then auto-deleted

**Migration safety rules:**
- Migrations must be backward-compatible where possible — add columns, don't rename or remove them
- If a migration is destructive (rare), the "What's New" modal should mention it explicitly
- Pre-migration backup means the user can always roll back to the previous version + previous database if something goes wrong

#### "What's New" Modal

After an update installs successfully:
- Simple modal: "Welcome to Pulse 1.2" with 3-5 bullet points of what changed
- Friendly tone, not a changelog dump. "You can now print multiple client profiles at once" not "Added EXPORT_PDF_BATCH IPC handler"
- [Got It] button dismisses. Not blocking — user can close it and get to work immediately.
- "Don't show release notes" checkbox for users who don't care
- This is how users discover new features. Without it, you ship improvements and nobody notices.

#### Release Channels (Post-Launch)

Not for v1, but the architecture should support it:
- **Stable**: What everyone gets. Default channel.
- **Beta**: Opt-in from Settings → About → "Join Beta Program" toggle. Points `electron-updater` at a separate `beta.yml` release file. Beta users get early access to new features and are your best testers. Beta builds show a small "BETA" badge in the TopBar.

#### IPC Channels

```typescript
// Add to existing IPC channels:
UPDATE_CHECK: 'update:check',              // Manual check from Settings
UPDATE_DOWNLOAD: 'update:download',         // User initiated download
UPDATE_INSTALL: 'update:install',           // Restart and install
UPDATE_SKIP_VERSION: 'update:skip-version', // Skip this version
UPDATE_GET_STATUS: 'update:get-status',     // Current update state for UI
```

#### Project Structure Additions

```
src/main/updater.ts                        # electron-updater config, check/download/install logic
src/renderer/components/shared/UpdateBanner.tsx  # Non-blocking top banner
src/renderer/components/shared/WhatsNewModal.tsx # Post-update release notes
```

#### Phase Assignment

**Phase 5** (Polish & Launch). The update mechanism should ship with v1 but doesn't need to exist during development. Build it last, test it with one real version bump (1.0.0 → 1.0.1) to verify the full flow end-to-end, and ship.

### 7.14 Data Management & Settings

#### Auto-Save
- Debounced 300ms after every edit
- Status bar: "Saving..." → "Saved ✓" (fades after 2s)
- Failure: persistent red banner with retry

#### Backup System (Three Layers)

**Layer 1: Silent Backup on Close (Automatic, Always On)**
- Every time the app closes, it silently copies the database to a `backups/` subfolder alongside the database
- File naming: `pulse-auto-YYYY-MM-DD-HHMMSS.db`
- **Rolling retention: keeps the last 5 copies, deletes oldest automatically**
- This happens in the background during the app `before-quit` event — user never sees it
- The `backups/` folder is created automatically on first launch
- In portable mode: `./data/backups/`; in installed mode: `~/.pulse/backups/` (or AppData equivalent)
- These auto-backups inherit SQLCipher encryption — they're copies of the encrypted database
- Accessible via: File → Restore from Auto-Backup → shows list of the 5 most recent with timestamps and file sizes
- **Why this exists**: When a user emails saying "I accidentally deleted my entire caseload," you reply "Go to File → Restore from Auto-Backup and pick yesterday's." Hero moment, zero effort.

**Layer 2: Scheduled Backup (Optional, Configurable)**
- Optional, off by default
- Settings: enable, interval (every 1/3/7 days), destination folder (user picks)
- Runs silently when app is open and interval has elapsed
- File naming: `pulse-scheduled-YYYY-MM-DD.db`
- Keeps last 10 scheduled backups in the destination folder
- Different from Layer 1: these go to a USER-CHOSEN location (external drive, different folder, etc.)
- Useful for users who want backups on a separate drive or USB stick

**Layer 3: Manual Backup / Pack & Go (On Demand)**
- File → Backup Now → system save dialog → user picks destination
- File naming: `pulse-backup-YYYY-MM-DD-HHMMSS.pulse-backup` (compressed .zip containing the .db)
- Compressed for sharing/archiving — the .zip is smaller than the raw .db
- Already encrypted via SQLCipher, no separate encryption step needed
- **Pack & Go**: Same as manual backup but framed for "moving between computers" use case
- Backup reminder: if no manual backup in X days (default 14, configurable), gentle toast on app open: "It's been X days since your last manual backup. [Backup Now] [Remind Later] [Dismiss]"

**Restore Flow**
- File → Restore from Auto-Backup: shows the 5 rolling auto-backups with dates/times/sizes. Click to preview, confirm to restore.
- File → Restore from File: system file picker for manual backups or Pack & Go files. Enter the backup's password (may differ from current). Preview contents (grid count, client count). Confirm overwrite.
- **Both restore paths**: "This will replace ALL current data. A backup of your current data will be created first." → auto-creates a pre-restore safety backup before overwriting.
- After restore: app reloads with restored data. Toast: "Restored from backup dated [date]."

#### Import System (CSV + Excel)

**This is the most important onramp to the app.** If a user can drag their messy Excel caseload spreadsheet into Pulse and it "just works," you've won them for life.

**Supported formats:**
- `.csv` (via papaparse)
- `.xlsx` and `.xls` (via SheetJS/xlsx library)
- Drag-and-drop onto the app window OR File → Import
- **Clipboard paste**: Ctrl+V in the grid or import wizard detects tab-separated data (from Excel Ctrl+A → Ctrl+C) and triggers the import flow. This covers users who have Excel open but don't know where the file is saved, or who just want to paste a subset of rows.

**Import Flow (same for CSV and Excel):**
1. User drops file or selects via file picker
2. **Sheet selection** (Excel only): if workbook has multiple sheets, show sheet tabs and let user pick
3. **Smart preview**: Show first 20 rows of raw data in a preview grid
4. **Auto-detection magic** — the app automatically:
   - Detects if row 1 is headers (heuristic: if row 1 has no numbers but row 2 does)
   - Guesses column types from sample values:
     - Dates: recognizes MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, M/D/YY, "January 15, 2026", etc.
     - Phone: recognizes (xxx) xxx-xxxx, xxx-xxx-xxxx, xxxxxxxxxx, +1xxxxxxxxxx
     - Email: contains @ and .
     - Numbers: all numeric values
     - Currency: starts with $ or contains $.XX pattern
     - Everything else: text
   - Auto-formats detected dates into the user's configured date format
   - Auto-formats detected phone numbers into (xxx) xxx-xxxx
   - Strips leading/trailing whitespace from all values
   - Detects and flags fully empty rows (offers to skip them)
5. **Column mapping**: Two-column interface:
   - Left: detected columns with type badge and sample values
   - Right: dropdown to map each to an existing Pulse column, "Create New Column (auto-type)", or "Skip"
   - Auto-match: if CSV header matches an existing column name (case-insensitive), auto-map it
   - "Map All Automatically" button attempts to match everything
6. **Options**:
   - Create new grid from import, or append to existing grid
   - **Duplicate detection** — configurable "match by" selector:
     - Match by: Name column (default) / Specific column (dropdown — e.g., Medicaid CIN, Case Number, Student ID) / Name + DOB combination / None (always create new)
     - When duplicates are detected: Skip duplicates / Overwrite existing with imported data / Always create new rows
     - **Why this matters**: Matching by name alone is fragile — you'll have two "Maria Rodriguez" entries. Matching by a unique identifier (CIN, case number) is more reliable. Name + DOB combination is the best compromise when no unique ID exists. The selector should default to name column but prominently offer alternatives.
     - Preview: "3 potential duplicates found" with expandable list showing matched pairs so user can verify before committing
   - "Clean up data" toggle (on by default): applies auto-formatting, trims whitespace, normalizes dates
7. **Import progress**: progress bar for large files
8. **Summary**: "Imported 47 clients. Skipped 3 duplicates. 2 cells had format warnings." with reviewable warning list.
9. **Warning list**: "Row 23: 'not-a-date' in column 'DOB' — imported as text" — non-fatal, data still imported

**Add to dependencies:**
```
- xlsx (SheetJS — for .xlsx/.xls parsing)
```

**Add to project structure:**
```
src/main/excel-io.ts               # Excel file parsing via SheetJS
src/renderer/components/shared/ImportWizard.tsx  # Multi-step import dialog
```

#### Export

**Standard Exports:**
- CSV: full grid or filtered, column selection, date format option
- PDF Profile: jspdf, professional layout, CONFIDENTIAL footer
- PDF Grid: jspdf-autotable, landscape, paginated
- Print: Ctrl+P with @media print styles

**Supervisor Report Export (NEW — viral growth feature)**

Every worker reports to a supervisor. Usually this means re-typing data into a messy Word doc or copying from their spreadsheet. Pulse generates a professional report automatically.

- File → Export → Supervisor Report
- **Report layout:**
  - **Header**: Worker name, date range, grid name
  - **Caseload Summary** (top of report):
    - Total active clients
    - New clients added this period
    - Clients discharged/archived this period
    - Items completed this period
    - Items currently overdue
    - Average days to deadline across caseload
  - **Critical Issues** (listed first, sorted by severity):
    - All overdue items with client name, item type, days overdue
    - All items due in next 7 days
  - **Caseload Roster**: Clean table of all active clients with key columns (user picks which columns to include)
  - **Activity Log** (optional): Summary of case log entries for the period, grouped by client
  - **Footer**: "Generated by CaseConnect Pulse — pulse.caseconnect.com — [date]"
- **Output formats**: PDF (default), CSV (for supervisors who want to aggregate in Excel)
- **Date range picker**: This week, this month, last month, custom range
- **The virality hook**: When a supervisor sees one worker turning in beautiful, organized reports instantly, they ask "How are you doing this?" The worker says "CaseConnect Pulse." The supervisor buys licenses for the whole team. One user becomes ten.

#### Command Palette (Ctrl+K)
- cmdk library, fuzzy search
- Top-center, 560px max width
- **Cross-grid client search**: Searches client names across ALL grids, not just the current one. Results show client name + grid name badge (e.g., "Maria Rodriguez — Active Caseload"). Selecting a cross-grid result switches to that grid and opens the profile. This is the primary way to find a client when you don't remember which grid they're in.
- **Search scope indicator**: Small text below the search input: "Searching all grids" or "Searching [Grid Name]" with a toggle

**Enumerated command palette actions** (Claude Code should implement all of these):
| Command | Action |
|---------|--------|
| Client names | Navigate to profile (cross-grid) |
| `overdue` | Show all overdue items inline with client names |
| `due today` / `due this week` | Show items due in timeframe |
| `archive [name]` | Archive a specific client |
| `add client` | Quick-add row to current grid |
| `add column` | Open column creation dialog |
| `backup` / `backup now` | Trigger manual backup immediately |
| `lock` | Lock the app |
| `settings` | Open settings |
| `focus` / `focus mode` | Enter Focus Mode |
| `dashboard` | Switch to Dashboard view |
| `grid` | Switch to Grid view |
| `import` | Open import wizard |
| `export` | Open export options |
| `print` | Print current view |
| `theme` / `dark mode` / `light mode` | Toggle theme |
| `shortcuts` / `help` | Show keyboard shortcuts |
| Recent profiles | Last 10 visited, shown as a section when palette opens with empty query |

#### Settings Page
- **Appearance**: Theme (light/dark/system), accent color, font size (small 13px/medium 15px/large 17px), date format, time format, row height
- **Security**: Change password (requires current password), recovery key management (generate/regenerate/revoke — see Section 4), password hint (view/edit), auto-lock timer (disabled/5/10/15/30/60 minutes of inactivity, default 30), pause auto-lock toggle, lock now button
- **Grid**: default column width, alternating rows, gridlines, row numbers, confirm before delete
- **Alerts**: default rule for new date columns, notification style, startup notification on/off
- **Backup**: reminder interval, auto-backup on/off + interval + location, default encryption
- **Snippets**: manage text expander shortcuts
- **Data**: DB location, DB size, total clients, edit history retention (6mo/12mo/24mo/forever, default 12mo), compact history button, export all, danger zone (reset)
- **Shortcuts**: full reference table
- **About**: version, license status, links

---

## 8. Navigation & Layout

### App Shell
```
┌──────────────────────────────────────────────────────┐
│  TopBar: [☰] [Pulse] [🔍 Search/Ctrl+K]  [⚙] [Pro] │
│          [← Back] [Breadcrumb]                       │
├────────┬─────────────────────────────────────────────┤
│        │                                             │
│Sidebar │           Main Content                      │
│        │                                             │
│📊 Grid │   GridView / DashboardView /                │
│📋 Dash │   ProfileView / SettingsView /              │
│🎯 Focus│   FocusView / TasksView /                   │
│📌 Tasks│   TemplateManager                           │
│📁 Templ│                                             │
│⚙ Sett │                                             │
│        │                                             │
│────────│                                             │
│Grids:  │                                             │
│● My    │                                             │
│  Case  │                                             │
│○ Side  │                                             │
│+ New   │                                             │
├────────┴─────────────────────────────────────────────┤
│  [💾 Saved ✓]  [47 clients]  [Grid: My Caseload]    │
└──────────────────────────────────────────────────────┘
```

### Sidebar
- 220px expanded, 48px collapsed (icon-only with tooltips)
- Toggle: hamburger or Ctrl+\
- Sections: Nav items, divider, grids list, + New Grid
- Remembers state
- **Grid list reordering**: Drag-to-reorder grids in the sidebar list. Order persists (stored in electron-store or a `grids.sidebar_position` column). For users with 3-4 grids representing a workflow pipeline (Outreach → Active → Discharged), the spatial order tells a story. Right-click grid name → Rename, Duplicate, Delete, Move Up, Move Down (for keyboard/accessibility alternative to drag).

### Keyboard Shortcuts

**Global:**
| Key | Action |
|-----|--------|
| Ctrl+K | Command palette |
| Ctrl+1 | Grid View |
| Ctrl+2 | Dashboard |
| Ctrl+3 | Tasks View |
| Ctrl+F | Focus search |
| Ctrl+N | Quick-add row |
| Ctrl+Shift+T | Quick-add caseload task |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+, | Settings |
| Ctrl+B | Backup now |
| Ctrl+\ | Toggle sidebar |
| Ctrl+P | Print |
| Ctrl+L | Lock app (return to password screen) |
| Ctrl+Shift+L | Toggle pause auto-lock |
| Ctrl+Shift+F | Focus Mode |
| Escape | Close/deselect/back |
| ? | Shortcuts reference |

**Grid:**
Arrows, Enter, F2, Tab, Space, Delete, Ctrl+D, Ctrl+A, Ctrl+C/V, Shift+Click, Home/End, Ctrl+Home/End

**Profile:**
Alt+Left/Right → prev/next client, Escape → back to grid

---

## 9. Onboarding (First Run)

**Step 1: Welcome** — Logo, tagline, "set up in 2 minutes"

**Step 2: Set Your Password** — This is the most critical onboarding step.
- "Your data is encrypted and stored only on this computer. Set a password to protect it."
- Password field + confirm password field
- Password strength indicator (weak/medium/strong)
- Optional password hint field ("This hint will be shown if you forget your password")
- **⚠️ Clear warning box**: "If you forget this password, your data CANNOT be recovered. There is no reset option. Write it down and store it somewhere safe."
- Minimum 6 characters, no other restrictions (don't annoy people)
- [Set Password & Continue] button
- **After password is set**: "Would you like to generate a Recovery Key?" prompt (see Recovery Key System in Section 4). Recommended but skippable. If generated, shown once with [Print] / [Copy] / [I've Saved It] options. This is the user's lifeline if they forget their password months from now.

**Step 3: How do you want to get started?** — Three cards, equal prominence:

- 📋 **Set up from scratch** → the guided interview flow (Step 3A below)
- 📥 **Import my existing spreadsheet** → the import-first flow (Step 3B below)
- 📄 **Use a pre-built template** → template picker with role-based cards (Step 3C below)

> **Design philosophy**: The most common first-time experience for the target user isn't "I'm starting fresh" — it's "I already have 50 clients in a spreadsheet and I need to get them into this thing." The onboarding must support this path as a first-class citizen, not bury the import wizard behind a File menu after setup. A user should go from install to "my entire caseload is in Pulse with alerts configured" in about 5 minutes.

---

**Step 3A: Guided Setup Interview (from scratch path)**

Instead of picking a template from a list (which assumes users know what they want), walk them through a conversational setup that builds their grid interactively.

> A template picker assumes the user understands the template's contents. Most users don't — they pick one that sounds close and then spend 20 minutes confused about columns they don't need. An interview-style setup asks plain questions and builds the right grid from the answers. It feels personal, not generic.

**The Interview Flow:**

**3A-i. "What do you do?"** — Role selection, but framed as context rather than template selection.
- Cards: Care Coordinator, Social Worker, IEP/Special Ed Coordinator, Probation/Parole Officer, Therapist/Counselor, Other
- Selecting a role pre-fills suggested columns and alerts in the next steps (but the user sees and controls every choice)
- "Other" starts with a minimal default set (Name, Status, Phone, Email, Notes)
- This step is about seeding smart defaults, NOT locking them into a template

**3A-ii. "What do you need to track for each person?"** — Column builder interview.
- Shows a checklist of common fields, pre-checked based on role selection:
  - ☑ Name (always on, required)
  - ☑ Date of Birth / ☐ Age
  - ☑ Phone / ☑ Email / ☐ Address
  - ☑ Status (Active/Inactive/etc.)
  - ☐ Medicaid CIN / ☐ Case Number / ☐ Student ID (role-dependent suggestions)
  - ☐ Insurance / ☐ Diagnosis / ☐ Assigned Worker
  - ☐ Notes
- User checks/unchecks what they need
- **"+ Add your own"** button at the bottom: text field + type selector (Date, Text, Number, Dropdown, Checkbox). User can add as many custom columns as they want.
- For each column, user can rename it inline (e.g., "Case Number" → "TABS ID")
- **Keep it scannable**: Show 8-10 suggested items, not 25. Less is more here.

**3A-iii. "What deadlines do you need to track?"** — Alert setup interview.
- Only shown if the user checked any date-type columns (or added custom date columns)
- For EACH date column the user selected, ask:
  - "How often does **[Column Name]** repeat?" → Never / Monthly / Quarterly / Semi-Annual / Annual / Custom (enter days)
  - "When should Pulse start warning you?" → Quick presets: "2 weeks before" / "30 days before" / "90 days before" / "Let me customize" → opens threshold picker with the visual timeline
- Pre-fills smart defaults based on role:
  - OPWDD Care Coordinator: POC = 180 days, Life Plan = 365 days, Assessment = 365 days
  - IEP Coordinator: Annual Review = 365 days, Triennial = 1095 days
  - Probation: Monthly Check-In = 30 days, Court Date = no cycle
- Users can skip this entirely: "I'll set up alerts later" link at the bottom

**3A-iv. Preview & Confirm** — Shows the grid they've built:
- Mini-preview with their column names, types, and any alert rules
- "This is your starting point. You can add, remove, or change anything later."
- [Create My Caseload] button (primary)
- [Start Over] link (secondary)

→ After creation, proceeds to Step 4 (Add First Client).

---

**Step 3B: Import My Existing Spreadsheet (import-first path)**

This is the onramp for the most common new user: someone who already has a caseload in Excel and wants to migrate.

**3B-i. Drop or select your file.**
- Large drag-and-drop zone: "Drop your Excel or CSV file here, or click to browse"
- Accepts `.xlsx`, `.xls`, `.csv`
- Also supports **clipboard paste**: "Or paste from Excel (Ctrl+V)" — detects tab-separated clipboard data from Excel Ctrl+A → Ctrl+C. This covers users who have the file open but don't know where it's saved.

**3B-ii. Import wizard (same as Section 7.13)**
- Sheet selection (Excel multi-sheet), smart preview, auto-detection, column mapping
- All the same import wizard steps described in the Data Management section
- One addition for onboarding context: the column mapping step includes type detection badges (Date, Phone, Email, etc.) with a note: "Pulse detected these column types automatically. You can change them now or anytime later."

**3B-iii. Post-import alert setup** — This is the bridge between import and intelligence.
- After import completes, Pulse scans the imported columns for date-type columns
- If date columns are found: "We noticed you have date columns. Want to set up deadline alerts?"
- Shows each detected date column with a quick-config row:
  - **[Column Name]** — Repeat: [Never ▾] — Warn me: [30 days before ▾]
  - Pre-fills smart defaults if column names match known patterns (e.g., a column named "POC Due" or "Annual Review" gets auto-suggested cycle lengths)
- [Set Up Alerts] or [Skip — I'll do this later]
- This step takes 30 seconds and transforms a dumb spreadsheet import into an intelligent caseload with deadline tracking. It's the "aha moment" for the import path.

**3B-iv. Import summary**
- "Imported 47 clients with 12 columns. 3 deadline alerts configured."
- [Go to My Caseload] button

→ Skips Step 4 (Add First Client) since the grid is already populated. Proceeds to Step 5 (Quick Tour).

---

**Step 3C: Use a Pre-Built Template**

For users who know exactly what they want or are setting up a second grid.
- Template picker with role-based cards showing column counts and descriptions
- Cards: OPWDD Care Coordinator, General Social Worker, IEP Coordinator, Probation Officer, Therapist, Start from Scratch
- Selecting a card shows a preview of columns, alert rules, and checklists included
- [Use This Template] → creates grid → proceeds to Step 4

---

**Step 4: Add First Client** (optional, skipped if import path was used) — Name + DOB + one other field. [Add] or [Skip]. Having one real row makes the grid feel alive instead of empty.

**Step 5: Quick Tour** (optional, 6 steps) — Grid, adding clients, deadline colors, profiles, dashboard, backup reminder. Re-triggerable from Settings.

**Template system still exists** — The pre-built templates (OPWDD, Social Worker, IEP, etc.) ship with the app and are available via Template Manager at any time. The onboarding offers all three paths equally; templates are not buried.

---

## 10. UI/UX Design Guidelines

### Colors
```
Light theme:
  bg-primary: #FFFFFF, bg-secondary: #F8FAFC, bg-sidebar: #F1F5F9
  text-primary: #1E293B (slate-900, NEVER #000000), text-secondary: #64748B
  border: #E2E8F0 (use gray-300+ for grid borders — chunky, visible)
  accent: #2563EB (customizable)
  alerts: green #22C55E, yellow #EAB308, orange #F97316, red #EF4444, pulse #DC2626
  star: #F59E0B
  sticky-note-bg: #FFFBEB

Dark theme: slate-900 backgrounds, slate-100 text, same alert colors
```

### Typography
- System font stack
- Grid cells: **15px** (comfortable) — NOT 13px. This is for social workers, not developers.
- Body: 15px, Headers: 16px semi, Titles: 20px bold, Profile name: 28px bold
- Monospace for CIN/case numbers

### Layout
- Row height: 36/44/52px (compact/comfortable/spacious)
- Card padding: 16px, radius: 8px
- Sidebar: 220px/48px
- Status bar: 28px, TopBar: 48px
- Min window: 900x600

### Animations
- Cell edits: none (instant)
- Page transitions: 150ms ease-out
- Modals: 200ms scale+fade
- Pulse: 2s cycle, opacity 1→0.7→1 (respect prefers-reduced-motion)
- Toast: slide from bottom-right, 5s dismiss
- Undo toast: bottom-center, 8s with countdown bar

### Focus & Accessibility
- **Thick 2px focus rings** on all interactive elements
- **High-contrast borders**: Use gray-300+ for grid borders, NOT subtle grays. Grid lines should be clearly visible. The UI should feel chunky and solid, not airy and minimal.
- Never rely on color alone — **ALWAYS pair with text labels, icons, or shapes**:
  - Overdue cells: red background + ⚠️ warning icon + "X days overdue" text
  - Urgent cells: orange background + ⏰ clock icon + "X days" text
  - Due soon cells: yellow background + 📅 calendar icon + "X days" text
  - Checked items: ✓ checkmark, not just a filled box
  - Starred rows: ★ filled star shape, not just gold color
  - Error states: 🔴 red circle icon + descriptive text ("Date must be in MM/DD/YYYY format")
- This is critical for **colorblind users** (8% of men). A red and green cell look identical to someone with deuteranopia. The icon + text makes it unambiguous.
- 4.5:1 contrast minimum (WCAG AA)
- ARIA: role="grid", role="row", role="gridcell"
- Test at 100%, 125%, 150% zoom
- Respect prefers-reduced-motion
- Descriptive errors: "Date must be in MM/DD/YYYY format" not just red border

---

## 11. IPC Channels

```typescript
export const IPC = {
  // Grid
  GRID_GET_ALL: 'grid:get-all', GRID_GET: 'grid:get',
  GRID_CREATE: 'grid:create', GRID_UPDATE: 'grid:update',
  GRID_DELETE: 'grid:delete', GRID_REORDER: 'grid:reorder',

  // Columns
  COLUMN_CREATE: 'column:create', COLUMN_UPDATE: 'column:update',
  COLUMN_DELETE: 'column:delete', COLUMN_REORDER: 'column:reorder',
  COLUMN_BATCH_UPDATE: 'column:batch-update',

  // Rows
  ROW_CREATE: 'row:create', ROW_UPDATE: 'row:update',
  ROW_DELETE: 'row:delete', ROW_ARCHIVE: 'row:archive',
  ROW_UNARCHIVE: 'row:unarchive', ROW_REORDER: 'row:reorder',
  ROW_DUPLICATE: 'row:duplicate', ROW_BULK_ACTION: 'row:bulk-action',
  ROW_GET_ALL: 'row:get-all',

  // Cells
  CELL_UPDATE: 'cell:update', CELL_BULK_UPDATE: 'cell:bulk-update',
  CELL_GET_HISTORY: 'cell:get-history',

  // Sort & Filter
  SORT_UPDATE: 'sort:update', SORT_CLEAR: 'sort:clear',
  FILTER_UPDATE: 'filter:update', FILTER_CLEAR: 'filter:clear',
  SAVED_FILTER_GET_ALL: 'saved-filter:get-all',
  SAVED_FILTER_CREATE: 'saved-filter:create',
  SAVED_FILTER_DELETE: 'saved-filter:delete',
  SAVED_VIEW_GET_ALL: 'saved-view:get-all',
  SAVED_VIEW_CREATE: 'saved-view:create',
  SAVED_VIEW_UPDATE: 'saved-view:update',
  SAVED_VIEW_DELETE: 'saved-view:delete',

  // Alerts
  ALERT_RULE_GET_ALL: 'alert-rule:get-all',
  ALERT_RULE_CREATE: 'alert-rule:create',
  ALERT_RULE_UPDATE: 'alert-rule:update',
  ALERT_RULE_DELETE: 'alert-rule:delete',

  // Checklists
  CHECKLIST_GET: 'checklist:get',
  CHECKLIST_CREATE_ITEM: 'checklist:create-item',
  CHECKLIST_UPDATE_ITEM: 'checklist:update-item',
  CHECKLIST_DELETE_ITEM: 'checklist:delete-item',
  CHECKLIST_APPLY_TEMPLATE: 'checklist:apply-template',
  CHECKLIST_REORDER: 'checklist:reorder',
  CHECKLIST_RESET_CYCLE: 'checklist:reset-cycle',

  // Case Log
  CASE_LOG_GET: 'case-log:get',
  CASE_LOG_CREATE: 'case-log:create',
  CASE_LOG_UPDATE: 'case-log:update',
  CASE_LOG_DELETE: 'case-log:delete',
  CASE_LOG_TOGGLE_PIN: 'case-log:toggle-pin',
  CASE_LOG_COMPLETE_FOLLOWUP: 'case-log:complete-followup',

  // Scrap Notes
  SCRAP_NOTE_GET: 'scrap-note:get',
  SCRAP_NOTE_UPDATE: 'scrap-note:update',

  // Document Refs
  DOCUMENT_REF_GET_ALL: 'document-ref:get-all',
  DOCUMENT_REF_CREATE: 'document-ref:create',
  DOCUMENT_REF_UPDATE: 'document-ref:update',
  DOCUMENT_REF_DELETE: 'document-ref:delete',
  DOCUMENT_REF_OPEN: 'document-ref:open',

  // Tags
  TAG_GET_ALL: 'tag:get-all', TAG_CREATE: 'tag:create',
  TAG_UPDATE: 'tag:update', TAG_DELETE: 'tag:delete',
  TAG_ASSIGN: 'tag:assign', TAG_UNASSIGN: 'tag:unassign',

  // Templates
  SETUP_TEMPLATE_GET_ALL: 'setup-template:get-all',
  SETUP_TEMPLATE_IMPORT: 'setup-template:import',
  SETUP_TEMPLATE_EXPORT: 'setup-template:export',
  SETUP_TEMPLATE_APPLY: 'setup-template:apply',
  SETUP_TEMPLATE_CREATE: 'setup-template:create',
  SETUP_TEMPLATE_DELETE: 'setup-template:delete',
  CL_TEMPLATE_GET_ALL: 'cl-template:get-all',
  CL_TEMPLATE_CREATE: 'cl-template:create',
  CL_TEMPLATE_UPDATE: 'cl-template:update',
  CL_TEMPLATE_DELETE: 'cl-template:delete',
  LETTER_TEMPLATE_GET_ALL: 'letter-template:get-all',
  LETTER_TEMPLATE_CREATE: 'letter-template:create',
  LETTER_TEMPLATE_UPDATE: 'letter-template:update',
  LETTER_TEMPLATE_DELETE: 'letter-template:delete',
  LETTER_TEMPLATE_GENERATE: 'letter-template:generate',

  // Snippets
  SNIPPET_GET_ALL: 'snippet:get-all',
  SNIPPET_CREATE: 'snippet:create',
  SNIPPET_UPDATE: 'snippet:update',
  SNIPPET_DELETE: 'snippet:delete',

  // Dashboard
  DASHBOARD_GET_DEADLINES: 'dashboard:get-deadlines',
  DASHBOARD_GET_STATS: 'dashboard:get-stats',
  DASHBOARD_GET_COMPLETED: 'dashboard:get-completed',
  DASHBOARD_GET_FOLLOWUPS: 'dashboard:get-followups',

  // Data Management — Backup (3 layers)
  BACKUP_AUTO_ON_CLOSE: 'backup:auto-on-close',       // Layer 1: silent backup during quit
  BACKUP_AUTO_LIST: 'backup:auto-list',                 // List rolling auto-backups
  BACKUP_SCHEDULED_RUN: 'backup:scheduled-run',         // Layer 2: scheduled backup
  BACKUP_MANUAL_CREATE: 'backup:manual-create',         // Layer 3: manual/Pack & Go
  BACKUP_RESTORE_AUTO: 'backup:restore-auto',           // Restore from auto-backup
  BACKUP_RESTORE_FILE: 'backup:restore-file',           // Restore from file
  BACKUP_GET_INFO: 'backup:get-info',                   // Preview backup contents
  EXPORT_CSV: 'export:csv', EXPORT_PDF_PROFILE: 'export:pdf-profile',
  EXPORT_PDF_GRID: 'export:pdf-grid',
  EXPORT_PDF_BATCH: 'export:pdf-batch',                // Multi-client batch print
  EXPORT_SUPERVISOR_REPORT: 'export:supervisor-report',  // Supervisor report PDF/CSV
  IMPORT_FILE: 'import:file',                             // CSV or Excel import
  IMPORT_FILE_PREVIEW: 'import:file-preview',             // Parse and preview before importing
  IMPORT_DETECT_COLUMNS: 'import:detect-columns',         // Auto-detect column types

  // Settings
  SETTINGS_GET: 'settings:get', SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_UPDATE: 'settings:update',

  // Undo
  UNDO: 'action:undo', REDO: 'action:redo',

  // App
  APP_GET_INFO: 'app:get-info',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_SHOW_FILE_DIALOG: 'app:show-file-dialog',
  APP_SHOW_SAVE_DIALOG: 'app:show-save-dialog',

  // Auth & Security
  AUTH_SETUP_PASSWORD: 'auth:setup-password',     // First-time password creation
  AUTH_VERIFY_PASSWORD: 'auth:verify-password',     // Unlock attempt
  AUTH_CHANGE_PASSWORD: 'auth:change-password',     // Change password (re-wraps DB key)
  AUTH_LOCK: 'auth:lock',                           // Lock app (close DB connection)
  AUTH_GET_HINT: 'auth:get-hint',                   // Retrieve password hint
  AUTH_IS_SETUP: 'auth:is-setup',                   // Check if password has been set
  AUTH_GENERATE_RECOVERY_KEY: 'auth:generate-recovery-key',   // Generate/regenerate recovery key
  AUTH_VERIFY_RECOVERY_KEY: 'auth:verify-recovery-key',       // Unlock via recovery key
  AUTH_REVOKE_RECOVERY_KEY: 'auth:revoke-recovery-key',       // Remove recovery key
  AUTH_HAS_RECOVERY_KEY: 'auth:has-recovery-key',             // Check if recovery key exists
} as const;
```

---

## 12. Development Phases

### Phase 1: Foundation & Core Grid (MVP) — 4-6 weeks

> **⚠️ CRITICAL: SQLCipher Build Validation (Do This First)**
> `@journeyapps/sqlcipher` requires native compilation via `node-gyp`, which means platform-specific C/C++ build toolchains (Visual Studio Build Tools on Windows, Xcode CLI on macOS, `build-essential` + `libsqlcipher-dev` on Linux). Native module compilation is the #1 cause of Electron build failures. **Before writing any UI code**, validate that `@journeyapps/sqlcipher` compiles, links, and runs a basic `PRAGMA key` + `PRAGMA schema_version` test on all three target platforms. If the native module doesn't compile cleanly, nothing else matters. Troubleshoot and resolve build issues here before proceeding. Consider using `electron-rebuild` to ensure the native module is compiled against Electron's Node headers rather than the system Node.

1. **Validate SQLCipher native build** on Windows, Linux, and macOS — compile, link, open encrypted DB, run test query (see warning above)
2. Init Electron + React + TypeScript + electron-vite
3. Tailwind CSS with theme tokens
4. **SQLCipher database setup**: encrypted SQLite with password-based key derivation, schema, migration system
5. **Password system with key wrapping**: first-launch password creation screen, optional recovery key generation, lock screen on every launch, auto-lock timer, Ctrl+L manual lock, password change in settings. Uses key wrapping pattern (random DB key wrapped by password-derived key) to enable recovery keys and password changes without re-keying the database.
5. IPC communication layer
6. App shell: sidebar, topbar, status bar, main area
7. DataGrid with @tanstack/react-table + virtual scrolling
8. Column types: text, date, number, checkbox, dropdown
9. Cell editing with type-appropriate editors
10. Column management: add, rename, resize, reorder, hide, delete
11. Row management: add, delete, reorder
12. Single-column and multi-column sorting with persistence
13. Real-time search (debounced 150ms)
14. Auto-save (debounced 300ms) with status indicator
15. Light/dark theme
16. Window state persistence
17. Cross-platform builds: Windows portable .exe + .zip (primary), Linux .AppImage, macOS .dmg — portable-first data storage strategy
18. Cloud sync path warning on startup
19. **Silent backup on close**: auto-copy database to `backups/` folder, rolling 5 copies

**Exit:** Grid works, data persists and is encrypted, password protection functional, auto-backup on close working, sorting works, runs on all platforms.

### Phase 2: Intelligence Layer — 3-4 weeks
1. Alert rules: data model, CRUD, pre-built templates
2. Alert rule editor with visual timeline preview
3. Deadline computation engine
4. Cell rendering with alert colors + pulse animation
5. Morning Briefing screen (post-unlock launch screen with overdue/due this week/follow-ups pending — see Section 7.9)
6. Dashboard: stat cards, Priority List tab, This Week tab
7. Calendar heatmap
8. Dashboard → profile navigation
9. Computed columns: age_from_dob, calculated_days
10. Conditional formatting

**Exit:** Deadlines glow. Dashboard shows priorities. App tells you what to do.

### Phase 3: Profiles & Workflow — 3-4 weeks
1. Profile view with router, breadcrumbs, prev/next navigation
2. Profile header with identifiers, star, tags, quick actions
3. Deadline panel
4. Checklist with priorities, drag-reorder, progress bar, templates
5. Rich text scrap notes (tiptap)
6. Case log with types, follow-up tracking, pinning, search
7. Auto-generated system entries
8. Activity timeline
9. Contact info panel
10. Document references
11. Grid data summary (editable)
12. Snippet/text expander system
13. Print-friendly CSS
14. Recent profiles
15. **Caseload-level tasks**: table creation, Tasks view, task CRUD (add/edit/complete/delete), recurrence engine with cycle advancement, sidebar nav item, Ctrl+Shift+T shortcut, pre-built task templates seeded from onboarding role selection

**Exit:** Rich client profiles with everything a care coordinator needs. Caseload-level admin tasks have a home.

### Phase 4: Templates & Data — 2-3 weeks
1. Checklist template CRUD + recurring cycle reset
2. Setup template save/export/import using `.pulse` file format (see Section 18)
3. `.pulse` file association: register on install (Windows/macOS/Linux), handle open-file on launch to route to import preview
4. CSV export (full/filtered, column selection)
5. Import system: CSV + Excel (.xlsx/.xls) with smart auto-detection, column mapping, and data cleanup
6. PDF export (profile + grid + **batch print multi-client PDF**)
7. **Supervisor Report export** (PDF/CSV with caseload stats, critical issues, roster)
8. Scheduled backup system (Layer 2 — configurable interval and destination)
9. Manual backup / Pack & Go with compression (Layer 3)
10. Restore flow: auto-backup list, file picker, pre-restore safety copy
11. Backup reminder notifications
12. Letter templates / mail merge

**Exit:** Templates shareable via `.pulse` files, data portable, backups secure.

### Phase 5: Polish & Launch — 2-3 weeks
1. Onboarding wizard
2. Command palette (Ctrl+K)
3. Multiple grids with "Move to Grid..." and "Copy to Grid..." functionality:
   - **Move to Grid**: right-click row → Move to Grid → select target grid. Matching columns transfer data automatically; non-matching columns left blank. Original row optionally archived or deleted. Supports workflows like Outreach → Active Caseload → Discharged.
   - **Copy to Grid**: right-click row → Copy to Grid → select target grid. Creates an independent copy in the target grid. Original row remains untouched. Supports workflows where the same client exists across different contexts — e.g., residential services vs. day programs, or a shared client across two caseload grids with different column structures. Copied row gets its own checklists, case log, and scrap notes (empty — not duplicated from source). Grid Data Summary values copy over for matching columns.
   - Both actions available via context menu and bulk action bar (multi-select → Move/Copy to Grid).
4. Saved views + saved filter presets
5. Advanced filtering with operators
6. Undo/redo system
7. Tagging system
8. Row archiving, starring, color labels, duplication
9. Multi-select + bulk actions
10. Row numbers, grid footer strip
11. Context menus (row, column, cell)
12. Cell history tracking
13. All remaining column types
14. Focus Mode / Today View
15. **Caseload task integrations**: Morning Briefing section, Focus Mode section, Dashboard summary card, Priority List interleaving, Command Palette commands (`tasks`, `add task`), Supervisor Report optional section, snooze functionality
16. Full keyboard shortcuts
16. Settings page (all sections)
17. Dashboard: Month, Completed, Archived, Follow-Ups tabs
18. Free tier limit (15 clients, all features unlocked) — single client count check against license state in electron-store
19. License key system via LemonSqueezy (see Section 17)
20. Portable mode (Windows)
21. Accessibility audit
22. Cross-platform QA

**Exit:** Production-ready, professional, accessible, distributable.

---

## 13. Pre-Built Templates (Ship With App)

### Setup Templates
- **OPWDD Care Coordinator**: 15 columns + POC/Assessment/Life Plan alerts + intake/review checklists
- **General Social Worker**: 11 columns + quarterly review/monthly contact alerts
- **IEP Coordinator**: 15 columns + annual IEP/triennial re-eval alerts
- **Probation Officer**: 12 columns + monthly check-in/court date alerts
- **Therapist**: 13 columns + quarterly treatment plan alert

### Checklist Templates
New Client Intake, Annual Review Prep, Discharge Planning, Home Visit Prep, Monthly Check-In

---

## 14. Performance Requirements

- Grid: 200×20 at 60fps, 500×30 usable with virtual scroll
- Cell edit → save: <100ms
- Search/filter: <200ms for 500 rows
- Sort: <300ms single, <500ms multi (500 rows)
- App cold start: <3s; warm: <1.5s
- Profile load: <500ms
- Dashboard: <1s for 500 clients
- CSV import: <5s for 500 rows
- Memory: <300MB; package: <200MB

---

## 15. Security & Data Protection

### Database Encryption (FOUNDATIONAL — Phase 1)
- **All user data is encrypted at rest** using SQLCipher (AES-256-CBC)
- Database file is unreadable binary without the encryption key — not just a UI lock, real encryption
- Uses `@journeyapps/sqlcipher` as a drop-in replacement for `better-sqlite3`
- **Key wrapping architecture**: The actual database encryption key is a random 256-bit key. The user's password (and optionally a recovery key) each independently wrap this DB key via PBKDF2 derivation. Either the password or recovery key can unwrap the DB key to open the database. This enables password changes and recovery without re-encrypting the entire database.
- No backdoor, no server-side recovery. User loses password AND has no recovery key = data is gone. This is by design and clearly communicated during setup.

### Password System
- **First launch**: Password creation during onboarding (Step 2), followed by optional recovery key generation
- **Every launch**: Lock screen with password prompt before any data is accessible
- **Auto-lock**: Configurable inactivity timer (default 30 min, 0=disabled). After timeout, app returns to lock screen. Database connection is closed on lock.
  - **Default is 30 minutes, not 15.** Care coordinators spend 30+ minutes on phone calls where they're not touching the keyboard. A 15-minute default causes lock-outs mid-conversation, forcing re-authentication and breaking flow. 30 minutes balances security with real-world usage patterns. Security-conscious users can tighten it in Settings.
  - **"Pause auto-lock" toggle**: Status bar shows a small lock icon. Click → "🔓 Auto-lock paused for this session." Click again → re-enables. Also accessible via Ctrl+Shift+L. Paused state does NOT persist across app restarts — next launch resets to the configured timer. This is for "I'm on a long phone call right now" situations, not a permanent override.
  - **Inactivity detection**: Monitors keyboard, mouse, and trackpad input. System-level sleep/hibernate always triggers lock regardless of pause state.
- **Manual lock**: Ctrl+L or File menu → Lock App
- **Change password**: Settings → Security (requires current password). Under the hood: unwrap the DB encryption key with old password, re-wrap with new password in electron-store. The SQLCipher database key itself does not change — only the wrapping changes. Recovery key (if active) is unaffected.
- **Recovery key**: Optional, generated during onboarding or later in Settings → Security. See "Recovery Key System" in Section 4.
- **Password hint**: Optional, stored in electron-store (unencrypted, by design — it's a hint, not the password)
- **Failed attempts**: No lockout (this is a local app, not a server). Just show "Incorrect password" with hint if available.
- **Password hash**: bcrypt hash stored in electron-store for quick pre-validation before attempting the slower key unwrap + SQLCipher open.

### Lock Screen Behavior
- Shows app logo, password field, hint link, and a "Forgot Password?" info box
- "Forgot Password?" shows TWO paths:
  1. **"I have a Recovery Key"** → recovery key input field → if valid, unlocks database AND immediately prompts user to set a new password (recovery key is a lifeline, not a daily-use credential)
  2. **"I don't have a Recovery Key"** → "Your data is encrypted with your password. Without it or a recovery key, data cannot be recovered. If you have a backup file, you can restore from it by reinstalling the app."
- On successful unlock: database connection opened, app loads normally
- On app close: database connection closed, encryption key cleared from memory

### Backup Security
- All three backup layers (auto-on-close, scheduled, manual) produce encrypted files — they're copies of the SQLCipher database
- No separate backup encryption step needed
- **Important**: If user changes their password, existing backups still use the OLD password. Warn user: "After changing your password, consider creating a new manual backup. Old backups will require your previous password to restore."
- Auto-backup-on-close folder (`backups/`) should inherit the same file permissions as the database (0600 on Linux/macOS)

### Network Security
- Zero HTTP requests in normal operation. CSP: `default-src 'self'`
- **One exception**: A single HTTPS call to `api.lemonsqueezy.com` during Pro license activation (Phase 5). This is the ONLY network request the app ever makes. No telemetry, no analytics, no eval(), no remote code.
- After activation, the app never phones home again.

### Electron Hardening
- nodeIntegration: false
- contextIsolation: true
- sandbox: true
- webviewTag: false
- All IPC through contextBridge preload

### Input Security
- SQLCipher/SQLite: parameterized queries only (never string concatenation)
- File permissions: 0600 on Linux/macOS (owner-only read/write)

---

## 16. Error Handling

- Empty states: friendly illustrations + CTAs
- DB corruption: PRAGMA integrity_check on startup, backup restore guidance
- **Wrong password**: "Incorrect password" message with hint link. No lockout. No attempt limit.
- **Forgotten password**: If recovery key exists, user can unlock via recovery key and set a new password. If no recovery key, data cannot be recovered. Show guidance: "Restore from a backup if available, or reset the app to start fresh." Link to Settings → Data → Reset.
- **Password change failure**: If key re-wrapping fails, show error and keep old password active. The database encryption key is never lost because it remains wrapped by the existing password until the new wrapping succeeds.
- Disk full / permissions: persistent warning, retry queue
- Invalid CSV/template: specific error messages, skip options
- Missing document refs: "File not found" + re-link/remove
- Long text: ellipsis + tooltip
- Date edges: date-only (no time), local timezone for "today"
- Undo after close: inform user history clears

---

## 17. Licensing & Distribution

### Pricing Model
- **Free tier**: Full app with all features unlocked — alerts, templates, profiles, unlimited columns, everything. Only limit: 15 clients. No account required, no email required. Download and use immediately.
- **Pro — $30 one-time**: All limits removed. No subscription, no renewal, no further contact required. One payment, done forever.

### Payment & Fulfillment Platform: LemonSqueezy
LemonSqueezy (https://lemonsqueezy.com) handles everything outside the app: payment processing, global sales tax/VAT collection and remittance, receipt emails, and license key generation. Acquired by Stripe in 2024, so you get Stripe's payment infrastructure with a software-seller-friendly wrapper.

**Why LemonSqueezy over alternatives:**
- Native license key generation and activation API — built for exactly this use case
- 5% + $0.50 per transaction (you net ~$27.50 on a $30 sale) vs Gumroad's 10% + $0.50
- Handles sales tax globally so you don't have to
- No monthly fee, no minimum volume
- Activation limits per key (prevents casual sharing)

**What you set up on LemonSqueezy:**
- One product: "CaseConnect Pulse Pro"
- Price: $30, one-time payment
- License key generation: enabled
- Activation limit: 3 per key (covers work PC + home PC + one spare)
- License length: lifetime (no expiration)

**What you do NOT need to build:**
- User account system
- Customer database
- Payment processing integration
- Tax calculation
- Receipt generation
- A storefront (LemonSqueezy hosts the checkout)

### The Purchase Flow (User's Perspective)

```
1. User finds Pulse via Reddit / word of mouth / your website
2. Downloads the free version (portable .exe, no installer)
3. Uses it with 15 clients, realizes they need more
4. Clicks "Upgrade to Pro" button in the app
   → Opens their default browser to your LemonSqueezy checkout page
5. Pays $30 via credit card / PayPal / Apple Pay / Google Pay
6. Receives license key by email within seconds
   (key format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
7. Back in the app: Settings → License → pastes key → clicks "Activate"
8. App makes ONE HTTPS call to LemonSqueezy API to validate
9. If valid: stores activation locally, unlocks Pro forever
10. Done. App never contacts the internet again.
```

### License Activation — Technical Implementation

**Activation flow (in `src/main/license.ts`):**

```
User enters key
  → App sends POST to https://api.lemonsqueezy.com/v1/licenses/activate
    with: license_key + instance_name (machine hostname or generated ID)
  → LemonSqueezy checks:
    - Is the key valid?
    - Is the key disabled?
    - Has it exceeded its activation_limit (3)?
  → If valid: returns { activated: true, instance: { id: "..." }, license_key: { status, ... } }
  → App verifies response store_id and product_id match hardcoded values
    (prevents someone using a key from a different LemonSqueezy product)
  → App stores in electron-store:
    - license_key (the key string)
    - instance_id (from LemonSqueezy response)
    - activated_at (timestamp)
    - pro: true
  → All feature flags now check pro === true
  → UI updates: limits removed, "Free" badge disappears
```

**Key sharing prevention:**
- LemonSqueezy tracks activation count server-side
- Activation limit of 3 means the 4th machine attempting to activate gets rejected
- After activation, the local token works offline forever — no phone-home
- At $30 one-time, piracy is not worth engineering against. Anyone who would crack the local activation token was never going to pay. Focus on making the product great.

**Offline fallback for users with zero internet access:**
- App shows message: "Activation requires a one-time internet connection. If you cannot connect, email support@caseconnect.com with your Machine ID (shown below) and we'll send you an offline activation token."
- You'll get maybe 2-3 of these requests ever. Handle manually.

**Free tier enforcement (in renderer, checked via store):**
```typescript
// Single check — the ONLY limitation in free tier:
const { pro } = useSettingsStore()

// Grid: limit client rows
if (!pro && clientCount >= 15) → show upgrade prompt instead of adding row

// Everything else works with no restrictions:
// ✓ Unlimited columns
// ✓ Alert rules
// ✓ Templates (import/export)
// ✓ Profiles, case logs, checklists
// ✓ Dashboard, supervisor reports
// ✓ All column types, conditional formatting
// ✓ Multiple grids
```

**"Upgrade to Pro" touchpoints in the free tier:**
- Gentle banner at top of grid when approaching 15-client limit (at 12+ clients): "You're using 13 of 15 free client slots"
- When hitting limit: friendly modal explaining Pro with purchase link — never blocks access to existing data
- Settings → License page with key input field and purchase link
- Soft, non-annoying — never a popup during normal work, never blocks existing features, never makes the user feel punished

### Website & Landing Page
- Single-page site on your CaseConnect domain (or pulse.caseconnect.com subdomain)
- Content: pitch, screenshots, demo video, feature list, testimonials
- Two CTAs: "Download Free" (direct .exe/.AppImage/.dmg download) and "Buy Pro — $30" (links to LemonSqueezy checkout)
- Can be a simple static HTML page hosted anywhere (Vercel, Netlify, GitHub Pages)
- No backend required

---

## 18. Template File Format & File Association

### The `.pulse` File Format
Templates are exported as `.pulse` files — a custom extension wrapping a JSON structure. Using a dedicated extension (not `.json`) enables OS-level file association so double-clicking a `.pulse` file opens Pulse directly.

**File structure:**
```json
{
  "pulse_template": "1.0",
  "type": "setup",
  "name": "OPWDD Care Coordinator",
  "description": "15 columns with POC, Assessment, and Life Plan deadline alerts",
  "author": "James",
  "created": "2026-02-17",
  "columns": [],
  "alert_rules": [],
  "checklists": []
}
```

- `pulse_template`: Schema version string. Allows future versions of Pulse to detect and handle older/newer template formats gracefully ("This template was created with a newer version of Pulse").
- `type`: Either `"setup"` (full column + alert + checklist config) or `"checklist"` (standalone checklist template).
- Template files contain **structure only** — never client data, names, or PII. The export process must strip any row data. Validate this on both export and import.

### Template Versioning & Forward-Compatibility

Template sharing between users running different versions of Pulse is inevitable — and the forward-compatibility story matters more than backward-compatibility, because early adopters will share templates with people running older versions.

**Version comparison rules:**
- `pulse_template` field uses semver-style versioning: `"1.0"`, `"1.1"`, `"2.0"`
- **Same major version** (e.g., app is 1.0, template is 1.1): Import with graceful degradation. Unknown fields are preserved in the JSON but ignored by the UI. Unknown column types fall back to `text` with a notice.
- **Newer major version** (e.g., app is 1.x, template is 2.0): Show warning: "This template was created with a newer version of Pulse. Some features may not import correctly." Attempt import anyway — unknown column types fall back to `text`, unknown alert styles fall back to defaults, unknown checklist fields are ignored. Never block the import entirely.
- **Older version** (e.g., app is 1.1, template is 1.0): Always works. Newer app versions must remain backward-compatible with all older template versions.

**Unknown column type degradation:**
When a template contains a column type the current app version doesn't recognize:
1. Column is created as `text` type
2. Original type is preserved in `config` JSON as `{"original_type": "relationship", "degraded_from": "1.1"}`
3. Import summary shows: "1 column type not recognized ('relationship') — imported as text. Update Pulse for full support."
4. If the user later updates Pulse to a version that supports the type, a migration could detect `degraded_from` entries and offer to convert them — but this is a nice-to-have, not required

**Unknown fields in template JSON:**
- Template import should use a permissive parser — accept and preserve unknown top-level and nested keys rather than rejecting them
- This ensures that a 1.0 app importing a 1.3 template with new fields (e.g., `"conditional_format_rules"`) doesn't fail — it just ignores what it doesn't understand
- On re-export, preserved unknown fields are included so no data is lost in a round-trip through an older app version

**Best practice for adding new template features:**
- New optional fields: bump minor version (1.0 → 1.1). Older apps ignore the field gracefully.
- Breaking structural changes: bump major version (1.x → 2.0). Older apps show the major version warning.
- Never remove fields from the template schema — only add. Old fields can be deprecated but must still be accepted on import.

### File Association — Platform Implementation

**Goal:** User double-clicks a `.pulse` file → Pulse launches (or comes to foreground) → import preview screen appears showing what the template contains → user clicks "Import" → done.

**Windows (installed via NSIS):**
- `electron-builder` config registers `.pulse` file association during installation
- Writes registry entries mapping `.pulse` → Pulse executable
- File path arrives as `process.argv[1]` on launch

**Windows (portable .exe):**
- No installer means no automatic registration
- Settings → General → "Register .pulse files" button that writes registry keys programmatically via Electron's `app.setAsDefaultProtocolClient()` or direct registry write
- If not registered, user can still import manually through the in-app template manager

**macOS (.dmg):**
- Declare `CFBundleDocumentTypes` in `Info.plist` mapping `.pulse` to the app
- Declare `UTImportedTypeDeclarations` for the custom `com.caseconnect.pulse-template` type
- File path arrives via Electron's `app.on('open-file', (event, path) => ...)` event
- Works automatically after drag-to-Applications install — cleanest implementation of the three platforms

**Linux (.AppImage / .deb):**
- `.deb`: Include a MIME type XML definition registering `application/x-pulse-template` for `.pulse`, plus a `.desktop` file declaring the association. Handled by `electron-builder`.
- `.AppImage`: Works if user integrates via AppImageLauncher or runs `--install`. Otherwise, manual import through the app.
- File path arrives as `process.argv[1]` (same as Windows)

### Main Process Handler (`src/main/file-association.ts`)

```
On app launch:
  1. Check process.argv for a .pulse file path (Windows/Linux)
  2. Register app.on('open-file') listener (macOS)
  3. If file path found:
     a. Read and parse JSON
     b. Validate pulse_template version field
     c. Validate structure (has required fields, no client data)
     d. Store parsed template in a "pending import" state
     e. Once renderer is ready, route to TemplateImport view with preview
  4. If app is already running and receives a second open-file event:
     a. Bring window to foreground
     b. Route to TemplateImport view
```

### Import Preview Screen
When a `.pulse` file is opened (via double-click or manual import), show a preview before committing:
- Template name, description, author
- Column count and names
- Alert rule count and summaries
- Checklist count and names
- "Import" and "Cancel" buttons
- If template version is newer than app version: show warning, attempt import anyway, surface any fields it couldn't parse

---

*This is the single, complete specification for CaseConnect Pulse. Give this entire document to Claude Code and say "Build Phase 1." Each phase produces a working, testable build.*
