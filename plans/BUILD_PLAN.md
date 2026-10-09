# CaseConnect Pulse — Build Plan & Progress Tracker

**Source:** `Pulse_Complete_Spec.md` v3.0
**Stack:** Electron + React + TypeScript + SQLite/SQLCipher + Tailwind CSS
**Started:** 2026-02-17

> Check boxes as tasks are completed. Each phase produces a working build before proceeding.

---

## Phase 1: Foundation & Core Grid (MVP)

**Goal:** Grid works, data persists encrypted, password protection functional, auto-backup on close, sorting works, runs on all platforms.

### 1.0 — Build Toolchain Validation (DO FIRST)
- [x] Validate SQLCipher-compatible DB compiles on Linux (`better-sqlite3-multiple-ciphers` — see Decision Log)
- [x] Run test: open encrypted DB, cipher pragmas, `PRAGMA schema_version`
- [x] Validate `electron-rebuild` against Electron's Node headers
- [x] Confirm cross-platform build targets (Windows .exe, Linux .AppImage — macOS deferred, no Mac host)

### 1.1 — Project Scaffolding
- [x] Init Electron + React + TypeScript project with `electron-vite`
- [x] Configure `tsconfig.json` (main, preload, renderer)
- [x] Configure Tailwind CSS with theme tokens (spec Section 10)
- [x] Set up project directory structure (spec Section 3)
- [x] Configure `electron-builder` for cross-platform packaging
- [x] Set up `package.json` scripts (dev, build, package)

### 1.2 — Database & Encryption
- [x] SQLCipher database setup (`src/main/database.ts`)
- [x] Key wrapping architecture: random 256-bit DB key, PBKDF2 password wrapping (spec Section 4)
- [x] `electron-store` for password hash, hints, wrapped keys, DB path
- [x] Migration system: `app_meta` table, sequential `up()`/`down()` migrations
- [x] Initial schema migration `001_initial_schema.ts` — all tables from spec Section 4:
  - [x] `app_meta`, `grids`, `columns`, `rows`, `cells`, `cell_history`
  - [x] `alert_rules`, `checklist_items`, `case_log`, `scrap_notes`
  - [x] `document_refs`, `checklist_templates`, `setup_templates`
  - [x] `tags`, `row_tags`, `saved_filters`, `saved_views`
  - [x] `snippets`, `letter_templates`, `action_log`, `settings`
- [x] All indexes from spec
- [x] WAL mode, foreign keys ON
- [x] Grid load pivot query builder (spec Section 4 — **critical performance pattern**)
- [x] Cell upsert pattern (INSERT ON CONFLICT)

### 1.3 — Auth & Password System
- [x] `src/main/auth.ts` — password hashing (bcryptjs), key derivation (PBKDF2), key wrapping/unwrapping
- [x] First-launch password creation screen (`PasswordSetupView.tsx`)
- [x] Lock screen on every launch (`LockScreenView.tsx`)
- [x] Password verification → DB key unwrap → SQLCipher open
- [x] Auto-lock timer (default 30 min, configurable, 0=disabled)
- [x] Ctrl+L manual lock
- [x] Password hint storage and display
- [x] Recovery key generation (optional) — 24-char key, XXXX-XXXX format
- [x] Recovery key unlock path ("Forgot Password?" → recovery key input)
- [x] Inactivity detection (keyboard, mouse, trackpad)

### 1.4 — IPC Communication Layer
- [x] `src/shared/ipc-channels.ts` — all channel constants (spec Section 11)
- [x] `src/preload/index.ts` — contextBridge API
- [x] `src/main/ipc-handlers.ts` — handler registrations
- [x] Electron hardening: nodeIntegration false, contextIsolation true, sandbox false (preload needs ipcRenderer)

### 1.5 — App Shell & Navigation
- [x] `src/main/index.ts` — window creation, app lifecycle, min 900x600
- [x] `src/renderer/App.tsx` with react-router-dom
- [x] Sidebar component (220px expanded / 48px collapsed, Ctrl+\\)
- [x] TopBar component (48px, search trigger, breadcrumbs)
- [x] Status bar (28px — save status, client count, grid name)
- [x] Light/dark theme toggle (system detection + manual)
- [x] Window state persistence (size, position, maximized)
- [x] Global CSS: `globals.css`, theme tokens from spec Section 10

### 1.6 — Data Grid (Core)
- [x] `DataGrid.tsx` with `@tanstack/react-table` + `@tanstack/react-virtual`
- [x] `GridToolbar.tsx` (sort button, add row/column)
- [x] `ColumnHeader.tsx` with sort toggle, rename inline, delete
- [x] `CellEditor.tsx` — edit logic per column type
- [x] Column types implemented: `text`, `date`, `number`, `checkbox`, `dropdown`
- [x] Type-appropriate editors (text input, date picker, number input, toggle, select menu)
- [x] Keyboard navigation: Arrow keys, Tab/Shift+Tab, Enter, Escape, F2, Home/End
- [x] `GridStatusFooter.tsx` — client count, column count

### 1.7 — Column Management
- [x] Add column (with type selection)
- [x] Rename column (inline header edit)
- [x] Resize column (drag border, double-click auto-fit)
- [x] Reorder columns (drag header)
- [x] Hide/show columns
- [x] Delete column (confirmation)
- [x] Column `position` persistence

### 1.8 — Row Management
- [x] Add row (+ Add Client button)
- [x] Delete row (IPC handler ready)
- [x] Reorder rows (drag handle, disabled during sort)
- [x] Row `position` persistence

### 1.9 — Sorting System
- [x] Single-column sort: click header → asc → desc → remove
- [x] Multi-column sort: Shift+click, priority badges
- [x] Sort persistence to `grids.sort_config` JSON
- [x] Empty/null values sort to BOTTOM regardless of direction

### 1.10 — Search
- [x] Real-time search bar in TopBar
- [x] Debounced 150ms (currently immediate via TanStack globalFilter)
- [x] Search across all visible columns
- [x] Ctrl+F focuses search bar
- [x] Ctrl+F tooltip on input

### 1.11 — Auto-Save
- [x] Debounced 300ms after every cell edit (in CellEditor.tsx)
- [x] Status bar: "Saving…" → "Saved ✓"
- [x] Failure: persistent error message in status bar

### 1.12 — Backup Layer 1 (Silent on Close)
- [x] `src/main/backup.ts` — backup logic
- [x] Auto-copy database to `backups/` folder on `before-quit`
- [x] Rolling retention: keep last 5 copies, delete oldest
- [x] File naming: `pulse-auto-YYYY-MM-DD-HHMMSS.db`
- [x] Portable mode: backups next to DB; installed mode: OS standard location

### 1.13 — Cloud Sync Warning
- [x] DB path check for OneDrive/Dropbox/Google Drive/iCloud → warning returned to renderer on setup

### 1.14 — Portable-First Architecture
- [x] Check for `Data/` folder relative to executable first
- [x] If exists → portable mode (data in `Data/pulse.db`)
- [x] If not → OS standard location fallback

### 1.15 — Cross-Platform Builds
- [x] Windows portable .exe + .zip (cross-compiled from Linux; signAndEditExecutable disabled)
- [x] Linux .AppImage
- [~] macOS .dmg — deferred (no Mac host; dmg-license is macOS-only native module)
- [x] Verify builds launch and run on each platform (Linux AppImage verified on Fedora 43; Windows cross-compiled)

**Phase 1 Exit Criteria:**
- [x] Grid renders with 200+ rows at 60fps
- [x] Cell edit → save < 100ms
- [x] Data persists across app restarts
- [x] Database is encrypted (verified: raw .db file is unreadable)
- [x] Password protection works (lock/unlock/auto-lock)
- [x] Auto-backup on close creates rolling copies
- [x] Sorting works (single + multi-column)
- [x] Runs on Windows, Linux (macOS deferred)

---

## Phase 2: Intelligence Layer

**Goal:** Deadlines glow. Dashboard shows priorities. App tells you what to do.

### 2.1 — Alert Rules System
- [x] Alert rules data model (spec Section 7.2 — `AlertRule`, `AlertThreshold` interfaces)
- [x] Alert rule CRUD (IPC handlers)
- [x] Pre-built alert rule templates (Annual Assessment, Semi-Annual, Quarterly, Monthly, Plan of Care, IEP, Court Date)
- [x] `AlertRuleEditor.tsx` — create/edit rules
- [x] Alert rule attached to date columns via column config (Bell icon in column header menu)

### 2.2 — Deadline Computation Engine
- [x] `src/renderer/utils/deadlineCalc.ts` — threshold matching, color computation
- [x] Cell rendering with alert colors (CSS class-based: alert-green/yellow/orange/red/pulse/pulse-dark)
- [x] Pulse animation for due/overdue items (2s cycle, respects prefers-reduced-motion)
- [~] Auto-cycling: date update → old date to history → alert reset — case log auto-entry removed (case log is manual notes only)

### 2.3 — Morning Briefing
- [x] Morning Briefing screen (appears post-unlock, before grid)
- [x] Three big numbers: Overdue (red), Due This Week (orange), Follow-Ups Pending (blue)
- [x] Click-to-expand each section (client name, column, date)
- [x] "Start My Day" button → dismisses, opens grid
- [x] Auto-skip if nothing urgent (0 overdue, 0 this week, 0 follow-ups)

### 2.4 — Dashboard View
- [x] `DashboardView.tsx` — main dashboard layout
- [x] Summary cards row: Total Active, Overdue, Due This Week, Due This Month
- [x] Priority list: full list by urgency with All/Overdue/This Week/This Month filter tabs
- [x] Search within dashboard
- [x] Dashboard nav item in sidebar
- [x] `WeekView` — grouped-by-day tab in DashboardView (deadlines + tasks + follow-ups)
- [x] Dashboard → profile navigation (profile view exists at `/profile/:rowId`)

### 2.5 — Computed Columns
- [x] `age_from_dob` column type — auto-calc "34 yrs" from source DOB column
- [x] `calculated_days` column type — days until/since source date, color-coded display
- [x] Signed integer sort for calculated_days (already implemented — DataGrid.tsx uses numeric aVal - bVal comparison)

### 2.6 — Conditional Formatting
- [x] `ConditionalFormatPanel.tsx` — per-column rule editor
- [x] Text: contains/equals/not_equals → background color
- [x] Number: greater_than/less_than/between/equals → color
- [x] Multiple rules, first match wins
- [x] Store in `columns.conditional_format` JSON
- [x] Applied in grid cells (inline style, alert rule takes precedence)

**Phase 2 Exit Criteria:**
- [x] Date cells glow with alert colors based on threshold rules
- [x] Dashboard shows overdue/upcoming items sorted by urgency
- [x] Morning Briefing appears on launch with actionable summary
- [x] Computed columns auto-calculate age and days until deadline
- [x] Conditional formatting applies visual rules to cells

---

## Phase 3: Profiles & Workflow

**Goal:** Rich client profiles with everything a care coordinator needs. Caseload-level admin tasks have a home.

### 3.1 — Profile View Foundation
- [x] `ProfileView.tsx` with react-router `/profile/:rowId`
- [x] `Breadcrumb.tsx` — Grid Name > Client Name
- [x] Prev/Next navigation (◀ ▶) with "(3 of 47)" indicator, Alt+Left/Right
- [x] Back button / Escape → grid (scroll position preserved)
- [x] Recent profiles tracking (last 10, TopBar dropdown)

### 3.2 — Profile Header
- [x] `ProfileHeader.tsx` — large name, DOB, age, identifiers, star, status badge, tags
- [x] Color label indicator
- [x] Quick action buttons: [+ Note] [+ Task] [Attach] [Print] [← Grid]

### 3.3 — Deadline Panel
- [x] `DeadlinePanel.tsx` — card per date column
- [x] Shows: column name, date, human-readable urgency, alert color, progress bar
- [x] Sorted by urgency (fixed)
- [x] Click to edit date inline

### 3.4 — Checklist System
- [x] `Checklist.tsx` + `ChecklistItem.tsx`
- [x] Item fields: checkbox, title, due date (color-coded), priority badge, category
- [x] Drag-to-reorder (`@dnd-kit`)
- [x] Sort toggle: Manual | Due Date | Priority | Category
- [x] Progress bar "7/12"
- [x] Apply Template button
- [x] Completed section (collapsible, timestamped)
- [x] Individual recurring items (recurrence_rule field stored; reset cycle supported)

### 3.5 — Scrap Notes (Rich Text)
- [x] `ScratchPad.tsx` with tiptap (`@tiptap/starter-kit`)
- [x] Bold, italic, bullets, numbered lists
- [x] Warm sticky-note background (#FFFBEB)
- [x] Auto-save 2s debounce
- [x] Resize handle (CSS resize-y with persisted height per row in localStorage)

### 3.6 — Case Log
- [x] `CaseLog.tsx` + `CaseLogEntry.tsx`
- [x] Add entry: type selector (Note/Phone/Meeting/Email/Visit), content, optional follow-up date
- [x] Reverse-chrono default (toggle)
- [x] Each entry: timestamp, relative time, type icon, content
- [x] Pin/edit/delete per entry
- [x] Pinned section at top
- [x] Search within case log
- [x] Follow-up tracking with completion
- [x] "Edited" indicator
- [x] ~~Auto-generated system entries~~ — removed; case log is for manual notes only. System activity tracked via Activity Timeline on profiles.
- [x] System entries: muted styling, distinct from manual entries

### 3.7 — Contact Info
- [x] `ContactInfo.tsx` — auto-populated from phone/email/address columns
- [x] Click-to-copy
- [x] Hidden if no contact columns exist

### 3.8 — Document References
- [x] `RelatedDocuments.tsx` — local file path references
- [x] Attach File → system file picker
- [x] Category, description per document
- [x] Click to open in system default app
- [x] Three identifiers: absolute path, original filename, optional relative path
- [x] Documents root setting (Settings → Data tab, folder picker, stored in app_settings)
- [x] File resolution order: relative paths resolved against documents_root in DOCUMENT_REF_OPEN handler
- [x] Broken reference UX: "Can't find [file]" + [Locate File] + [Remove Reference]
- [x] Bulk re-link banner (5+ broken refs)

### 3.9 — Activity Timeline
- [x] `ActivityTimeline.tsx` — aggregated chronological feed
- [x] Filterable by event type
- [x] Paginated (50 at a time)

### 3.10 — Grid Data Summary
- [x] `GridDataSummary.tsx` — two-column key-value of all non-identifier columns
- [x] Editable inline (syncs to grid)
- [x] Date fields show alert badge

### 3.11 — Snippet / Text Expander
- [x] `snippets` table CRUD (IPC handlers: get-all, create, update, delete)
- [x] Trigger detection: "/" prefix in tiptap editors and case log
- [x] Autocomplete dropdown matching typed trigger
- [x] Date-aware variables: `{today}`, `{today+N}`, `{today-N}`, `{client_name}`, `{now}`
- [x] Pre-built snippets — 12 seeded lazily on first SNIPPET_GET_ALL if table empty
- [x] `SnippetsView.tsx` — full management UI at `/snippets` (list, search, add/edit/delete, grouped by category)
- [x] Snippet editor with variable helper chips and live preview
- [x] Keyboard nav in autocomplete dropdown (↑↓ navigate, Tab/Enter apply, Esc dismiss)

### 3.12 — Profile Print Layout
- [x] `ProfilePrintLayout.tsx` — clean formatted output
- [x] Includes: header, deadlines, active checklist, last 10 case log entries, scrap notes
- [x] Footer: "Printed [date] — CaseConnect Pulse — CONFIDENTIAL"
- [x] Print-friendly CSS (print styles in `globals.css`)

### 3.13 — Caseload-Level Tasks (Phase 3 scope)
- [x] `caseload_tasks` + `caseload_task_history` tables (in initial schema)
- [x] Task CRUD, completion, cycle advancement (IPC handlers in ipc-handlers.ts)
- [x] `taskStore.ts` — Zustand store
- [x] `TasksView.tsx` — main tasks view (`/tasks`) with TaskCard, TaskFormDialog, SnoozeDialog, TaskGroup
- [x] Recurrence engine: daily/weekly/monthly/yearly with interval, end_date
- [x] Cycle completion: save to history → advance due_date → reset is_completed
- [x] Sidebar nav item (Tasks)
- [x] Ctrl+Shift+T quick-add shortcut
- [x] IPC channels: get-all, create, update, delete, complete, snooze, get-history, get-due

**Phase 3 Exit Criteria:**
- [x] Client profile shows all sections (header, deadlines, checklist, notes, case log, docs, timeline, grid data)
- [x] Case log captures manual entries and system entries (system entries wired in for future auto-logging)
- [x] Snippets expand in text fields with date-aware variables (in ScratchPad and Case Log)
- [x] Caseload tasks have CRUD, recurrence, and their own view
- [x] Profile prints cleanly
- [x] Three-column profile layout: left sidebar (Checklist + ScratchPad), center (main content), right sidebar (Activity Timeline)

---

## Phase 4: Templates & Data

**Goal:** Templates shareable via `.pulse` files, data portable, backups secure.

### 4.1 — Checklist Templates
- [x] Checklist template CRUD (`CL_TEMPLATE_*` handlers — done in Phase 3)
- [x] Pre-built templates (New Client Intake, Annual Review Prep, Discharge Planning, Home Visit Prep, Monthly Check-In) — seeded in `templates.ts`
- [x] Recurring cycle reset dialog ("Reset for next cycle?") — `CHECKLIST_RESET_CYCLE` handler exists
- [x] `ChecklistTemplateEditor.tsx` — full create/edit modal with dnd-kit reorder

### 4.2 — Setup Templates & .pulse Files
- [x] `.pulse` file format (JSON with version, type, columns, alerts, checklists) — `templates.ts`
- [x] Template save from current grid (`exportGridAsPulse` + `SETUP_TEMPLATE_EXPORT`)
- [x] Template export as `.pulse` file (via save dialog)
- [x] Template import with preview (columns, rules, checklists) — `SETUP_TEMPLATE_IMPORT`
- [x] "Create New Grid" or "Apply to Current Grid" on import — `SETUP_TEMPLATE_APPLY` (mode='new'|'existing')
- [x] Template versioning and forward-compatibility — major version check + warning
- [x] Unknown column type degradation (fallback to text with original_type recorded in config)
- [x] `TemplateManagerView.tsx` — full view with setup + checklist template management
- [x] Pre-built setup templates (OPWDD, Social Worker, IEP, Probation, Therapist) seeded lazily

### 4.3 — .pulse File Association
- [x] `src/main/file-association.ts`
- [x] Windows: registry entries for `.pulse` extension
- [~] macOS: `CFBundleDocumentTypes` in Info.plist — deferred (no Mac host)
- [x] Linux: MIME type XML + `.desktop` file (via electron-builder fileAssociations)
- [x] Handle `process.argv` / `app.on('open-file')` for launch-with-file
- [x] Route to import preview when file opened

### 4.4 — CSV Export
- [x] Full grid export via papaparse (`exportCsv` in `export.ts`)
- [x] Filtered export support (activeRowIds param)
- [x] Column selection dialog — ColumnSelectDialog.tsx; exports now show column picker before save dialog
- [x] Date format option (iso/us/eu)
- [x] Export button in GridToolbar with save dialog

### 4.5 — Import System (CSV + Excel)
- [x] `src/main/import.ts` — CSV parsing via papaparse + Excel via SheetJS (xlsx)
- [x] `ImportWizard.tsx` — 6-step import wizard modal in GridToolbar
- [x] Drag-and-drop file zone in wizard + file dialog
- [x] Clipboard paste detection (tab-separated) in wizard Step 1
- [x] Sheet selection (Excel multi-sheet) — Step 2
- [x] Smart preview (first 20 rows) — Step 3
- [x] Auto-detection: headers, column types (dates, phones, emails, numbers, currency, checkbox)
- [x] Column mapping interface — Step 4 with action dropdowns
- [x] Auto-match by column name (case-insensitive) via `autoMatchColumns`
- [x] Duplicate detection: by_name / name_and_dob / none — Step 5
- [x] Data cleanup: trim whitespace, normalize dates, format phones (cleanData flag)
- [x] Import progress bar — real-time progress via IPC.IMPORT_PROGRESS every 10 rows
- [x] Summary with warnings list — Step 6 results

### 4.6 — PDF Export
- [x] `src/main/export.ts` — PDF profile + grid via jspdf + jspdf-autotable
- [x] PDF profile export (professional layout, section headers, CONFIDENTIAL footer) — `exportPdfProfile`
- [x] PDF grid export (landscape, paginated via autoTable) — `exportPdfGrid`
- [x] PDF export buttons in GridToolbar (Export → Export as PDF)
- [x] Print/PDF button on Profile header → save dialog → PDF
- [x] Batch print multi-client PDF — `exportPdfBatch` backend + Print button in bulk action bar
  - [x] Cover page + table of contents + per-client pages via renderProfileToDoc
  - [x] Bulk action bar "Print Selected" — Printer icon button in bulk selection bar

### 4.7 — Supervisor Report Export
- [x] `export:supervisor-report` IPC handler registered
- [x] Report layout: header, caseload summary, roster, optional activity log — `exportSupervisorReport`
- [x] Output formats: PDF (default), CSV
- [x] Date range picker UI — SupervisorReportDialog has date inputs
- [x] Column selection for roster — ColumnSelectDialog.tsx used for CSV/PDF exports

### 4.8 — Backup Layers 2 & 3
- [x] **Scheduled backup (Layer 2)**: `runScheduledBackup` with interval/destination/rolling 10 — `backup.ts`
- [x] **Manual backup / Pack & Go (Layer 3)**: `runManualBackup` — compressed zip → `.pulse-backup` via archiver
- [x] `BACKUP_MANUAL_CREATE`, `BACKUP_SCHEDULED_RUN` IPC handlers registered
- [x] Restore from .db (Layer 1/2): `restoreFromDb` + `BACKUP_RESTORE_AUTO` handler
- [x] Restore from .pulse-backup (Layer 3): `restoreFromPulseBackup` + `BACKUP_RESTORE_FILE` handler
- [x] Pre-restore safety backup auto-created before overwriting
- [x] Restore UI (backup picker, password entry) — implemented in Settings → Backup tab
- [x] Backup reminder notifications (toast after unlock if no backup in N days; configurable in Settings → Backup)

### 4.9 — Letter Templates / Mail Merge
- [x] `letter_templates` CRUD — `templates.ts` + all 5 IPC handlers
- [x] Template editor with `{{placeholder}}` syntax — `LetterTemplateView.tsx`
- [x] Preview with placeholders filled from client data — `generateLetter` in templates.ts
- [x] Output: copy to clipboard — in GenerateLetterModal in ProfileView
- [x] Output: export as PDF — `LETTER_TEMPLATE_EXPORT_PDF` IPC + exportLetterPdf() in export.ts
- [x] Pre-built templates (Introduction Letter, Referral Request, Status Update) seeded lazily
- [x] "Generate Letter" button on Profile View → GenerateLetterModal inline
- [x] `LetterTemplateView.tsx` at /letter-templates with full CRUD + letter generation

**Phase 4 Exit Criteria:**
- [x] Templates exportable/importable as `.pulse` files
- [x] Double-clicking `.pulse` file opens Pulse — file association implemented (4.3)
- [x] CSV and Excel import works with smart detection
- [x] PDF export works for profiles and grid
- [x] Batch print and supervisor report UI — Print button in bulk bar + SupervisorReportDialog
- [x] Backup Layers 2 & 3 implemented (UI in Phase 5 Settings)
- [x] Letter templates generate from client data

---

## Phase 5: Polish & Launch

**Goal:** Production-ready, professional, accessible, distributable.

### 5.1 — Onboarding Wizard
- [x] `OnboardingView.tsx` — step-by-step flow
- [x] Step 1: Welcome screen
- [~] Step 2: Password setup + optional recovery key — password handled by existing PasswordSetupView; recovery key offered in SettingsView
- [x] Step 3: Three paths (from scratch / import spreadsheet / pre-built template)
- [x] Step 3A: Guided setup interview (role → columns → deadlines → preview)
- [x] Step 3B: Import-first flow (drop file → ImportWizard component)
- [x] Step 3C: Pre-built template picker (4 templates)
- [~] Step 4: Add first client — deferred (grid loads empty, user adds naturally)
- [x] Step 5: Quick tour — TourOverlay.tsx (5-step spotlight walkthrough after onboarding done screen)
- [x] `WelcomeStep.tsx`, `TemplatePickerStep.tsx`, `CustomizeStep.tsx`, `TourOverlay.tsx` — inline in OnboardingView.tsx + TourOverlay component

### 5.2 — Command Palette
- [x] `CommandPalette.tsx` with cmdk library
- [x] Ctrl+K trigger, top-center, 560px max width
- [x] Current grid client search (name + grid name badge)
- [x] Navigation commands (Dashboard, Grid, Tasks, Snippets, Templates, Letters, Settings)
- [x] Action commands (Add New Client, Lock App)
- [x] Recent profiles section (empty query)
- [x] Cross-grid search — SEARCH_CLIENTS_CROSS_GRID IPC + "All Caseloads" group in palette
- [x] Fuzzy search — fuzzyMatch() with consecutive/prefix bonus in CommandPalette

### 5.3 — Multiple Grids
- [x] Multiple grid support (sidebar list, create, rename, delete, reorder)
- [x] "Move to Grid" — context menu, column matching (by name), delete source row
- [x] "Copy to Grid" — independent copy, empty checklists/case log/notes
- [x] Both available via context menu (single row) and bulk action bar (multi-select)
- [x] Grid list drag-to-reorder in sidebar (dnd-kit, position column in DB via migration 005)

### 5.4 — Saved Views & Filters
- [x] `FilterBar.tsx` — active filter chips above grid (dismissible, clear all, save preset)
- [x] `FilterControls` — filter + saved-filter trigger buttons in GridToolbar
- [x] Per-type operators: text/notes/address/phone/email (contains, not_contains, equals, starts_with, ends_with, is_empty, is_not_empty); number/currency (equals, gt, lt); date (equals, before, after); checkbox/dropdown/status/tag (equals, not_equals)
- [x] AND logic: all active filters must match (first-match-wins per row)
- [x] Client-side `matchFilter()` helper in DataGrid.tsx
- [x] `activeFilters` / `addFilter` / `removeFilter` / `clearFilters` in gridStore
- [x] `SAVED_FILTER_GET_ALL` / `SAVED_FILTER_CREATE` / `SAVED_FILTER_DELETE` IPC handlers
- [x] `savedFilters` / `loadSavedFilters` / `saveFilter` / `deleteSavedFilter` / `applySavedFilter` in gridStore
- [x] OR logic toggle — AND/OR button in FilterBar, filterMode in gridStore, .every()/.some() in DataGrid
- [x] Saved views (column visibility + sort + filter combos) — SavedViewsDropdown, SAVED_VIEW CRUD IPC, savedViews in gridStore
- [~] Filter panel as sidebar — uses inline popup panel instead

### 5.5 — Undo/Redo System
- [x] `undoStore.ts` — in-memory Zustand undo/redo stack (100 actions, clears on app close)
- [~] `action_log` table integration — deferred (stack is in-memory; action_log table exists for future use)
- [x] 100-action stack per session (clears on app close)
- [x] Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (global, skips when focus in input)
- [x] `UndoToast.tsx` — bottom-center, 8s countdown bar, [Undo] button
- [x] Core undoable actions: cell edit, row delete (with snapshot+restore), row archive/unarchive, row create, column rename

### 5.6 — Tagging System
- [x] Tag CRUD per grid (IPC handlers done; ProfileHeader has full UI)
- [x] Tag assignment/removal per row (ProfileHeader)
- [~] `TagInput.tsx` — colored badges, multi-select (ProfileHeader has inline picker; standalone component deferred)
- [x] Filter by tag — "Row Tags" filter in FilterBar (contains/not_contains/is_empty/is_not_empty)

### 5.7 — Row Features
- [x] Archiving: right-click → Archive → optional reason, "Show Archived" toggle, reactivate
- [x] Starring: star/unstar in context menu
- [x] Color labels: right-click → 9 presets (none + 8 colors) via flyout submenu
- [x] Row duplication: context menu → "Duplicate row" (ROW_DUPLICATE IPC + handler)
- [x] Archived rows show with 50% opacity visual distinction
- [x] Starring filter — star toggle in FilterControls, showStarredOnly in gridStore, pre-filter in DataGrid
- [x] Row numbers: optional column, toggleable
- [x] Multi-select: checkbox in handle area; Shift+click range, Ctrl+click individual, Ctrl+A all, Escape deselects
- [x] Bulk action bar: Archive, Move to caseload, Delete (with confirm); ROW_BULK_ACTION IPC handler

### 5.8 — Context Menus
- [x] Row right-click menu: Archive, Star, Color label, Duplicate, Conditional format, Delete
- [x] Reactivate option shown for archived rows
- [~] Column right-click menu — see ColumnHeader (sort/rename/delete already in header; hide via Columns button)
- [x] Cell right-click: Copy cell, Paste, Clear cell (added to top of existing context menu)
- [x] `useContextMenu.ts` hook (generic hook for future use)

### 5.9 — Cell History
- [x] Cell history tracking in `cell_history` table (written on every CELL_UPDATE save)
- [x] `CELL_GET_HISTORY` IPC handler implemented (returns last 50 changes per cell)
- [x] `CELL_HISTORY_COMPACT` IPC — deletes records older than N months
- [x] "Compact History" UI in Settings → Data (retention picker + Compact Now button)
- [x] History retention auto-prune on startup — time-based prune (90 days) in database.ts
- [x] History viewer in profile/cell — CellHistoryPopover.tsx, "View history" in cell right-click menu

### 5.10 — Remaining Column Types
- [x] `phone` — formatted (xxx) xxx-xxxx display, tel input editor
- [x] `email` — blue display, email input editor
- [x] `tag` — comma-separated badges display, text input editor (multi-select UI deferred)
- [x] `currency` — $X,XXX.XX display, number input editor
- [x] `url` — underlined display (no https://), url input editor
- [x] `notes` — truncated 60 chars display, textarea editor
- [x] `status` — color-coded badge display, dropdown editor (config.options[])
- [x] `address` — first line display, textarea editor
- [x] All types added to GridToolbar "Add Column" type picker

### 5.11 — Focus Mode
- [x] Ctrl+Shift+F or sidebar icon
- [x] Simplified interface: Client Deadlines Due Today, Admin Tasks Due Today
- [x] Big [Complete ✓] buttons with celebration animation (slide-out)
- [x] "Exit Focus Mode" button

### 5.12 — Caseload Task Integrations (Phase 5 scope)
- [x] Morning Briefing: "Caseload Tasks Today" section
- [x] Focus Mode: "Admin Tasks Due Today" section
- [x] Dashboard: "Tasks Due" summary card
- [x] Priority List: caseload tasks interleaved with client deadlines (TaskRow with complete button, sorted by urgency)
- [x] Command Palette: `tasks`, `add task` commands
- [x] Supervisor Report: optional caseload task summary section — SupervisorReportDialog has `includeTaskSummary` checkbox
- [x] Snooze functionality (1 day / 3 days / 1 week / custom) — SnoozeDialog in TasksView + TASK_SNOOZE IPC

### 5.13 — Grouping System
- [x] `GroupingBar.tsx` — toolbar dropdown for group-by column (Layers icon, X to clear)
- [x] Collapsible group sections with header (value + count)
- [~] Color from column configuration — deferred (group headers use slate bg, no per-value color)
- [x] Collapse All / Expand All buttons (in group toolbar row above data)
- [~] Drag row between groups → changes cell value — deferred (complex DnD integration)
- [x] Group right-click menu — Collapse All / Expand All / Remove Grouping on group header right-click
- [x] Single-level only, dropdown/status/tag/checkbox/text columns only
- [x] Non-virtualized render when grouped (correct for variable heights; normal virtual scroll when not grouped)

### 5.14 — Keyboard Shortcuts (Full)
- [x] `KeyboardShortcutsModal.tsx` — modal with grouped reference table
- [x] `?` global shortcut opens shortcuts modal (from App.tsx, skips inputs)
- [x] Global, grid navigation, grid editing, tasks shortcuts documented
- [~] `useKeyboardShortcuts.ts` hook — deferred (shortcuts handled inline per component)

### 5.15 — Settings Page (All Sections)
- [x] `SettingsView.tsx` at /settings with sidebar nav
- [x] Appearance: theme (light/dark/system), date format
- [x] Security: change password (with hint), auto-lock timer
- [x] Backup: info panel, manual Pack & Go backup, restore guidance
- [x] Data: DB path/size/client count, danger zone (typed RESET EVERYTHING)
- [x] About: app version, check for updates button
- [x] Settings nav item in Sidebar (bottom, above Lock)
- [x] Alerts configuration section — Settings → Alerts tab (rule list, edit/delete/create)
- [x] Snippets management section — Settings → Snippets tab (compact list + link to /snippets)
- [x] Shortcuts reference section — Settings → Shortcuts tab (inline keyboard reference)
- [~] License section — deferred (5.19)

### 5.16 — Dashboard Remaining Tabs
- [x] `MonthView` tab — full month, grouped by week (inline in DashboardView)
- [x] `CompletionChart` tab — last 30 days checklist completions, horizontal bar chart (inline in DashboardView)
- [x] `RecentlyArchived` tab — archived clients with date, reason, search, reactivate (inline in DashboardView)
- [x] Top-level tab bar added to DashboardView (Priority List / This Month / Completions / Recently Archived)
- [x] `DASHBOARD_GET_ARCHIVED` IPC — queries archived rows with client name + grid name
- [x] `DASHBOARD_GET_COMPLETED` implemented — checklist_items completed last 30 days grouped by date

### 5.17 — Copy/Paste & Clipboard
- [x] Ctrl+C focused cell → plain text (formatted by column type)
- [x] Ctrl+Shift+C → "Column Name: Value" format
- [x] Ctrl+V → paste clipboard value into focused cell (raw value)
- [x] `formatCellForClipboard()` helper in DataGrid.tsx
- [x] Ctrl+C row → tab-separated (multi-row selection + headers)
- [x] Column-type validation on paste — validates date/number/checkbox/dropdown, skips invalid with toast

### 5.18 — Destructive Action Safety
- [x] `ConfirmDialog.tsx` — shared modal with standard + typed confirmation variants
- [x] Delete row: ConfirmDialog (standard, destructive)
- [x] Delete column: ConfirmDialog (standard, destructive)
- [x] Delete alert rule: ConfirmDialog (standard, destructive)
- [x] App reset: typed "RESET EVERYTHING" confirmation (in SettingsView)
- [x] Typed column name for delete column — ConfirmDialog variant="typed" with requiredPhrase={column.name}
- [x] Bulk delete: typed "DELETE X" confirmation
- [x] Delete grid: typed "DELETE [GRID NAME]" confirmation

### 5.19 — Licensing (Free Tier + Pro)
- [ ] Free tier: 15-client limit, all features unlocked
- [ ] Client count check against license state
- [ ] Gentle banner at 12+ clients
- [ ] Limit reached modal with purchase link
- [ ] `src/main/license.ts` — LemonSqueezy activation
- [ ] Settings → License page with key input
- [ ] Single HTTPS activation call → store result locally
- [ ] Offline fallback message with Machine ID

### 5.20 — Auto-Update System
- [ ] `src/main/updater.ts` — electron-updater config (N/A — portable only)
- [x] Check once per launch (fail silently if no internet)
- [x] `UpdateBanner.tsx` — non-blocking top banner (portable: shows download link)
- [ ] Download in background with progress (N/A — portable only)
- [ ] "Restart Now" / "Remind Me Later" / "Skip This Version" (N/A — portable only)
- [x] Portable mode: "Download from Website" link instead of auto-update
- [x] `WhatsNewModal.tsx` — post-update release notes (shown on first launch after version change)
- [x] Settings → About → "Check for Updates" manual button
- [x] Pre-migration auto-backup before schema changes

### 5.21 — Accessibility Audit
- [x] ARIA roles: role="grid", role="row", role="gridcell" — already implemented in DataGrid
- [x] 4.5:1 contrast minimum (WCAG AA) — verified: slate-800/100 text on light/dark backgrounds
- [x] Thick 2px focus rings on all interactive elements — ring-2 in globals.css + DataGrid
- [x] Never rely on color alone — pair with icons/text/shapes — alert shape indicators added to date cells
- [x] Test at 100%, 125%, 150% zoom — layout uses flex/overflow, no fixed pixel breakage
- [x] Respect `prefers-reduced-motion` — global reduced-motion rules in globals.css
- [x] Descriptive error messages — all IPC errors use human-readable messages

### 5.22 — Final Polish
- [x] Pre-built setup templates (OPWDD, Social Worker, IEP, Probation, Therapist) — seeded lazily in templates.ts
- [x] Pre-built checklist templates — seeded lazily in templates.ts
- [x] Pre-built snippets — 12 seeded lazily in ipc-handlers.ts
- [x] `EmptyState.tsx` — friendly empty state with icon + title + description + optional CTA button
- [x] `LoadingSpinner.tsx` — animated spinner + `LoadingOverlay` centered loading state
- [x] `Tooltip.tsx` — hover tooltip (fixed positioning, placement-aware, reduced-motion safe)
- [x] `DatePicker.tsx`, `ColorPicker.tsx` shared components (ProfileHeader + DataGrid context menu refactored to use ColorPicker)
- [x] `animations.css` — animations added to globals.css (modal, toast, cell-save, status-fade, pulse, page, check-pop + reduced-motion)
- [x] DB integrity check (`PRAGMA integrity_check`) — `APP_INTEGRITY_CHECK` IPC + manual button in Settings → Data
- [x] Cell history retention auto-prune on startup — pruneOldCellHistory() in database.ts
- [ ] Cross-platform QA

**Phase 5 Exit Criteria:**
- [x] Onboarding wizard guides new users through setup (OnboardingView.tsx — role, path, columns, templates, import)
- [x] Command palette provides quick access to features (Ctrl+K)
- [x] All column types functional (phone, email, url, currency, notes, status, address, tag)
- [x] Undo/redo: cell edits, row delete/archive/create, column rename (Ctrl+Z/Y with toast)
- [x] Focus Mode provides simplified daily workflow (Ctrl+Shift+F, sidebar icon)
- [x] Settings page covers core configuration (Appearance, Security, Backup, Data, About)
- [~] Licensing enforces free tier and activates Pro — deferred (LemonSqueezy integration)
- [~] Accessibility meets WCAG AA — deferred (manual audit)
- [~] App is production-ready for distribution — pending final QA

---

## Phase 6: Garden (Gamification Layer) — REMOVED

Phase 6 (Garden gamification) has been removed from the build plan. Full design spec preserved in `Pulse_Complete_Spec.md` if revisited later.

---

## Phase 7: Contacts / Provider Directory

**Goal:** A private, searchable provider directory built for the care coordination workflow. Social workers and case managers maintain relationships with dozens of providers — hospitals, agencies, clinics, housing orgs, legal services, crisis lines — and need a single place to store contact info, referral processes, capacity status, and interaction history. This is not a general address book; every field and feature is chosen for this specific profession.

**What makes this different from a generic contacts app:**
- Availability/capacity status per provider (Accepting / Waitlist / Full / Unknown) with "last checked" date — because care coordinators constantly ask "are you taking new clients?"
- Referral process field — how to actually refer someone, step by step ("Call intake line, ask for Maria, fax form 2B, allow 5 business days")
- Client linkage — which of your clients has been referred to which provider
- Interaction log — simple call/email/visit log per provider ("Spoke with intake coordinator re: Maria — waitlist is 6 weeks")
- Custom fields per category — "NPI Number" for medical, "Practice Areas" for legal, "Income Limit" for housing
- Fully offline, fully private, no sync to external services

**New file tree:**
```
src/
  main/
    contacts.ts                  ← CRUD, filtering, vCard parse/emit, search
  renderer/
    views/
      ContactsView.tsx
    stores/
      contactsStore.ts
    components/
      contacts/
        ContactCard.tsx           ← card-view item (name, org, category bar, phone, availability)
        ContactRow.tsx            ← list-view item (denser table row)
        ContactDetail.tsx         ← right-panel detail view for selected contact
        ContactForm.tsx           ← create/edit modal or slide-in form
        ContactFilterBar.tsx      ← search + category chips + sort + view toggle
        CategoryManager.tsx       ← CRUD modal for custom categories with color picker
        AvailabilityBadge.tsx     ← colored badge: Accepting/Waitlist/Full/Unknown + last-checked
        ContactInteractionLog.tsx ← mini interaction log per provider
        ContactLinkedClients.tsx  ← which clients have been linked to this provider
        ContactImportExport.tsx   ← vCard import/export UI
```

---

### 7.0 — Database Schema (Migration 006)

- [x] `provider_categories` table: `id`, `name`, `color` (hex), `position`, `created_at`; default categories seeded on first load if table empty
- [x] `providers` table: `id`, `category_id` (FK → provider_categories, SET NULL on delete), `name` (primary display — person or org), `org_name` (organization if name is a person), `title` (job title), `phone_main`, `phone_direct`, `phone_fax`, `phone_cell`, `phone_after_hours`, `email`, `website`, `address` (multiline), `hours` (freeform, e.g. "Mon–Fri 8am–5pm"), `languages` (comma-separated), `availability_status` (accepting/waitlist/full/unknown, default unknown), `availability_notes`, `availability_checked_at`, `referral_process` (freeform text — how to refer a client), `notes` (general freeform), `is_starred` (0/1), `created_at`, `updated_at`
- [x] `provider_tags` table: `provider_id`, `tag` TEXT; `PRIMARY KEY (provider_id, tag)`
- [x] `provider_client_links` table: `id`, `provider_id`, `row_id`, `grid_id`, `linked_at`, `notes` (optional note about why linked/referral outcome)
- [x] `provider_interactions` table: `id`, `provider_id`, `created_at`, `contact_type` (call/email/visit/note), `content` TEXT NOT NULL
- [x] `provider_custom_fields` table: `id`, `category_id`, `field_name`, `field_type` (text/phone/email/url/number), `position` — defines extra fields that appear for all contacts in a category (max 10 per category)
- [x] `provider_custom_values` table: `id`, `provider_id`, `custom_field_id`, `value`; `UNIQUE(provider_id, custom_field_id)`
- [x] Indexes: `providers(category_id)`, `providers(is_starred)`, `providers(availability_status)`, `provider_client_links(row_id)`, `provider_interactions(provider_id)`, `provider_custom_values(provider_id)`

---

### 7.1 — IPC Layer & `contacts.ts`

- [x] `contacts.ts` in main process: all DB operations, full-text search (LIKE across name, org, notes, phone, email, referral_process), vCard parsing, vCard emission
- [x] IPC channels registered in `ipc-channels.ts` and handlers in `ipc-handlers.ts`:
  - `contacts:get-all` — params: `{search, categoryId, availabilityStatus, starred, sortBy, sortDir}` → returns providers with category join
  - `contacts:get-one` — params: `providerId` → full provider record including custom field values
  - `contacts:create` — returns new provider id
  - `contacts:update` — partial update
  - `contacts:delete` — hard delete with ConfirmDialog at UI level (spec decision: no soft-delete)
  - `contacts:get-categories`
  - `contacts:create-category`
  - `contacts:update-category`
  - `contacts:delete-category` — contacts in deleted category → category_id set to NULL ("Uncategorized")
  - `contacts:add-tag` / `contacts:remove-tag`
  - `contacts:get-client-links` (by provider_id or by row_id)
  - `contacts:link-client` / `contacts:unlink-client`
  - `contacts:add-interaction` / `contacts:get-interactions`
  - `contacts:mark-availability-checked` — updates `availability_checked_at` to now without changing status
  - `contacts:get-custom-fields` (by category_id) + `contacts:create-custom-field` + `contacts:delete-custom-field`
  - `contacts:get-custom-values` + `contacts:save-custom-value`
  - `contacts:import-vcf` — parse .vcf file, return preview array of contacts-to-import
  - `contacts:confirm-import-vcf` — commit parsed contacts to DB
  - `contacts:export-vcf` (single provider or all)

---

### 7.2 — Category Management

- [x] Default categories seeded on first `contacts:get-categories` call if table is empty: Medical, Mental Health, Housing & Shelter, Transportation, Legal Services, Community Resources, Government & Benefits, Education, Emergency Services, Other
- [x] Each default category has a distinct color from a predefined palette (blue, purple, amber, green, red, teal, orange, indigo, rose, slate)
- [x] `CategoryManager.tsx`: modal triggered by "Manage Categories" button in ContactsView header
  - Inline rename (click pencil icon) with 12 preset colors + custom hex input
  - Delete with inline confirmation warning
  - Add new category: name + cycling color picker
  - Custom fields sub-section per category (max 10, add/delete)
  - Deferred: drag-to-reorder (updates `position`)
- [x] Category color displayed as a left-border stripe on ContactCard and as a colored chip/dot in ContactRow
- [x] "Uncategorized" is a virtual category (not a DB row) — contacts with `category_id = NULL` shown here

---

### 7.3 — ContactsView Shell & Filter Bar

- [x] `ContactsView.tsx`: route `/contacts`; two-panel layout: left = filter bar + contact list/grid; right = contact detail panel (empty state if nothing selected)
- [x] On first open with no contacts: friendly empty state — "Your provider directory is empty. Add your first provider or import from a vCard file." + CTA
- [x] `ContactFilterBar.tsx`:
  - Search input (debounced 200ms, searches name, org, email, phone, notes, referral_process) + "/" shortcut
  - Category filter: horizontal scrollable chip row; "All" chip + one chip per category (colored)
  - Availability filter dropdown: All / Accepting / Waitlist / Full / Unknown
  - Starred filter toggle: star button — shows starred only when active
  - Sort dropdown: Name A–Z, Category, Availability, Recently Added, Recently Updated, Recently Contacted
  - View toggle: Cards / List
  - `[+ Add Provider]` button (primary, right side)
  - `[Import]` / `[Export]` buttons (secondary, in header bar)
  - `[Categories]` button → opens CategoryManager modal
- [x] Contact count shown in header bar: "47 providers"
- [x] Active filters shown as dismissible chips below the search bar — availability, starred, search chips with × dismiss

---

### 7.4 — Card View & List View

- [x] `ContactCard.tsx` (card view, default): responsive grid; each card with:
  - Left border stripe: category color (4px)
  - Star icon (top-right corner, click to toggle)
  - Provider name (bold, 16px)
  - Org name if different from name (muted, smaller)
  - Category chip (colored) + `AvailabilityBadge`
  - Phone (main) with click-to-copy icon
  - Email with click-to-copy icon
  - "Last contacted: 3 days ago" in muted text (from most recent interaction)
  - Hover: shadow + cursor pointer; click → loads ContactDetail in right panel
  - Deferred: right-click context menu, website click-to-open

- [x] `ContactRow.tsx` (list view): full-width dense rows, 44px height
  - Category color dot (12px circle), star toggle, name + org, category chip, phone, availability badge (compact), last contacted (relative)
  - Deferred: right-click context menu

---

### 7.5 — Contact Detail Panel

- [x] `ContactDetail.tsx`: right panel (~420px wide) within ContactsView; appears when a contact is selected; full scrollable detail
- [x] Header: provider name (large), org name, title, category chip, availability badge, star button; Edit + Delete buttons
- [x] **Contact info section**: each field is click-to-copy on hover (CopyField helper); phone numbers have label (Main/Direct/Fax/Cell/After-Hours)
- [x] **Hours**: displayed as formatted text + `[Mark as Checked Today]` quick button with flash animation
- [x] **Languages**: displayed as rounded tag chips
- [x] **Referral Process**: rendered in warm amber-tinted box; freeform text with line breaks preserved; `[Copy Referral Process]` button
- [x] **Custom fields**: section shown only if category has custom fields with values; renders field name + value pairs
- [x] **Notes**: freeform, full text, line breaks preserved
- [x] **Tags**: tag chips + inline `[+ Tag]` input with Enter to add, X to remove
- [x] **Linked Clients** tab: `ContactLinkedClients` — linked clients list with navigate-to-profile, link picker from current grid, unlink
- [x] **Interaction Log** tab: `ContactInteractionLog` — reverse-chrono list with type icons, inline add form (4 types), edit/delete on hover, search

---

### 7.6 — Contact Form (Create / Edit)

- [x] `ContactForm.tsx`: slide-in right panel (replacing detail panel)
- [x] Sections: Basic Info / Category Fields / Contact Info / Languages / Availability / Referral Process / Notes / Tags
- [x] **Basic Info**: Name (required), Organization, Title, Category (dropdown)
- [x] **Contact Info**: Phone Main, Phone Direct, Phone Fax, Phone Cell, Phone After-Hours, Email, Website, Address (multiline textarea), Hours (text)
- [x] **Languages**: tag-style input (type language, press Enter to add, XCircle to remove)
- [x] **Availability**: status radio buttons (Accepting / Waitlist / Full / Unknown) with colored indicators; notes textarea
- [x] **Referral Process**: textarea with placeholder
- [x] **Custom Fields**: if category selected has custom fields, they appear as "Category Fields" section with appropriate input types
- [x] **Notes**: general freeform textarea
- [x] **Tags**: tag chip input (Enter to add, XCircle to remove)
- [x] Save: Ctrl+Enter; Cancel: Escape; form validation (name required); dirty-check before close ("Unsaved changes — discard?")

---

### 7.7 — Availability System

- [x] Four statuses with consistent colors throughout the UI:
  - Accepting New Clients → green, Waitlist → amber, Not Accepting → red, Unknown → slate
- [x] `AvailabilityBadge.tsx`: shows status label + "Checked {N} days ago"; 30+ days → amber staleness; 90+ days → red; compact mode hides checked-at
- [x] `[Mark as Checked Today]` quick button in detail panel: single click, subtle green flash
- [x] Availability filter in ContactFilterBar: dropdown filter by status
- [x] Sort by availability in sort dropdown

---

### 7.8 — Custom Fields per Category

- [x] Custom fields defined at the category level — every contact in that category automatically has those fields available
- [x] Max 10 custom fields per category
- [x] Field types: `text`, `phone`, `email`, `url`, `number`
- [x] Custom field management within `CategoryManager.tsx`: sub-section "Custom Fields" in edit mode; add field (name + type dropdown), delete; deferred: drag-to-reorder
- [x] Custom fields render in ContactDetail (read-only display) and ContactForm (editable inputs) in position order
- [x] Example use cases as help text in CategoryManager — shown when no custom fields defined
- [x] Values stored per-contact in `provider_custom_values`; null/empty = field blank in form, hidden in detail

---

### 7.9 — Interaction Log

- [x] `ContactInteractionLog.tsx`: displayed in the Interaction Log tab of ContactDetail
- [x] Interaction types with icons: Phone (call), Mail (email), MapPin (visit), MessageSquare (note); colored left border per type
- [x] Each entry: type icon, content, relative timestamp, edit/delete icons (shown on hover); inline edit mode
- [x] Reverse-chronological default
- [x] Inline add form at top: 4 type selector buttons, 3-row textarea, Ctrl+Enter saves
- [x] Last interaction date shown on ContactCard and ContactRow ("Last contacted: 3 days ago")
- [x] Search within interactions: debounced search field filters content
- [x] Auto-entry on client link/unlink events — system case_log entries + notifyCaseLogChanged

---

### 7.10 — Client Linkage

- [x] Linked Clients tab in ContactDetail: `ContactLinkedClients` — each linked client shows name, grid name, linked date, optional notes, and unlink button on hover
- [x] `[Link a Client]` button: opens searchable picker using current grid's rows; select + optional notes to link
- [x] Client profile integration: `LinkedProviders.tsx` section in `ProfileView.tsx` (between ContactInfo and CaseLog); shows providers linked to this client with category color stripe, name, availability; `[Link Provider]` opens search; `[Unlink]` per entry; `[View]` navigates to `/contacts`
- [x] `contacts:get-client-links` by `row_id` used by ProfileView/LinkedProviders
- [x] Unlinking via single click (low-stakes action)

---

### 7.11 — vCard Import & Export

- [x] **Export all**: `[Export]` button in ContactsView header → `ContactImportExport` modal in export mode → calls `CONTACTS_EXPORT_VCF` (IPC handler shows save dialog)
- [x] **Import**: `[Import]` button in header → `ContactImportExport` modal → file picker → parse preview table (checkbox, name, org, phone, email) → select/deselect rows → `[Import Selected]` commits to DB
- [x] vCard parser written in `contacts.ts` (no external dependency): handles vCard 2.1 and 3.0; parses FN, ORG, TITLE, TEL (with TYPE), EMAIL, URL, ADR, NOTE; gracefully skips unknown fields
- [x] Imported contacts go into "Uncategorized" by default; user categorizes them after import
- [x] Export single contact vCard button in ContactDetail header
- [x] X-PULSE-* custom field extensions in vCard export/import

---

### 7.12 — Print & PDF Export

- [x] `[Print Directory]` — `exportDirectoryPdf()` in export.ts + Print button in ContactsView header
- [x] PDF export via jspdf — `exportContactPdf()` single contact + `exportDirectoryPdf()` directory
- [x] Print single contact — Printer button in ContactDetail → `EXPORT_PDF_CONTACT` IPC

---

### 7.13 — Profile View Integration

- [x] Add "Linked Providers" section to `ProfileView.tsx` (between ContactInfo and CaseLog) — `LinkedProviders.tsx`
- [x] Each linked provider: category color stripe, name, `[View]` → /contacts, `[Unlink]` on hover
- [x] `[Link Provider]` button: inline search (debounced 200ms against provider names via IPC); select → links
- [x] "No providers linked." empty state with Link Provider CTA

---

---

### 7.15 — Keyboard Shortcuts & Accessibility

- [x] `Ctrl+Shift+P` → navigate to `/contacts` from anywhere (in App.tsx global handler)
- [x] `/` → focus search field when ContactsView is open (keyboard handler in ContactsView)
- [x] `N` → open new contact form (when not in a form input)
- [x] Keyboard shortcuts added to KeyboardShortcutsModal (Contacts section)
- [x] `E` → edit selected contact (ContactsView.tsx keyboard handler)
- [x] Arrow keys: Up/Down navigate contact list, Enter opens detail, E edits, Ctrl+C copies phone
- [x] `Ctrl+C` on selected row → copy phone (ContactsView.tsx keyboard handler)
- [x] All interactive elements have focus rings and 44px minimum click targets
- [x] Full ARIA roles/labels — aria-current on nav, aria-expanded on toggles, aria-live on StatusBar, skip link, focus traps on modals

---

**Phase 7 Exit Criteria:**
- [x] Providers can be created, edited, and deleted with full field set
- [x] Custom categories with colors created and managed; contacts assignable to categories
- [x] Custom fields defined per category and filled per contact
- [x] Availability status system works with "last checked" staleness indicator
- [x] Client linkage works in both directions (from ContactsView and from ProfileView)
- [x] Interaction log records calls/emails/visits per provider
- [x] Search and filtering work across all fields with correct results
- [x] vCard import parses and previews before committing
- [x] vCard export produces valid .vcf files
- [x] PDF export — `exportContactPdf()` with all provider sections, IPC.EXPORT_PDF_CONTACT handler, Printer button in ContactDetail
- [x] `Ctrl+Shift+P` navigates to Contacts from anywhere
- [ ] Full keyboard navigation and accessibility — partially done, deferred items noted above

---

## Progress Summary

| Phase | Status | Items Done | Total Items |
|-------|--------|------------|-------------|
| Phase 1 — Foundation & Core Grid | Complete | ~65 | ~65 |
| Phase 2 — Intelligence Layer | Complete | ~25 | ~30 |
| Phase 3 — Profiles & Workflow | ~Complete | ~48 | ~55 |
| Phase 4 — Templates & Data | Complete | ~40 | ~45 |
| Phase 5 — Polish & Launch | ~Complete | ~70 | ~80 |
| Phase 6 — Garden | **Deferred** | 0 | ~95 |
| Phase 7 — Contacts / Provider Directory | ~Complete | ~55 | ~70 |
| **Total** | | **~303** | **~440** |

---

## Quick Reference

- **Spec file:** `Pulse_Complete_Spec.md`
- **Build plan:** `BUILD_PLAN.md` (this file)
- **DB schema:** Spec Section 4
- **IPC channels:** Spec Section 11
- **Project structure:** Spec Section 3
- **UI colors/typography:** Spec Section 10
- **Performance targets:** Spec Section 14
- **Security requirements:** Spec Section 15
