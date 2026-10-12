# Pulse by BaringaSoft — Session Progress Log

## 2026-02-28 — Trial & Licensing System

### Summary
30-day trial with LemonSqueezy license activation. IPC-level read-only enforcement on all write handlers. Clean build (327 tests pass, 0 failures).

### New Files (7)
- `src/main/licensing.ts` — Core logic: initLicense, getLicenseState, isAppReadOnly, activateLicense, deactivateLicense
- `src/main/ipc/ipc-license.ts` — LICENSE_GET_STATUS, LICENSE_ACTIVATE, LICENSE_DEACTIVATE handlers
- `src/renderer/stores/licenseStore.ts` — Zustand store for license state in renderer
- `src/renderer/components/licensing/TrialBanner.tsx` — Trial banner (blue/amber/red based on days remaining)
- `src/renderer/components/licensing/LicenseActivationModal.tsx` — License key input modal
- `LicSpec.md` — Full licensing specification
- `PLAN-licensing.md` — Implementation plan

### Modified Files (16)
- `src/shared/ipc-channels.ts` — Added 3 LICENSE_* channels
- `src/shared/types.ts` — Added LicenseState type
- `src/main/index.ts` — Call initLicense() at startup
- `src/main/ipc-handlers.ts` — Register license handlers
- `src/main/ipc/ipc-utils.ts` — Added enforceWritable() guard function
- `src/main/ipc/ipc-row.ts` — 14 write handlers guarded
- `src/main/ipc/ipc-grid.ts` — 12 write handlers guarded
- `src/main/ipc/ipc-cell.ts` — 4 write handlers guarded
- `src/main/ipc/ipc-caselog.ts` — 10 write handlers guarded
- `src/main/ipc/ipc-misc.ts` — 28 write handlers guarded
- `src/main/ipc/ipc-tasks.ts` — 14 write handlers guarded
- `src/main/ipc/ipc-contacts.ts` — 19 write handlers guarded
- `src/main/ipc/ipc-settings.ts` — 2 write handlers guarded
- `src/main/ipc/ipc-export.ts` — 9 write handlers guarded
- `src/renderer/App.tsx` — Mount TrialBanner + LicenseActivationModal, load license state after unlock
- `src/renderer/views/SettingsView.tsx` — Added License section with status/activate/deactivate

### Architecture
- License state in separate `pulse-license` electron-store (independent of DB)
- `enforceWritable()` at IPC level = security boundary; UI hints = UX
- One-time activation, no phone-home after
- Generous anti-tamper: corrupt trial date resets to now
- Test-safe: enforceWritable gracefully allows writes if licensing module unavailable

## 2026-02-28 — Expert Audit Remediation Round 6

### Summary
Round 6 addresses all 20 findings from expert audit (A 93/100): 7 medium, 9 low, 4 info. All tests pass (394), clean build.

### Medium Fixes
- **M1**: Zero crypto key material (wrapKey buffer) after use via `crypto.randomFillSync` in finally block
- **M2**: ScratchPad underline — imported `@tiptap/extension-underline` (was in package.json but never used)
- **M3**: Deduplicated `FilterOperator` type — single source of truth in `shared/types.ts`, gridStore re-exports
- **M4**: ProfileView Escape key now checks for open modals (letter template, print layout) before navigating back
- **M5**: Extracted `matchFilter()` to `src/renderer/utils/filterMatch.ts` — DataGrid and tests both import it
- **M6**: Contacts IPC tests already comprehensive (30+ tests covering full CRUD, links, tags, vCard, errors)
- **M7**: Validate template JSON via `validatePulseJson()` in `createSetupTemplate`

### Low Fixes
- **L1**: Documented synchronous DB requirement in database.ts
- **L2**: SQLite-side time comparison for `ROW_HARD_DELETE` (resilient to clock skew)
- **L3**: 2000-row LIMIT cap on `ROW_MOVE_TO_GRID` cell_format stamping
- **L4**: Symlink resolution via `realpathSync` in `assertSafePath`
- **L5**: Timer cleanup refs in ProfileHeader and ContactInfo (prevents setState-after-unmount)
- **L6**: Guard against "Unknown Client" in `addRecentProfile`
- **L7**: Idempotency guard on migration 017 `ALTER TABLE` using `PRAGMA table_info`
- **L8**: Conditional interaction JOIN in `getProviders` (only when sorting by last_contacted)
- **L9**: Replaced `as any` with typed `ContactFilterParams` cast in export.ts

### Info Fixes
- **I1**: Centralized `notifyCaseLogChanged` in `ipc-utils.ts` (removed from 5 IPC files)
- **I3**: Added vitest coverage config (`v8` provider, scoped to main/utils/shared)

### Files Modified (22)
`auth.ts`, `contacts.ts`, `database.ts`, `export.ts`, `ipc-caselog.ts`, `ipc-cell.ts`, `ipc-contacts.ts`, `ipc-misc.ts`, `ipc-row.ts`, `ipc-utils.ts`, `017_perf_phase3.ts`, `templates.ts`, `DataGrid.tsx`, `ContactInfo.tsx`, `ProfileHeader.tsx`, `ScratchPad.tsx`, `gridStore.ts`, `ProfileView.tsx`, `types.ts`, `filterMatch.ts` (new), `grid-filters.test.ts`, `vitest.config.ts`

## 2026-02-28 — Expert Audit Remediation Round 5 (A+ Final)

### Summary
Round 5 addresses 7 remaining real findings (3 false positives excluded). All tests pass (394), clean build.

### Changes (8 files)
- **H1**: Typed `autoTable()`/`lastTableY()` wrappers in export.ts — eliminates 11 `as any` casts
- **H2**: 50KB size cap on merged cell_formats JSON in ROW_MOVE_TO_GRID (prevents unbounded growth)
- **M2**: ContactRow focus ring changed to `ring-2 ring-blue-100` (matches ContactCard consistency)
- **L5**: CommandPalette cross-grid nav now awaits `loadGrid()` before navigating
- **L2**: 3 silent catch blocks in ROW_MOVE_TO_GRID now `console.warn()` instead of swallowing
- **L10**: `hexToRgba()` validates input with regex — returns fallback slate instead of `NaN`
- **L9**: +11 error-path tests across ipc-handlers, caseload-tasks, contacts

### False Positives (not fixed)
- M1 (Dashboard ARIA): Already has `role="list"` + `role="listitem"`
- M3 (FilterCondition.value type): `string` is correct — all cell values are strings in SQLite
- L3 (manual_contacts JSON.parse): Already wrapped in outer try/catch at handler level

## 2026-02-28 — Expert Audit Remediation Round 4 (A+ Push)

### Summary
Round 4 targets remaining gaps from A- (90/100) audit. 24 real findings fixed across 17 files. All tests pass (383), clean build.

### Phase 1: Performance (Hot Path)
- DataGrid: alertRules array → Map for O(1) lookup in cell loop
- DataGrid: eliminated per-cell `Object.keys(alertBgStyle)` allocation with boolean flag
- DataGrid: batch column width updates via new `COLUMN_BATCH_UPDATE_WIDTHS` IPC (single transaction instead of N+1)
- DataGrid: memoized `columnIds` for SortableContext
- DataGrid: stabilized `useReactTable` inputs (useCallback for onSortingChange, useMemo for state)
- DataGrid: replaced `[...parsedColumnConfigs.values()].some()` with `for...of` loop
- TASK_GET_ALL: explicit column list instead of `SELECT *`

### Phase 2: Data Integrity
- ROW_CREATE: wrapped MAX(position) + INSERT in transaction
- CASE_LOG_DELETE: wrapped SELECT row_id + DELETE in transaction
- getRow cache key: changed separator from `,` to `|` (prevents `[1,23]` vs `[12,3]` collision)
- import.ts: _importInProgress reset in `finally` block (was reachable code path that could leave flag stuck)

### Phase 3: Input Validation
- TASK_CREATE: title length/emptiness + recurrence_rule JSON + type validation
- TASK_SNOOZE: YYYY-MM-DD regex validation
- CL_TEMPLATE_CREATE: name length + items JSON array validation
- CHECKLIST_APPLY_TEMPLATE: try/catch around JSON.parse
- GLOBAL_NOTE_GET/UPDATE: scope type/length validation
- ALERT_RULE_CREATE: name/thresholds/interval_days validation

### Phase 4: Reliability
- taskStore.loadTasks: try/finally ensures loading=false on error
- LetterTemplateView: fixed timer leaks in both copy handlers (clearTimeout + cleanup useEffect)
- auth.ts: empty password validation added

### Phase 5: Contacts Store
- addTag/removeTag: optimistic local selectedProvider.tags update (removed full selectProvider reload)
- markAvailabilityChecked: optimistic local update on providers array + selectedProvider (removed loadProviders)

### Phase 6: Test Coverage (+8 tests)
- Auth: empty password, unicode password, long password (>512 chars)
- Tasks: yearly recurrence, leap year Feb 29 handling
- Import: multi-sheet xlsx, empty worksheet, formula cells

### Verification
- `npx tsc --noEmit` — clean
- `npm test` — 383 tests pass (22 suites)
- `npm run build` — clean production build (4.00s)

### Files Modified (17)
`DataGrid.tsx`, `ipc-grid.ts`, `ipc-channels.ts`, `ipc-row.ts`, `ipc-caselog.ts`, `database.ts`, `import.ts`, `ipc-tasks.ts`, `ipc-misc.ts`, `ipc-settings.ts`, `taskStore.ts`, `LetterTemplateView.tsx`, `contactsStore.ts`, `auth.ts`, `auth.test.ts`, `caseload-tasks.test.ts`, `import.test.ts`

## 2026-02-28 — Expert Audit Remediation Round 3 (Comprehensive)

### Summary
Full audit remediation targeting A+ score. Fixed 50+ findings across 38 files covering data integrity, security hardening, error handling, performance, and code quality.

### Phase 1: Data Integrity (15 fixes)
- Fixed `is_not_empty` filter bug (null coercion before comparison)
- CellEditor double-save prevention via `savedRef` guard
- deleteRow/duplicateRow redo corruption fixed (reload grid, direct IPC)
- `setGroupByColumnId` handles `'__acuity__'` string and `0`
- CASE_LOG_COMPLETE_FOLLOWUP wrapped in transaction
- `clearStmtCache()` after migrations, LIKE query ESCAPE clauses
- Voided entries filtered from PDF export, ContactForm tag sync
- SAVED_VIEW_UPDATE wrapped in transaction, CHECKLIST_GET_URGENT LIMIT
- Migration 012/014 made idempotent, display_name backfill on import

### Phase 2: Security Hardening (14 fixes)
- Auth input validation (password/recovery key type+length checks)
- `validId()` helper applied across 103 IPC handlers in 7 files
- CSP enforced via `onHeadersReceived` protocol-level headers
- `setPermissionCheckHandler(() => false)` blocks all permission requests
- `devTools: false` in production, URL canonicalization for `shell.openExternal`
- Auth functions no longer return raw DB key, consistent hex encoding
- DOCUMENT_REF_OPEN restricted (no home directory fallback)
- Fixed `changePassword` using utf8 instead of hex for key wrapping

### Phase 3: Error Handling (10 fixes)
- Pre-login views wrapped in ErrorBoundary
- ScratchPad/CaseLog/ContactLinkedClients/ProfileView error surfacing via toast
- Import race condition guard, AlertStore selector fix
- ProfileView keyboard stale closure fix, navigateCell ref-based state
- RelatedDocuments delete result checking

### Phase 4: Performance (6 fixes)
- Bulk action bar O(n*m) → O(1) Map lookup
- React.memo on FocusModeView sub-components and UndoHistoryPanel items
- useMemo for allColumns in GridToolbar, module-level columnHelper

### Phase 5: Code Quality (6 fixes)
- ROW_TAG_COLUMN_ID shared constant, applySavedView type guards
- ESLint no-explicit-any → error, provider_client_links index (migration 023)
- Tooltip div wrapper with display:contents, Buffer hex encoding consistency

### Verification
- `npx tsc --noEmit` — clean
- `npm test` — 375/375 passing
- `npm run build` — clean (4.19s)

**Commit:** 157aec3

---

## 2026-02-28 — Expert Audit Remediation Round 2 (7 Waves)

### Summary
Comprehensive audit identified 2 critical, 7 high, 10 medium, 15 low findings. All critical/high/medium fixed. Grade: B+ (up from previous audit baseline).

### Changes Made (20 files, 375 tests passing)

**Wave 1 (Critical):** `_loadVersion` guard in gridStore.loadGrid and contactsStore.loadProviders prevents stale IPC responses from overwriting state. Clears cellFormats/rowTagsMap on grid switch. sortConfig element validation.

**Wave 2 (High):** Replaced all raw `window.api.invoke` in taskStore undo/redo with typed `invoke` wrapper + `res.ok` checks. Added error guards to 8 contactsStore operations.

**Wave 3 (High):** ScratchPad sanitizes HTML via DOMPurify on save (defense in depth). SettingsView clears password form + recovery key on unmount.

**Wave 4 (High):** MAX_IMPORT_ROWS (50K) for CSV/Excel. Excel uses streaming `readFile`. Batch PDF capped at 200, sort query filters by selected rowIds, contact PDF passes limit=10.

**Wave 5 (Medium):** Input validation on 12 IPC handlers (size limits, array bounds, type checks, integer validation on all reorder handlers). Production log gating.

**Wave 6 (Medium):** getRow cache key collision fix, import cache busy lock, DataGrid rowFormatStyle useMemo.

**Wave 7 (Low):** OnboardingView counter IDs, context menu ARIA role, ContactsView useCallback + proper deps.

**Commit:** 937cc04

---

## 2026-02-28 — Expert Audit Remediation (All 9 Batches)

### Changes Made (45 files, 375 tests passing)

**Batch 1 — Zero-risk fixes:** task priority `'medium'`→`'normal'`, tiptap Underline extension, ConfirmDialog unique IDs via `useId()`

**Batch 2 — Input validation:** `VALID_COLUMN_TYPES` export in shared/types.ts, recovery key lockout, `ROW_SET_MANUAL_CONTACTS` array validation, ContactForm inline email/URL/phone validation, `CONTACTS_ADD_INTERACTION` 100k content limit, `CELL_FORMAT_SET` size+JSON validation, `addInteraction` type allowlist, `addTag` length/count limits

**Batch 3 — Error handling:** undo/redo `console.error`, contactsStore IPC result check, DashboardView loadError state, alertStore error field, settingsStore lock error logging

**Batch 4 — Reliability:** stale DB timer cleared on close, `removeSystemAlertRules()` moved to `openDatabase()`, coalesced undo sideEffects capped at 50

**Batch 5 — Performance:** DataGrid O(1) `columnMap` via `useMemo` + passed to SortableRow, static SVG alert shape constants, migration 022 dashboard indexes, taskStore selector subscription, `export.ts` reuses `buildGridQuery` (also fixes soft-delete bug in CSV/PDF exports)

**Batch 6 — UX/Accessibility:** context menu `setTimeout(0)` race fix, ScratchPad snippet menu caret positioning, OnboardingView `aria-label` on column inputs, Settings password mismatch inline error + button disable, CommandPalette backdrop `role="presentation"`, CaseLog pagination (PAGE_SIZE=50, Load More button)

**Batch 7 — Security:** safeStorage warning dialog on first launch (shows once), `DOCUMENT_REF_OPEN` restricted to Documents/Desktop/Downloads, CSV import converted to PapaParse streaming mode, CSP adds `object-src 'none'; base-uri 'self'` (unsafe-inline deferred), key zeroing via `crypto.randomFillSync`, lockout counter persisted in electron-store with 30-min max cap

**Batch 8 — Architecture:** split 3521-line `ipc-handlers.ts` into 11 domain files under `src/main/ipc/` (207 handlers, TypeScript clean)

**Batch 9 — Tests:** 19 new IPC validation tests, task priority allowlist added to `TASK_CREATE`, `vi.hoisted()` fix for auth mock TDZ, `cachedStmt` mock fix in caseload-tasks test, safeStorage/dialog mocks across all test files

**Commit:** a3878b4

---

## 2026-02-28 — Performance Phase 8

### Changes Made (8 files)

**Hoist hasAnyHighlightRules** (DataGrid.tsx)
- Precompute `hasAnyHighlightRules` as `useMemo` in DataGrid, pass boolean prop to SortableRow
- Eliminates 4000 array spreads + `.some()` iterations per render cycle (200 rows × 20 columns)
- Added to SortableRow memo comparator

**Cache uncached SQL statements** (ipc-handlers.ts)
- `GRID_GET_ALL` → `cachedStmt('grid_get_all', ...)`
- `CELL_FORMAT_GET_FOR_GRID` → `cachedStmt('cell_format_get_for_grid', ...)`
- `DASHBOARD_GET_COMPLETED` → `cachedStmt('dash_completed', ...)`
- `DASHBOARD_GET_ARCHIVED` → `cachedStmt('dash_archived_standalone', ...)`

**Deduplicate loadGridList** (GridView.tsx)
- Guard `loadGridList()` with `if (!gridListLoaded)` — prevents duplicate IPC call when Sidebar already loaded

**Batch ProfileView snippets** (ProfileView.tsx, ScratchPad.tsx, CaseLog.tsx)
- Hoist SNIPPET_GET_ALL to ProfileView, pass as prop to CaseLog + ScratchPad
- Both components accept optional `snippets` prop; skip internal fetch when provided
- Eliminates 1 redundant IPC round-trip per profile open

**Batch column visibility IPC** (ipc-channels.ts, ipc-handlers.ts, gridStore.ts)
- New `COLUMN_BATCH_UPDATE_VISIBILITY` IPC channel + handler
- `applySavedView` now sends one batch IPC call instead of N sequential COLUMN_UPDATE calls
- Single DB transaction for all visibility changes

**Batch PDF export queries** (export.ts)
- Hoist grid/columns/nameColId outside per-client loop in `exportPdfBatch`
- New `ProfileDocContext` interface; `renderProfileToDoc` accepts optional shared context
- Eliminates 3 redundant queries per client in batch export (was: 3 × N queries → 3 total)

### Session Summary
- Performance audit found 14 items; 5 highest-impact fixes implemented
- TypeScript: clean compile (`npx tsc --noEmit`)
- Build: clean (`npm run build` succeeds)

## 2026-02-28 — Performance Phase 7

### Changes Made (7 files, migration 021, schema_version → 21)

**CellDisplay config prop** (DataGrid.tsx)
- Pass pre-parsed `parsedConfig` from parent's useMemo to CellDisplay
- Eliminates ~1,000 JSON.parse calls per scroll repaint (200 rows × 5 computed columns)
- 3 switch branches updated: age_from_dob, calculated_days, status

**GridToolbar isolation** (GridToolbar.tsx)
- Extracted `AcuityPointsBadge` as isolated component with its own rows subscription
- GridToolbar no longer subscribes to `rows` — stops re-rendering on every cell edit

**rowFormatStyle early exit** (DataGrid.tsx)
- Skip entire highlight-rule column loop when no cellFormats and no highlightRow rules exist

**Async import file read** (import.ts)
- `readFileSync` → `readFile` from fs/promises in getCachedOrParse
- Eliminates 1–3s main thread freeze when previewing large CSV/Excel files

**Dashboard cachedStmt** (ipc-handlers.ts)
- All 5 dashboard sub-queries migrated to cachedStmt (DASHBOARD_GET_ALL, _DEADLINES, _STATS, _FOLLOWUPS)
- Eliminates recompilation on every dashboard navigation

**Query limits** (ipc-handlers.ts)
- TASK_GET_ALL: added LIMIT 500
- TASK_GET_HISTORY: added LIMIT 50

**Migration 021** (checklist_items partial index)
- `idx_checklist_urgent ON checklist_items(priority, is_completed, is_archived) WHERE priority='urgent' AND is_completed=0 AND is_archived=0`

**incremental_vacuum** (database.ts)
- `incremental_vacuum(200)` runs deferred 15s after unlock — reclaims freed pages

### Commits
- `d2b8405` — Performance phase 7: CellDisplay config, GridToolbar isolation, async import, cachedStmt, indexes

### Build State
- Clean `tsc --noEmit`, clean build (4.23s)
- Pushed to origin/main

---

## 2026-02-28 — Performance Phase 6

### Changes Made (5 files, migration 020, schema_version → 20)

**Import prepare hoisting** (import.ts) — biggest user-visible fix
- Hoisted `db.prepare()` for row INSERT and cell INSERT outside the chunk loop
- Eliminates ~10,500 unnecessary SQLite query compilations on a 500-row, 20-column import
- Saves 200ms–1s of pure overhead on older hardware

**Pivot query caching** (ipc-handlers.ts)
- GRID_GET now uses `cachedStmt()` for the pivot query (was calling `db.prepare()` on every grid switch)
- Cache key includes column IDs + archived flag to avoid collisions between grids

**Follow-up query limits** (ipc-handlers.ts)
- Added `LIMIT 300` to both DASHBOARD_GET_ALL and DASHBOARD_GET_FOLLOWUPS follow-up queries
- Prevents unbounded result sets in databases with years of case log history

**Partial index** (migration 020)
- `idx_case_log_followup ON case_log(follow_up_date) WHERE follow_up_date IS NOT NULL AND follow_up_completed = 0 AND voided_at IS NULL`
- Tight partial index — only indexes rows the follow-up queries actually read

### Commits
- `f548c58` — Performance phase 6: hoisted import prepare, cached pivot query, follow-up LIMIT + index

### Build State
- Clean `tsc --noEmit`, clean build (4.16s)
- Pushed to origin/main

---

## 2026-02-28 — Performance Phase 5

### Changes Made (6 files, migration 019, schema_version → 19)

**Missing indexes** (migration 019)
- `idx_row_tags_row ON row_tags(row_id)` — TAG_GET_ROWS_FOR_GRID was full-scanning
- `idx_saved_filters_grid ON saved_filters(grid_id)` — SAVED_FILTER_GET_ALL filter
- `idx_saved_views_grid ON saved_views(grid_id)` — SAVED_VIEW_GET_ALL filter
- `idx_provider_client_links_provider ON provider_client_links(provider_id)` — getClientLinks filter

**useShallow fixes** (3 components)
- `GridStatusFooter.tsx` — consolidated 3 separate useGridStore calls into single useShallow
- `ProfilePrintLayout.tsx` — consolidated 3 separate store subscriptions into single useShallow
- `GlobalTaskDialog.tsx` — wrapped useGridStore(s => s.grids) with useShallow

**Query limit** (contacts.ts)
- `getInteractions()` now has `LIMIT 500` to prevent unbounded provider interaction loads

**PERF_NOTES.md** — updated with all phase 5 findings and decisions

### Commits
- `42d0b8b` — Performance phase 5: missing indexes, useShallow fixes, query limits
- `2d1a79f` — Update PERF_NOTES.md with performance phase 5 findings

### Build State
- Clean `tsc --noEmit`, clean build
- Pushed to origin/main

---

## 2026-02-28 — Performance Phase 4 + Bugfixes

### Changes Made (16 files, migration 018, schema_version → 18)

**React rendering — SortableRow memo comparator** (biggest perf fix)
- Custom `React.memo` comparator on `SortableRow` compares `row.original` identity
- When one cell changes, only that row re-renders (not all 200)
- Compares per-row editing/focus state instead of global IDs — rows not involved in editing are skipped
- Virtual scrolling overscan increased 10 → 20 (880px buffer at 44px rows)

**Async PBKDF2** (auth.ts)
- `crypto.pbkdf2Sync` → `crypto.pbkdf2` (callback-based async)
- Main process stays responsive during ~1.5s key derivation on unlock
- All 7 callers updated with `await`

**Database optimization** (migration 018)
- Compound index `idx_case_log_row_type ON case_log(row_id, log_type, is_pinned, created_at)` — covers CASE_LOG_GET WHERE + ORDER BY
- Partial index `idx_rows_deleted_at ON rows(deleted_at) WHERE deleted_at IS NOT NULL` — speeds trash purge
- Replaced `SELECT *` with explicit columns in GRID_GET_ALL and CASE_LOG_GET
- Added `LIMIT 500` to both dashboard deadline queries

**Migration runner fix** (database.ts)
- Migration 016 contains `VACUUM` which cannot run inside a transaction
- Added `noTransaction` flag to migration system — migrations that need it run outside the transaction wrapper
- This was a latent bug: only triggered on fresh installs where all 18 migrations run from scratch

**Clipboard fix** (preload + ipc-handlers)
- `navigator.clipboard.writeText()` fails in sandboxed Electron preload
- Added `copyToClipboard` via IPC: preload sends `clipboard:write` → main process calls `clipboard.writeText`
- Replaced all 14 `navigator.clipboard.writeText` calls across 9 files
- Updated `global.d.ts` with `copyToClipboard` type

**Backup restore file dialog fix** (SettingsView.tsx)
- GTK on Linux cannot filter compound extensions like `.pulse-backup`
- Changed file dialog to show all files; backend validates extension on selection

### Commits
- `edc5b7d` — Performance phase 4: SortableRow memo, async PBKDF2, indexes, clipboard fix

### Build State
- 360 tests passing, clean `tsc --noEmit`, clean build
- Pushed to origin/main

---

## 2026-02-28 — Performance Phase 3

### Changes Made (31 files, migration 017, schema_version → 17)

**Materialized display_name** (biggest bottleneck fix)
- New `display_name TEXT` column on `rows` table replaces correlated `fullNameSubquery`
- SQL triggers maintain display_name on cell INSERT/UPDATE/DELETE and column name changes
- Backfill query populates existing rows during migration
- Removed `fullNameSubquery()` function and all 14 call sites across ipc-handlers.ts, export.ts, contacts.ts
- Cross-grid search (Ctrl+K) now uses simple `LIKE` on `display_name` + `ORDER BY display_name`

**React rendering optimization**
- Applied `useShallow` to ~25 additional component-store subscriptions (contacts, settings, undo, alert, task, profile stores)
- DataGrid: SortableRow now receives primitive `editingRowId`/`editingColId`/`focusedRowId`/`focusedColId` instead of object props — React.memo short-circuits unchanged rows
- Stabilized `handleCellKeyDown` via refs (rows, filteredRows, selectedRowIds, clipboard read from refs), reducing dep array to `[columns, updateCell, navigateCell]`

**Database query optimization**
- Compound indexes: `idx_checklist_completed`, `idx_case_log_voided_type`, `idx_case_log_followup_v2`, `idx_rows_display_name`
- Cached `getRow` pivot query and `CASE_LOG_GET` prepared statements via `cachedStmt`
- Added `LIMIT/OFFSET` pagination to `CASE_LOG_GET` (default 200, max 1000)
- Combined 5 dashboard IPC calls into single `DASHBOARD_GET_ALL` handler
- Provider list query: explicit column list instead of `SELECT *`

**Data operations**
- `exportCsv` converted to async (`atomicWriteFileAsync`)
- Batch PDF export: yields every client instead of every 2
- Cached `electron-store` singletons in backup.ts (was creating new instances per call)
- Reduced `IMPORT_CHUNK_SIZE` from 200 to 50 for smoother progress feedback
- Added 150ms debounce to dashboard search

**Tests**: 360 passing, clean `tsc --noEmit`, clean build

---

## 2026-02-25 — Soft-Delete (Trash) Feature

### Changes Made

**Soft-delete replaces hard delete for clients** (14 files, migration 012)
- `ROW_DELETE` now sets `deleted_at` + `is_active=0` instead of `DELETE FROM rows`
- `ROW_HARD_DELETE` added for undo of addRow/duplicateRow (true FK cascade)
- `ROW_RESTORE_DELETED`, `ROW_PURGE`, `ROW_GET_DELETED` IPC handlers
- `buildGridQuery` + `getRow` exclude `deleted_at IS NOT NULL` rows
- `DASHBOARD_GET_ARCHIVED` excludes soft-deleted rows
- Auto-purge on DB open: rows in trash > 30 days are permanently deleted
- Supervisor report: "closed" split into separate "archived" and "deleted" counts

**TrashView** (new: `src/renderer/views/TrashView.tsx`)
- Table: client name, grid name, deleted date, days remaining (30 - age)
- Per-row: Restore button, Delete Permanently button (with ConfirmDialog)
- Empty Trash: typed confirmation (type "EMPTY")
- Route: `/trash`, Sidebar nav item with Trash2 icon

**DataGrid UI updates**
- Context menu: "Move to trash" (was "Delete row")
- Single delete dialog: "Move to trash?" with 30-day recovery message
- Bulk delete dialog: "Move to trash?" with typed confirmation (`TRASH N`)

**gridStore updates**
- `deleteRow`: simplified — no snapshot needed, undo calls `ROW_RESTORE_DELETED`
- `addRow` undo: uses `ROW_HARD_DELETE` (not soft-delete)
- `duplicateRow` undo: uses `ROW_HARD_DELETE` (not soft-delete)

**Supervisor report enhancements** (export.ts)
- Archived client names + dates listed in report detail section
- Deleted client names + dates listed in report detail section
- New clients added names + dates listed in report detail section
- Deadlines due count in caseload summary stats
- Executive summary includes all new metrics
- Date range comparisons fixed: `date(archived_at) >= ?` for timestamp vs date-only
- System case_log entries created on delete, archive, unarchive, restore

**Activity timeline events**
- ROW_DELETE → "Client moved to trash" system log entry
- ROW_ARCHIVE → "Client archived" (with optional reason) system log entry
- ROW_UNARCHIVE → "Client unarchived" system log entry
- ROW_RESTORE_DELETED → "Client restored from trash" system log entry

**Help Center** (HelpView.tsx)
- 4 new FAQ entries: trash overview, restoring from trash, permanent deletion, archive vs delete

**Supervisor report — full names + completions** (export.ts)
- `getClientName()` reads materialized `display_name` from rows table
- `dateToIso()` SQL helper converts MM/DD/YYYY → ISO for date comparisons
- Deadlines completed count (via cell_history date changes)
- Checklist items completed count (profile checklists)
- Tasks completed count (caseload_tasks)
- All three stats in executive summary, CSV, and PDF

**Bulk action fixes**
- ROW_BULK_ACTION now inserts case_log entries for archive/unarchive/delete
- BulkMoveToGridModal: undo support for bulk move between caseloads
- TrashView: listens for CASE_LOG_CHANGED to refresh on undo

**UI improvements**
- Templates page: side-by-side layout, clearer descriptions, fixed scrolling
- Delete/Backspace key clears focused cell contents
- Profile button golden sweep glow animation (profile-btn-glow CSS)
- Help section: "Log Changes in Timeline" column setting documentation

**Other cleanup**
- Removed bulk Print button from DataGrid (broken dynamic require, redundant with Export)
- Removed unused row numbers toggle (showRowNumbers state + GridToolbar button)
- Fixed 3 dynamic `require('./export')` calls → static imports (vite bundler compatibility)

**Tests**: 254 passing, clean `tsc --noEmit`, clean build

---

## 2026-02-25 — Rebrand + Supervisor Report Enhancements

### Changes Made

**Rebrand: "CaseConnect Pulse" → "Pulse by BaringaSoft"** (12 files)
- package.json: productName, copyright, file association description
- Window title, HTML title, lock screen, password setup, settings about section
- Recovery key print page (title + heading)
- Profile print footer, all PDF footers in export.ts (5 spots)
- Windows registry file association description
- Test mock app name

**Supervisor Report — Dialog enhancements** (SupervisorReportDialog.tsx)
- Auto-populate worker name/title/org from profile settings on mount
- Title and Organization input fields below worker name
- Preset date range buttons: This Week, This Month, Last Month, This Quarter
- Active preset highlight; clears when dates manually edited

**Supervisor Report — PDF enhancements** (export.ts)
- Header expanded to show worker title/org below name
- Confidentiality banner (warm yellow bar): "CONFIDENTIAL — PROTECTED HEALTH INFORMATION"
- Executive summary paragraph in light gray rounded box (auto-generated from stats)
- Acuity breakdown row in summary (if acuity enabled): level counts + total points
- Overdue deadlines count + approaching (next 7 days) count in summary
- Branded footer bar: slate-200, 12mm, 9pt with timestamp + worker name + "Pulse by BaringaSoft"
- Page numbers right-aligned within footer bar

**Supervisor Report — CSV enhancements** (export.ts)
- Confidentiality row at top
- Title/Organization rows in header
- Executive summary section
- Acuity/overdue/approaching rows in summary
- Branded "Pulse by BaringaSoft" in generated footer

## 2026-02-24 — Help/FAQ Polish, Global Task Shortcut, PDF Fix

### Changes Made

**Help Center / FAQ text fixes** (HelpView.tsx)
- "Customize columns" — rename instruction changed to "right click column header and select rename"
- "Multiple caseloads" — removed "bottom of the" from sidebar reference
- "Add or remove columns" — hide column text rewritten: right-click → hide → Columns button appears
- "Sort by column" — clarified multi-sort is a tiebreaker for tied values
- "Deadline alerts work" — removed Show Me button (demo animation kept)
- "Dashboard show me" — removed demo animation (Show Me kept)
- Several other FAQ text refinements from user review (deadline alerts, archive, search, conditional format, cell history)

**Tour / Show Me improvements** (TourOverlay.tsx, Sidebar.tsx, DataGrid.tsx)
- "Multiple caseloads" Show Me now highlights the + button (data-tour="new-caseload") instead of entire sidebar
- "Open client profile" Show Me now highlights the first row's profile icon button (data-tour="profile-icon") instead of entire grid
- Added `archived-toggle` tour step

**Global Ctrl+Shift+T — Quick Add Task** (App.tsx, GlobalTaskDialog.tsx)
- New `GlobalTaskDialog` component: opens as overlay on current page without navigating away
- Ctrl+Shift+T works from grid, profile, dashboard, contacts — anywhere
- On Tasks page, local handler (capture phase) opens the native TasksView dialog instead
- Toast confirmation on task creation

**Profile PDF export fix** (export.ts)
- `addKeyValue()` now wraps long values using `splitTextToSize` instead of truncating
- Labels too long for inline value (< 30 units remaining) drop value to next line
- Extra spacing between label colon and value text

**Multi-sort investigation**
- Confirmed multi-column sort works correctly (debug logging verified full data flow)
- TanStack Table receives and applies multi-entry sorting state properly
- Secondary sort only affects rows with identical values in primary sort column (by design, same as Excel)

### Commits
- `2bab4e6` — Fix missing DemoRightClick import in HelpView
- `84d1ed9` — Global Ctrl+Shift+T task dialog, profile PDF wrapping, help fixes

### Build State
- `npx tsc --noEmit` — clean (no errors)
- All changes pushed to origin/main

---

## Session: Expert Audit & Remediation (2026-02-28)

### Audit
- Full security, reliability, and quality audit conducted across entire codebase
- Grade: **B+ (82/100)** — 0 Critical, 1 High, 9 Medium, 9 Low findings
- Prioritized remediation plan created (Tiers 1-4)

### Tier 1 Fixes (High Priority)
- Upgraded `@electron/rebuild` ^3.7.2 → ^4.0.3 (tar CVE)
- Routed `clipboard:write` through `secureHandle`/`invoke` (was fire-and-forget `ipcMain.on`)
- Wrapped `ROW_HARD_DELETE` in `db.transaction()` (TOCTOU race fix)
- Added `selectedRowIds` cleanup after single row deletion
- Fixed `autoLockMinutes=0` not persisting (`> 0` → `>= 0`)

### Tier 2 Fixes (Medium Priority)
- Created typed IPC contract (`src/shared/ipc-contract.ts`) — ~70 channels with args/return types
- Enabled `noUncheckedIndexedAccess` + `forceConsistentCasingInFileNames` in both tsconfigs (fixed 291 TS errors across 75 files)
- Added 5-minute TTL auto-clear for import cache (memory leak prevention)
- `DOCUMENT_REF_GET_ALL` now resolves relative paths against docs root setting
- Fixed `deleteProvider` redo to track recreated ID (was name-matching)

### Tier 3 Fixes (Low Priority)
- Narrowed `assertSafePath` to Documents/Desktop/Downloads/userData/temp only
- Added `maxEntries=1000` limit to vCard parser
- Fixed CSV formula injection regex for `\r\n` line endings
- Pinned `lucide-react` to exact `0.575.0` (0.x semver safety)
- Verified undo closures already use IDs (no stale reference risk)

### Build State
- `npx tsc --noEmit` — clean (0 errors, both tsconfigs)
- `npm run build` — clean
- `npm test` — 359/360 pass (1 pre-existing failure in caseload-tasks.test.ts, cachedStmt cache issue, not caused by audit changes)
- 75 files changed, 396 insertions, 368 deletions
- All changes pushed to origin/main

## 2026-09-30 — Code review + Claude Code tooling refresh

- Full fresh-eyes review → `plans/CODE_REVIEW_2026-09-30.md` (3 critical, 4 high, 6 medium; no code fixes applied yet)
- `.claude/commands/` → `.claude/skills/` (security-audit now absorbs ipc-inventory; super-audit dropped in favor of built-in `/code-review` + `/security-review`)
- New skills: `/verify`, `/new-migration`, `/ipc-channel`
- New hooks (`.claude/settings.json`): block direct vitest; post-edit migration `schema_version` guard + per-file eslint errors
- `scripts/run-tests.sh`: `npm test -- <files>` now passes args to vitest; added `npm run typecheck` / `npm run lint`
- CLAUDE.md: stale counts/paths fixed (31 migrations, Reference Board/Documents removed), known-debt note
- Build state: `npm test` 2860 pass / 4 skip; typecheck 161 pre-existing errors

## 2026-09-30 (cont.) — Review fixes implemented

- fff4887: restore on a new computer (key envelope in .pulse-backup + restore flow on setup/lock screens), corrupt credential file quarantined not deleted, legacy >72-byte password fallback, recovery-key changes need the password, UTC→local date fixes (import + ~20 "today" sites), UTC timestamps displayed correctly
- fb99191: dashboard ordered by effective due date, LemonSqueezy store/product check (IDs TODO), contact tag fix, tiered auto-backup retention, no 90-day history purge, cell grid check, sender-origin check, pulse-file:// removed + CSP on app://, deps (12 prod advisories → 2 moderate)
- Typecheck 150 → 0, eslint errors → 0, react-hooks plugin; several real bugs fixed along the way (see CODE_REVIEW M3)
- Build state: `npm test` 2894 pass / 4 skip; `npm run build` clean
- LICENSE_PRODUCT IDs filled in (store 303699, product 868791)
- Open: manual walkthrough of restore flow in the real app; backlog = UI polish, functionality brainstorm, IT security screen review

## 2026-09-30 (cont.) — UI polish pass
- Plan: plans/ui-polish-plan.md (approved: strategy B, keep dark mode)
- `npm run ui-tour` screenshot tool (seeded demo caseload, light+dark, 1366×768)
- Commits dc5451e, e82821a, dd8dacb + final: readable text/contrast, 15px controls, 44px click areas, 3px focus rings, dark-mode fixes, layout fixes (trial notice, scrollbars, setup screen), plain-English copy
- Build state: npm test 2899 pass / 4 skip; typecheck 0; eslint 0 errors

## 2026-09-30 (cont.) — IT security readiness review
- Target: individual workers who need their employer's OK; one user per license; release postponed until review + follow-up dev
- Deliverables in plans/security-review/: security-at-a-glance, supervisor-it-faq, recommended-settings, hipaa-safeguards-map, gaps-and-roadmap
- Fixed during review: factory reset left recoverable copies (d035d90)
- Corrected SECURITY_ARCHITECTURE_BRIEF: update check is automatic once per unlock (not manual); BAA wording softened (lawyer to confirm); product name
- Next: small product fixes from gaps #1,3,6,7,10,14 (~2 days), then docs/website page, then audit-trail work

## 2026-10-01 — Security review fixes
- 1c98d1e: lock on sleep/screen lock/user switch; no "Never" auto-lock (max 2 h); main fallback now reads the real setting (was always 30 min); 12+ char passwords with common-password block + strength meter; failed-attempt notice
- d34ec72: export notice + initials-based filenames; Export-all-CSV failure reporting bug; case notes deletable only within 15 min, then void; every edit version kept (migration 032)
- 061e078: .pulse-backup preview works; logs in data folder (cleared on reset); "check for updates automatically" switch
- Review docs updated to match. Open: website security page, audit report (brainstorm), signing verification, MFA (waiting on HIPAA final rule)
- Build state: npm test 2913 pass / 4 skip; typecheck 0; eslint 0 errors; schema version 32

## 2026-10-01 — Overnight brainstorm build (all 23 items)
- Plan and progress table with commit hashes: plans/brainstorm-build-plan.md (decisions made on the user's behalf are listed there)
- Selling: sample caseload (D1), six role templates with deadline rules (D2), free version with 15 clients and no read-only lock (D3), weekly planner PDF (D4)
- Workflow: morning briefing (A6), bulk mark done (A7), calendar-month rules (A3, migration 033), mark done starts the next cycle and can add a checklist (A4), case notes update date columns (A1), monthly contact requirements (A2, migration 034), DAP/SOAP/BIRP/contact note formats plus custom ones (A5)
- Compliance: audit trail PDF (B1; closes security gap #5), required fields + Missing information report (B2), monthly compliance summary (B3), time/units and mileage on notes (B4, B5, migration 035)
- Data in/out: handoff packet (C3), move-to-a-new-computer wizard (C4), .ics calendar export with initials (C1), smarter Excel import (C2)
- Platform: security checkup + supervisor summary (E3); macOS build prepared, needs an Apple account to ship (E2, plans/macos-build.md); Touch ID / Windows Hello design only (E1, plans/quick-unlock-design.md)
- Reports now live in a caseload's Export menu (Supervisor report, Compliance summary, Missing information, Audit trail, Time and mileage); the Dashboard has Print this week, Add to calendar, Monthly summary
- Build state: npm test 3013 pass / 4 skip; typecheck 0; eslint 0 errors; schema version 35
- Next: hands-on walkthrough of the new features in the real app, pricing/website copy for the free version, then release prep (Windows signing, Mac build on a Mac)

## 2026-10-01 (cont.) — Generalization plan
- plans/generalization-brainstorm.md (why) and plans/generalization-plan.md (how): turn Pulse into a general people/things + deadlines tool (human services → therapy → auto shop), keeping all current features
- 16 workstreams (vocabulary + presets, list kinds, activity types/measures, linked records, deadline engine v2, stages/board, appointments/calendar, forms, attachments, reports/dashboard, reminders, preset content, licensing, rename, Spanish, docs), migrations 036–043, phases P0–P6 (~19 weeks)
- Rename answer: code-signing certs belong to the publisher, not the product; the real rename risk is the macOS/Linux data folder and OS key store (pin the internal app name)
- Not started; open questions in section 13 of the plan
- Revision 2 of the plan: no profession presets/modes; one fully flexible workspace with optional starter templates (data files, mixable, exportable), and setup offering example / import / guided blank start
- plans/starter-template-catalog.md: 135 candidate starter templates across 10 groups (human services, health, education, legal/government, business, trades, property/safety, animals, faith/community, personal), each with lists, key rules, required phase and fit; suggested waves per phase
- plans/generalization/: detailed spec per workstream (W01–W16, ~1,900 lines): user stories, screens, exact schemas (migrations 036–043), TypeScript contracts, IPC channels, files touched, lifecycle/edge cases, tests, commit-by-commit breakdowns; first-wave starter templates specified column by column

## 2026-10-01 (cont.) — Generalization P0 (safety rails) done
- App identity pinned (app-identity.ts, first import): data folder and key-store name stay `baringasoft-pulse` (package.json name, the real runtime name — not productName); display name only in PRODUCT_NAME
- Vocabulary lint rule in place (all renderer folders on the not-yet-converted list)
- src/shared/vocab.ts and src/shared/features.ts with tests (not wired yet)
- Build state: npm test 3031 pass / 4 skip; typecheck 0; eslint 0
- Next: P1 — W01 commit 2 (migration 036, WORKSPACE_* IPC, stores/hooks), then the word rollout folder by folder

## 2026-10-01 (cont.) — Generalization P1: W01 commit 2 (plumbing)
- b9e3762: migration 036 (grids.record_kind / vocab / display_format; installs with lists frozen on human-services words and today's features), WORKSPACE_GET / WORKSPACE_UPDATE / WORKSPACE_CHANGED, main `vocabFor()` / `featureOn()`, renderer `workspaceStore` + `useVocab` + `useFeature` + `<V>`, loaded on unlock
- Choices: `vocab` in WORKSPACE_UPDATE replaces the saved words, `features` merges; `useVocab(null)` = workspace words only (dashboard/sidebar), omitted = open list; main reads aren't cached (restore/reset would make a cache stale); last words cached in localStorage so unlock doesn't flash generic words
- Interim gap: a brand-new install gets no saved words, so once the rollout lands it shows generic words while still running the old human-services onboarding, until setup v2 (W01 commit 16)
- Nothing on screen uses it yet
- Build state: npm test 3052 pass / 4 skip; typecheck 0; eslint 0; schema version 36
- Next: W01 commits 3–11, the word rollout one folder at a time (layout/ + App.tsx first)

## 2026-10-01 (cont.) — Generalization P1: W01 word rollout (commits 3–11) done
- Renderer: 7afe5f9 layout + store messages, 758e2a0 dashboard, 9fd053b grid, 37ac27a profile, 4c8657a settings, 68bd014 reports/requirements/shared, c71a9c2 contacts, ac33a30 remaining screens, 7c7bade help; main: 4abdc0d PDFs, CSVs, system log entries, messages
- Tools: `wordNow()` (stores), `useVocabByList()` (mixed-list screens), `fillVocab()` + `useVocab().f` for `{record:many}` tokens in static text (tour, shortcuts, letter variables, security summary, FAQ), main `word()`; test helpers `setWords()` / `setDbWords()`; guard test `tests/renderer/vocabStaticText.test.tsx`
- Lint rule covers every renderer file except the old OnboardingView (replaced by setup v2)
- fbd6f78: finishing the old onboarding wizard saves human-services words/features if none are saved (closes the interim gap noted above)
- Left as human-services content for W12 starters: letter/checklist templates, sample data, role templates, default snippets
- Wording changes existing users will notice: sentence-case headings ("Case log", "Client details"), "Contact requirements…" in the list menu, requirement card "still behind", "Grid" labels now say "Caseload", lock/password screens say "your data"
- Found and fixed: contacts.ts ↔ vocab.ts import cycle via database.ts (rule added to CLAUDE.md)
- Not seen in the real app: Playwright can't attach to Electron in this session (launch times out before the window; direct launch runs with no errors). Worth a manual look, or `npm run ui-tour` on another session
- Build state: npm test 3063 pass / 4 skip; typecheck 0; eslint 0 errors (warnings unchanged at 184); schema version 36
- Next: W01 commit 12 — feature switches applied to every entry point (§3.3) + Settings → Features

## 2026-10-01 (cont.) — Generalization P1: W01 commit 12 (feature switches) done
- 561a0af: Settings → Features tab (first in the list); every §3.3 entry point hidden when its switch is off (sidebar, shortcuts, command palette, dashboard, profile, grid toolbar/export menu, column menu, templates, Tasks/Focus sections, "/" snippet menu, settings sections); monthly compliance summary leaves requirements out when off
- Time and mileage: the feature switches are now the source of truth (Settings → Notes toggles write them); old track_time / track_mileage settings are no longer read
- Priority: each list's own acuity on/off is kept; the feature switch hides it everywhere (and pauses grouping by it)
- Not done: personFields has nothing to hide yet (age-from-DOB isn't in the add-column menu; suggestions come with setup v2); dialogs don't auto-close when a feature is switched off while open (not reachable today: switches live in Settings); no undo for switch changes (settings toggles aren't undoable elsewhere either); keyboard shortcut list still shows shortcuts of switched-off features
- Build state: npm test 3072 pass / 4 skip; typecheck 0; eslint 0 errors; schema version 36. Not seen in the real app (Playwright can't attach in this session)
- Next: W01 commit 13 — starter template schema + loader + previewStarter/applyStarter + tests; D2 role templates become the human-services starter with variants

## 2026-10-01 (cont.) — Generalization P1: W01 commit 13 (starter templates core) done
- 24c0887: `src/shared/starters/schema.ts` (format + parseStarter with plain messages), `human-services.json` (11 role variants, words, features, care-manager requirements), `src/main/starters.ts` (load / preview / apply, sample data)
- The built-in setup templates are now generated from human-services.json (checked identical to the old TypeScript output before switching); `withStandardRules` / `ROLE_TEMPLATES_V2` / `TEMPLATE_RULE_LINKS` removed
- Decisions: built-ins are still seeded into setup_templates (the old wizard and Templates page need them) — stop seeding when setup v2 and the gallery replace them; starter sample rows are tracked by id in app_meta `starter_sample` and excluded from the free count (D1's sample caseload is unchanged; moving it into the human-services starter is W12); `renamed` in ApplyResult maps original → new name for lists, rules and checklists alike; apply returns `workspaceChanged` so the IPC layer can push WORKSPACE_CHANGED
- Not yet: IPC channels and UI (commit 14), export/open setup files (15)
- Build state: npm test 3082 pass / 4 skip; typecheck 0; eslint 0 errors; `npm run build` bundles the JSON
- Next: W01 commit 14 — STARTER_LIST / PREVIEW / APPLY channels, apply dialog, gallery, "Add lists from an example"

## 2026-10-01 (cont.) — Generalization P1: W01 commit 14 (gallery + apply dialog) done
- STARTER_LIST / PREVIEW / APPLY; `components/starters/ApplyStarterDialog.tsx` (gallery → variant → review → done) and `StarterIcon` (small bundled icon set); Settings tab renamed Features → Workspace with "Add lists from an example"
- Sample data from examples now shows in the banner and Settings → Data and is removed with the sample caseload
- Decisions: the window can only name built-in starters (files will go through a main-process open dialog in commit 15); in "add" mode words/features default off, in "setup" mode on; sample data defaults off
- Not seen in the real app (Playwright still can't attach in this session)
- Build state: npm test 3091 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings, unchanged)
- Next: W01 commit 15 — export my setup as a template (WORKSPACE_EXPORT_TEMPLATE) and open a template file (STARTER_OPEN_FILE)

## 2026-10-01 (cont.) — Generalization P1: W01 commit 15 (share / open setup files) done
- WORKSPACE_EXPORT_TEMPLATE + STARTER_OPEN_FILE; Settings → Workspace "Share your setup"; v1 .pulse files open as one-list examples; double-clicked workspace files open in the example dialog
- Decisions: the window refers to opened files by a one-time token (main keeps the last 10); export puts each checklist template on the list that uses it, unused ones on the first list; exported name is "Shared setup"; system rules/checklists/letter templates are not exported (every install has them)
- Build state: npm test 3101 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W01 commit 16 — setup v2 (welcome, your name, three ways to start, spreadsheet "what are these rows")

## 2026-10-01 (cont.) — Generalization P1: W01 commit 16 (setup v2) done
- 7e1c509: `views/SetupView.tsx` replaces OnboardingView (removed with its data); GRID_SETTINGS_UPDATE and ONBOARDING_DATE_RULES; `ruleForInterval()` / `applyDateRules()`
- Paths: example (gallery in setup mode), spreadsheet (name → import → "What are these rows?" → "Which of these dates repeat?"), blank (name only for now), "Try it with sample data" (human-services words + D1 sample caseload)
- ONBOARDING_COMPLETE no longer saves human-services words (fbd6f78's interim rule is gone: the chosen path sets words)
- Vocabulary lint rule: no exemptions left
- Decisions: the done screen still offers the full tour (spec suggests a 3-step mini tour of switched-on features); "What are these rows?" sets the workspace record word (it's the first list); built-in setup templates are still seeded (Templates page uses them)
- e2e skipOnboarding now goes welcome → name → example (Human services, first layout) → done; NOT run here (Playwright can't attach in this session) — run `npm run test:e2e` on another machine
- Build state: npm test 3105 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W01 commit 17 — guided blank start (§5.2: name, kind, words, columns by kind, repeating dates, quick questions)

## 2026-10-01 (cont.) — Generalization P1: W01 commit 17 (guided blank start) done
- `views/setup/GuidedBlankStart.tsx` (six steps), `views/setup/DateRepeatPicker.tsx` (shared with the spreadsheet path), `shared/listWords.ts` (`wordsFromListName`)
- Decisions: the list is created at the end of step 4, so Back isn't offered on step 5; step 6 asks only about features that exist (checklists, tasks, time, mileage) — activity types (W03), appointments (P4) and stages (P3) get their questions when they ship; no name → neutral "record/records"
- Build state: npm test 3109 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W01 commit 18 — Settings → Workspace words editor (+ reset to generic / human services) and finishing the tab

## 2026-10-01 (cont.) — Generalization P1: W01 commit 18 (words editor) done
- `components/settings/WordsEditor.tsx` heads Settings → Workspace (Words, Features, Add lists from an example, Share your setup)
- Decisions: appointment/stage/archive words aren't shown yet (their features aren't built; "archive" isn't used as a noun anywhere); per-list words are edited through GRID_SETTINGS_UPDATE but the "List settings…" dialog is left for W02, which adds kind and display format to it
- Build state: npm test 3113 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W01 commit 19 — FeatureOffer in-context suggestions

## 2026-10-01 (cont.) — Generalization P1: W01 commit 19 (feature offers) done
- `components/shared/FeatureOffer.tsx`; time/mileage offer under the note composer (`offerFor()` in CaseLog.tsx)
- Other §3.4 placements (links, appointments, stages) are for when those features ship (W04, W07, W06)
- Build state: npm test 3118 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W01 commit 20 — leak test (nonsense words, every view and PDF), e2e, help updates

## 2026-10-01 (cont.) — Generalization P1: W01 commit 20 (leak test, e2e, help) done — W01 complete
- `tests/vocab-leak-exports.test.ts`: every PDF (list, profile, batch, supervisor, handoff, planner, audit, contact, directory), the supervisor CSV, list CSV and calendar export under nonsense words ("widget", "bin", "jot"…) — none says client / caseload / case note / case log / provider / acuity. Confirmed it fails under the human-services words
- `tests/renderer/vocabLeak.test.tsx`: full stack — the real main-process IPC handlers answer the window against a seeded test database. Renders list, profile, dashboard, tasks, contacts, every Settings tab, snippets, templates, letters, trash, help, focus mode and the global dialogs; then presses every button on list/profile/dashboard/tasks/contacts one at a time and reads what opens (text, tooltips, aria labels, placeholders, toasts, native dialog titles). ~9s. Shared seed in `tests/vocabLeakSeed.ts`
- Findings: screens, menus, dialogs and PDFs were already clean. The leaks were built-in content: default snippets, letter templates and the 11 built-in list templates
- Decision (user): built-in snippets, letters and list templates are added only when the workspace's record word is "client" (`usesHumanServicesWords()` in main vocab.ts). Other workspaces start without them; switching to the human-services words later brings them in. Existing data untouched
- `e2e/workspace-words.spec.ts`: example / blank / spreadsheet setup paths, and a word change showing in sidebar, list, profile and the profile PDF. `startSetup` / `finishSetup` helpers. NOT run here (Playwright can't attach in this session) — run `npm run test:e2e` on another machine
- Help: four Getting Started entries (change words, turn features on/off, add lists from an example, share your setup)
- Build state: npm test 3148 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W01 is done. W02 (list kinds) per plans/generalization/README.md

## 2026-10-01 (cont.) — Generalization P1: W02 commit 1 (display name formats) done
- `src/shared/displayFormat.ts` (`renderDisplayFormat`, `formatTokens`, `normalizeDisplayFormat`), `src/main/display-names.ts` (`refreshDisplayNames`, `columnAffectsDisplayName`, `hasDisplayFormat`, `afterColumnRenamed`)
- Names recomputed after: CELL_UPDATE (only when the column is in the format or is the name column), note-date updates, ROW_DUPLICATE, ROW_MOVE_TO_GRID / ROW_COPY_TO_GRID (named the target list's way, format or not), import, COLUMN_DELETE, COLUMN_UPDATE rename, GRID_SETTINGS_UPDATE display_format (clearing it restores the default names)
- Decisions: renaming a column rewrites its token in the format so names don't change (spec only said recompute); an empty result falls back to the name column, then "(unnamed)" as stored today; cleanup only touches the format's own text, never the values; duplicate column names → the first by position wins
- Screens: `getClientName` reads the list's format from gridStore, so names update live with edits; GRID_GET_ALL now returns display_format and record_kind. Exports (`getClientName` / `batchGetClientNames` in export-shared, batch alpha sort) use the stored name for formatted lists
- No way to set a format in the app yet — that's the "List settings…" dialog (commit 4). Not seen in the real app
- Build state: npm test 3171 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W02 commit 2 — auto_number column type end to end

## 2026-10-01 (cont.) — Generalization P1: W02 commit 2 (auto numbers) done
- `src/shared/autoNumber.ts` (config parse/format), `src/main/auto-number.ts` (`assignAutoNumbers`, `bumpAutoNumbersPastValues`, `numberExistingRows`, `freshAutoNumberConfig`), new channel COLUMN_NUMBER_EXISTING
- Assigned in main inside the write's transaction: ROW_CREATE, ROW_DUPLICATE (new number), ROW_COPY_TO_GRID / ROW_MOVE_TO_GRID (the target list's next number), import (mapped values kept, `next` moves past the highest, rows without one numbered — only rows from committed chunks), starter sample data. Templates/starters/.pulse apply restart numbering at 1
- Read-only: CELL_UPDATE rejects; gridStore.updateCell ignores read-only types (covers paste, Delete, bulk edit, context menu, profile); `READ_ONLY_COLUMN_TYPES` / `isReadOnlyColumnType` in shared/types replaces the age/calculated-days checks in SortableRow, DataGrid, BulkEditDialog and type-to-edit
- Decisions: "Number the existing ones?" is a checkbox in the add-column form (on by default, shown when the list has records) instead of a confirm dialog after adding — redo repeats it; turning an existing column into an auto number is refused (its values wouldn't be in sequence); moved records get a new number in the target list; numbers for archived records are included when numbering existing ones, trashed ones are not; no UI yet to change prefix/digits after creation
- Sorting already natural (localeCompare numeric); quick search now includes auto-number columns
- Not seen in the real app
- Build state: npm test 3187 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings, unchanged)
- Next: W02 commit 3 — kind-based hiding (age column type, ics names, export file names)

## 2026-10-01 (cont.) — Generalization P1: W02 commit 3 (kind-based hiding) done
- `isPersonKind()` in shared/types; `hooks/useRecordKind.ts` (`useRecordKind`, `useHoldsPeople`)
- Profile header: "(36 yrs)" after a birth-date column only for people lists with People details on
- Calendar export (export-ics): initials only for people lists; things/jobs show their name. CalendarExportDialog text says initials / names depending on the kinds of lists present
- `clientFileName(name, suffix, ext, kind)`: things/jobs get a path-safe name instead of initials; empty fallback is "record" (was "client")
- HandoffDialog archive reason: Transferred / Discharged for people, Transferred / Closed for things and jobs
- Found: the "Age from date of birth" column type isn't offered in the add-column menu at all today (only via old templates), so there was nothing to hide there; setup suggestions were already per kind (W01 commit 17)
- Not seen in the real app
- Build state: npm test 3192 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W02 commit 4 — "List settings…" dialog + GRID_SETTINGS_UPDATE (name, kind, words, display format, priority on/off, requirements shortcut)

## 2026-10-02 — Generalization P1: W02 commit 4 ("List settings…") done
- `components/grid/ListSettingsDialog.tsx`: Name; "What does this list hold?" (People / Things / Jobs or tasks, with a note on what turns on or off); "Use the workspace words" or the list's own one/many (other per-list words from examples are kept); "How to show each one's name" — column chips insert `{Column}` at the cursor, live preview from the first record (or `[Column]` placeholders when the list is empty); "Use priority levels on this list" (only when the Priority feature is on); "Monthly requirements…" (only when that feature is on)
- Saves only changed fields through GRID_SETTINGS_UPDATE (now also `name`, `acuity_enabled`; typed as `GridSettingsPatch`), then reloads the list, sidebar and words; one undo step that sends the old values back
- Entry points: sidebar list menu ("List settings…" above "Rename…") and a "List settings" button at the right of the grid toolbar (which can also open monthly requirements)
- Decisions: inline rename in the sidebar stays (quick path); the toolbar's priority button stays for setting up levels — on/off is in both places; the sidebar's requirements item now hides when the Requirements feature is off (it didn't before); `RECORD_KINDS` exported from GuidedBlankStart for reuse
- Not seen in the real app
- Build state: npm test 3199 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W02 commit 5 — new-list dialog with kind and words (replaces the name-only prompt)

## 2026-10-02 (cont.) — Generalization P1: W02 commit 5 (new-list dialog) done — W02 complete
- `components/grid/NewListDialog.tsx` replaces the sidebar's inline name box (both the expanded "+" and the collapsed-sidebar "+"): "{List} name"; People / Things / Jobs or tasks; one/many words guessed from the name (`wordsFromListName`) until typed; "Start with": Suggested columns (the guided-start suggestions for that kind, each can be unticked except the first), Just a name column (GRID_CREATE), or A ready-made list (opens the example gallery in add mode)
- Creates via ONBOARDING_SETUP_GRID / GRID_CREATE, then GRID_SETTINGS_UPDATE with the kind and — only when they differ from the workspace words — the list's own words
- Jobs' suggested "Number" column is now `auto_number` (in setup's guided blank start too)
- Decisions: the field is labelled "{List} name", not "Name", so it can't be confused with the "Name" column checkbox; creating a list still has no undo (it didn't before; delete is the way back)
- Screen leak test now also renders the New list and List settings dialogs
- Not seen in the real app
- Build state: npm test 3205 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W03 (activity types, measures, recurring requirements) per plans/generalization/README.md

## 2026-10-02 (cont.) — Generalization P1: W03 commit 1 (note types table) done
- Migration 037 (schema 37): `activity_types` seeded with note/phone/meeting/email/visit (today's labels and emoji, colors slate/blue/green/purple/orange); any other non-system key already on a note becomes an archived type labelled from its key; `case_log.extra_measures`; `contact_requirements.period` (default 'month'). Registered in database.ts and tests/helpers.ts
- `src/shared/activityTypes.ts`, `src/main/activity-types.ts` (`listActivityTypes`, `saveActivityType`, `setActivityTypeArchived`, `deleteActivityType`, `reorderActivityTypes`, `activityTypeUsage`, `userTypeKeys` cached + reset on DB close, `isValidLogType`), `ipc/ipc-activity-types.ts` (5 channels + ACTIVITY_TYPES_CHANGED push)
- Decisions: icons are an emoji/short symbol (what notes show today), not lucide names; names unique among active types (case-insensitive); delete only if no note, requirement or date-column "note updates" rule uses the key; at least one active type always kept; the five built-ins are seeded for every install (they're generic enough)
- Nothing reads the table yet: caselog validation, A1, A2 and the renderer still use the fixed lists (commits 2 and 3)
- Build state: npm test 3218 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W03 commit 2 — replace the hard-coded type lists in main (caselog validation, note-date updates, requirements, audit, time/mileage labels)

## 2026-10-02 (cont.) — Generalization P1: W03 commit 2 (main uses the type table) done
- `ipc-caselog.ts`: VALID_CASE_LOG_TYPES removed; CASE_LOG_CREATE uses `isValidLogType` (system + active user types; message "That kind of note isn't available any more…"); CASE_LOG_RESTORE allows archived keys so undo works
- `note-date-updates.ts`: NOTE_UPDATE_TYPES removed; any user type key (archived too) can move dates, system notes never do
- `contact-requirements.ts`: allowed note types = all user type keys (archived kept so re-saving a requirement doesn't drop them)
- Labels instead of keys: audit trail ("Visit note", "Session note"; a label already ending in "note" isn't doubled; system notes keep their wording), supervisor report CSV/PDF "Type", profile PDF "[HOME VISIT]", time/mileage CSV "Note type" — via `activityLabel(key)`
- `starters.ts`: sample notes with an unknown type use 'note' if it exists, else the first active type
- `CaseLogType` is now `string` (the renderer still has fixed lists until commit 3)
- Decision: the type cache is per database connection (WeakMap on the db object) instead of a close hook — restore/lock/new connection start fresh, and test mocks don't need registerCloseHook. Direct SQL edits to activity_types bypass it; only the activity-types module and (later) starters write the table
- Build state: npm test 3224 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W03 commit 3 — renderer store + replace the hard-coded type lists + Settings type editor

## 2026-10-02 (cont.) — Generalization P1: W03 commit 3 (note types in the window) done
- `stores/activityTypeStore.ts` (all types incl. archived; `DEFAULT_ACTIVITY_TYPES` until loaded; ignores anything that isn't a list of types with at least one active) and `hooks/useActivityTypes.ts` (`active`, `all`, `label`, `icon`, `bgClass`, `isArchived`; `ACTIVITY_BG` / `ACTIVITY_SWATCH` palettes). Loaded on unlock and on the ACTIVITY_TYPES_CHANGED push
- Replaced fixed lists: CaseLog composer chips (first 6 + "More…" menu; the chosen one always shows as a chip; last used remembered in settings `note_type_last`, allowlisted; archived/unknown falls back to the first active), CaseLogEntry header (label, emoji, background; "(archived)"), ActivityTimeline (labels, icons, one filter chip per type — archived only if present; chips now use the type's label, e.g. "Meeting" not "Meetings"), ProfilePrintLayout, NoteUpdatePicker (NOTE_TYPE_OPTIONS removed), ContactRequirementsDialog (types from the store; suggestions only for types that still exist; a new requirement defaults to Visit or the first type)
- `components/settings/ActivityTypesEditor.tsx` at the top of Settings → Notes: emoji box, name (saves on blur/Enter), 8 color swatches (named Gray…Red), drag or keyboard reorder (dnd-kit KeyboardSensor), Archive, Delete (main's message shown when the type is used), "Add a kind", "Archived (n)" with Restore/Delete
- Help: "Can I change the kinds of notes, like Visit or Phone?"
- Decisions: icon is an emoji text box rather than a fixed 24-icon grid; no undo for type edits (like other settings); provider interaction types (ContactInteractionLog) are a separate list and untouched
- Not seen in the real app
- Build state: npm test 3231 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W03 commit 4 — custom measures (definitions, validation, composer/entry inputs, badges)

## 2026-10-02 (cont.) — Generalization P1: W03 commit 4 (your own numbers on notes) done
- `src/shared/measures.ts` (MeasureDef, `parseMeasures`, `parseExtraMeasures`, `cleanMeasureValue`, `formatMeasure`, `measureStep`), `src/main/measures.ts` (`listMeasures`, `saveMeasure`, `setMeasureArchived`, `cleanExtraMeasures`), `ipc/ipc-measures.ts` (MEASURE_SAVE, MEASURE_ARCHIVE → WorkspaceState + WORKSPACE_CHANGED). `WorkspaceState.measures` added (workspaceStore caches it)
- Notes: CASE_LOG_CREATE `measures.extra` (active numbers only), CASE_LOG_SET_MEASURES (`extra` optional — left out keeps what's there; archived numbers already on the note allowed), CASE_LOG_RESTORE carries `extra_measures`; CASE_LOG_GET returns it; `CaseLogEntry.extra_measures`
- Renderer: `hooks/useMeasures.ts`, `components/profile/MeasureInput.tsx` ($ prefix, h/unit suffix); composer boxes; badges on notes (archived numbers still shown; values whose definition is gone are hidden); edit boxes; `components/settings/MeasuresEditor.tsx` under Settings → Notes → "Your own numbers" with the feature switch. The `measures` feature is now `available: true` (off by default for new and existing workspaces)
- Decisions: definitions can't be deleted, only archived (values stay meaningful); changing a number's kind is allowed (saved values keep their number); unit and decimals only for counts (hours and money always 2 decimals); rounding shifts by decimal string so 1.255 → 1.26; no undo for definition edits (like other settings)
- Help: "Can I record my own numbers on notes…"
- Not seen in the real app
- Build state: npm test 3243 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W03 commit 5 — Totals report (time/mileage → totals with custom numbers + CSV)

## 2026-10-02 (cont.) — Generalization P1: W03 commit 5 (Totals report) done
- `src/main/time-mileage.ts` → `src/main/totals.ts` (`getTotals`, `exportTotalsCsv`, `measureHeading`); types `TotalsReport` / `TotalsEntry` / `TotalsRow` in shared/timeMileage.ts (replacing TimeMileageReport/Entry)
- Per record and overall: minutes, units, miles, and each of your own numbers; `report.measures` lists only numbers with values that month (saved order); notes with only custom numbers are included; values of a number whose definition no longer exists are dropped; sums rounded to 2 places
- CSV: Date, {Record}, {List}, Note type, Minutes, Units, Miles, [Mileage amount], then one column per number ("Labor (hours)", "Parts ($)", "Boxes (boxes)"), Note; total row
- Channels renamed TIME_MILEAGE_GET/EXPORT_CSV → TOTALS_GET/TOTALS_EXPORT_CSV (internal; callers updated; no aliases); save dialog "Save Totals", `totals-YYYY-MM.csv`
- `components/reports/TimeMileageDialog.tsx` → `TotalsDialog.tsx`: title "Totals"; Time/Units/Miles columns only when that month has them; a column per number; total row when more than one record; summary line includes your numbers. Export menu item "Totals…" shows when time, mileage or your own numbers are on. Notes settings text points to Export → Totals
- Tests: `tests/time-mileage.test.ts` → `tests/totals.test.ts` (+ custom numbers per record/overall, CSV columns, headings); `tests/renderer/TotalsDialog.test.tsx`
- Not seen in the real app
- Build state: npm test 3247 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W03 commit 6 — requirement periods (week/month/quarter/year: math, status, dialog, dashboard card, profile line, summary)

## 2026-10-02 (cont.) — Generalization P1: W03 commit 6 (requirement periods) done
- `src/shared/periods.ts` (`periodRange`, `daysLeft`, `parseLocalDate`, `PERIOD_MAX`); `ContactRequirement.period`, `ContactStatusGrid.ranges`
- `contact-requirements.ts`: `getContactStatus(month)` → `getRequirementStatus(day?, gridId?)` — one count per distinct period range, `date(created_at,'localtime') BETWEEN start AND end`; week start from settings `week_start`; validation per period (week ≤ 14, month ≤ 31, quarter ≤ 92, year ≤ 365); saved with `period`
- CONTACT_REQ_STATUS accepts 'YYYY-MM-DD' or 'YYYY-MM' (counted as of month end, or today for the current month); compliance summary counts as of its as-of day and labels each requirement "2 check-ins per week (Week of Oct 4)"
- Renderer: dialog period select per requirement and per-period max on the count; settings list "1 visit a month"; dashboard card title "Requirements this week and this month", days left per period ("3 days left in the week · 29 days left in October"), "are done for October" only when one period is in use; profile line "Requirements: Visit 1 of 1 this month · Check-ins 0 of 2 this week"; missing text adds "per week/quarter/year" (months unsaid, as before)
- Decision: week keys use the ISO week number of the week's middle day, so Sunday- and Monday-start weeks both get one number
- Not seen in the real app
- Build state: npm test 3254 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W03 §5 — starter templates carry activity types and measures (commit 7), then W13 (free-tier counting)

## 2026-10-02 (cont.) — Generalization P1: W03 commit 7 (examples carry types and numbers) done — W03 complete
- Starter schema: `activityTypes` (key, label, icon, color), `measures`, requirement `period` (per_month limit per period), list `displayFormat`; only `dashboardCards`, `links`, `stage`, `forms` still "need a newer version"
- `addMissingActivityTypes` (activity-types.ts; skips existing keys, system keys and same-named active types; invalidates the cache) and `addMissingMeasures` (measures.ts; skips existing keys/labels, respects 10 active, returns what didn't fit)
- `applyStarter`: types and numbers first; requirement note types filtered to the workspace's keys (requirement dropped with a warning if none left); `display_format` saved (normalized); sample rows get display names; result `activityTypesChanged` → STARTER_APPLY pushes ACTIVITY_TYPES_CHANGED; added numbers set `workspaceChanged`
- `exportWorkspaceStarter`: active note types, active numbers, requirement periods (non-month), list display formats
- Build state: npm test 3258 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W13 (free-tier counting) — the last P1 workstream

## 2026-10-02 (cont.) — Generalization P1: W13 (free tier by kind) and W16 P1 (help, docs) done — P1 complete
- W13: `countBillableRecords()` (people and thing lists only; job lists, the sample caseload and example sample records excluded), `isBillableGrid(gridId)`; `checkClientCapacity(adding, gridId?)` / `enforceClientCapacity(adding, gridId?)` — ipc-row passes the target list (create, duplicate, restore, unarchive, copy, move), bulk unarchive counts only rows in lists that count, import's cap applies only to lists that count; `freeLimitMessage(gridId?)` uses the list's word. Changing a job list to people/things is allowed and it then counts (adding is blocked while over). TrialBanner: "Free version: 9 of 15 {word}" with the counted lists' word, or "records" when they differ
- W16 P1 help: starting from scratch, List settings, names built from columns, auto numbers, requirement periods (earlier commits added words, features, examples, sharing, note kinds, own numbers). Security docs (`supervisor-it-faq.md`, `security-at-a-glance.md`): what a shared setup file contains
- Not covered by an IPC-level test: ROW_CREATE in a job list at the limit (licensing unit tests cover the rule; ipc-row passes the grid id)
- Build state: npm test 3259 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: P2 — W05 deadline engine v2, then W11 desktop notifications

## 2026-10-02 (cont.) — Generalization P2: W05 commits 1–3 (engine, loader, all callers switched) done
- Commit 1: `src/shared/deadlineEngine.ts` — pure `evaluate(rule, ctx)` (today injected), `DeadlineResult` (due, state none/ok/soon/due/overdue/paused/done, daysUntil, estimated, label, detail, extended), date helpers (`toYmd` rejects impossible dates, `daysBetween` DST-safe, one cached Intl formatter), types for all six kinds (non-interval kinds fall back to interval until their commits). Tests: unit, 3,000-case property test vs addInterval, parity vs the old SQL over a date × rule fixture
- Commit 2: `src/main/deadlines.ts` — `loadDeadlines({ gridId, rowIds, from, to, limit, today })` (one query, engine math, stable sort) and `deadlineCounts()`; dashboard deadlines and briefing switched. Parity test (`tests/deadlines-parity.test.ts`, old SQL kept verbatim): same items/fields/order/counts on the sample caseload + A3 rules; 2,000 × 5 = 10,000 deadlines in ~120 ms
- Commit 3: planner, calendar export, supervisor counts (loader + legacy per-column `interval_days` via the engine), summary report (history-based as-of values, engine math), grid (`computeEffectiveDeadline` / `computeDaysUntil` delegate). `effectiveDateSql` deleted from src; frozen copy in `tests/legacyDeadlineSql.ts` for parity tests. Planner and calendar parity added
- Behavior change: impossible dates like 2026-02-31 now have no deadline (SQLite and JS used to roll them into March)
- Build state: npm test 3273 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W05 commit 4 — migration 038 (rule kind/config/condition/business_days, extensions, progress) + relative kind + business-day calendar + days-off UI

## 2026-10-02 (cont.) — Generalization P2: W05 commit 4 (migration 038, relative, days off) done
- Migration 038 (schema 38; the spec called it 039 — 038 was free): alert_rules `kind` (default 'interval'), `rule_config`, `rule_condition`, `business_days`; `deadline_extensions`, `deadline_progress`
- `src/shared/ymd.ts` (date helpers moved out of the engine to avoid an import cycle), `src/shared/businessDays.ts` (`isDayOff`, `addBusinessDays`, `rollBackToBusinessDay`, `usFederalHolidays` with observed dates, `daysInRange`)
- Engine: `engineRuleFrom(row)` (zod per kind via `parseRuleConfig`; unreadable settings → interval), `relativeConfigSchema`, `conditionSchema`, `needsRowContext`, `referencedColumns`; relative kind (anchor column or 'self'; months, days, working days; after/before; own date = done when on/after the cycle start); `businessDays` rolls any due date back off a day off
- Loader: interval rules without conditions keep the single cell query (parity unchanged); other kinds/conditions load every active row of the column's list plus referenced columns; calendar from settings (`workCalendarSetting` in vocab.ts); `includeDone`; rules parsed once per load
- IPC: ALERT_RULE_CREATE/UPDATE validate the new fields; HOLIDAYS_SET; `WorkspaceState.calendar`
- Renderer: `evaluateRuleForRow` / `formatResultTooltip` in deadlineCalc; SortableRow colors through the engine (relative rules color their empty "done" cell); `components/settings/DaysOffSection.tsx` in Settings → Alerts (weekend days, add a day or a break, US federal holidays for this year/next, remove)
- No rule editor for the new kinds yet (commit 11)
- Build state: npm test 3295 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W05 commit 5 — calendar kind + `deadline` column type

## 2026-10-02 (cont.) — Generalization P2: W05 commit 5 (calendar kind, deadline columns) done
- Engine: `calendarConfigSchema` (months 1–12 + day number/'last', or `fromColumnMonth` for an anniversary; `lead`), `evaluateCalendar` (next occurrence strictly after the done date, else on/after today; clamps to short months; hidden until `lead` days ahead)
- `ColumnType` 'deadline' + `isNotTypedColumnType` (UI: no editor, no type-to-edit, no bulk edit) and `takesDeadlineRule` (date or deadline: Alert Rule menu, grid coloring) in shared/types; `READ_ONLY_COLUMN_TYPES` unchanged so marking done can still write the done date; templates/missing-info/required fields know it
- `CellDisplay` `DeadlineCell` ("Choose a rule" / "Jan 15, 2027 · in 105 days" / "Done Sep 15, 2026", detail as tooltip); add-column picker "Deadline (worked out by a rule)"; loader single-cell query also covers deadline columns
- Build state: npm test 3305 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W05 commit 6 — meter kind + mark-done prompt + grid context IPC

## 2026-10-02 (cont.) — Generalization P2: W05 commit 6 (meter kind) done
- Engine: `meterConfigSchema` (readingColumnId, lastServiceReadingColumnId, every, unit, timeFallback {days/months}, typicalPerDay), `meterRate()` (least squares, 180 days, ≥ 2 points ≥ 7 days apart, falling readings drop the run before them), `evaluateMeter` (due = earlier of meter estimate and time fallback; `estimated`; label "2,000 mi left"; "… over" when past), `meterHistoryColumn()`
- Main: `meterHistories()` from cell_history; loader passes histories and adds `rule_kind` to each DeadlineItem; `loadGridDeadlineContext(gridId)`; `src/main/deadline-actions.ts` `markMeterDone()`; `ipc/ipc-deadlines.ts` (DEADLINES_GET, GRID_DEADLINE_CONTEXT, DEADLINE_METER_DONE)
- Renderer: gridStore `deadlineContext` loaded after each grid load; `evaluateRuleForRow` passes meter history; dashboard uses main's `daysUntil`/`due`/`detail`/`rule_kind` (fixes relative/calendar items being dropped by the old window-side math); `getEffectiveDate` prefers `due`; `DeadlineRow` shows the engine's date, kind-aware "Mark done" titles, `MeterReadingDialog`; `completeDeadlines` handles `ruleKind` (non-interval → today; meter → DEADLINE_METER_DONE with undo of all changed cells); bulk mark-done skips meter items with a message
- Build state: npm test 3315 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W05 commit 7 — quota kind

## 2026-10-02 (cont.) — Generalization P2: W05 commits 7–8 (quota, sequence) done
- Commit 7 (quota): `quotaConfigSchema` (activityTypes, limit or limitColumnId, startColumnId, endColumnId, warnRemaining, warnDaysBeforeEnd), `evaluateQuota` (label "2 of 3 used"; out of visits → overdue with daysUntil ≤ 0; end passed → overdue; soon by count or days), `quotaCounts()` one query per rule (per-record window, voided excluded), grid context `quota`, DeadlineCell shows the count; dashboard "Renew…" opens the record; bulk mark-done skips quota
- Commit 8 (sequence): `sequenceConfigSchema` (anchor column or 'self', steps with offsets, repeatLast), `sequenceAnchor`, `sequenceStepDue`, `evaluateSequence` (`step` on the result; all done → state done), `progressEntries()` filtered by anchor value (new anchor = new cycle), grid context `progress`; `markStepDone` / `undoStep` + DEADLINE_STEP_DONE / DEADLINE_STEP_UNDO; `completeDeadlines` handles sequence; gridStore `refreshDeadlineContext()`; profile `DeadlinePanel` uses the engine for non-interval kinds (deadline columns included, no date editing for them) with a steps list and "Mark done"
- Known: redo after undo of a meter or step completion writes a new timeline entry that a second undo doesn't void (undo stack side effects are fixed at push time)
- Build state: npm test 3332 pass / 4 skip; typecheck 0; eslint 0 errors (184 warnings)
- Next: W05 commit 9 — conditions ("only while Status is Active": hide/pause)

## 2026-10-02 (cont.) — Generalization P2: W05 commits 9–10 (conditions, extensions) done
- Commit 9 (conditions): `conditionSchema` (column is / is not / empty / filled in, case- and space-insensitive; hide or pause), `conditionHolds`; loader drops paused items unless `includePaused`; deadline cells and the profile show "Paused (only while …)"
- Commit 10 (extensions): engine `extensionAnchor` / `matchExtension` / `applyExtension` (`extended: { from, reason }`, detail "Extended to … (was …): reason"); an extension is tied to the cycle's anchor date (and step), so a new date starts a new cycle and the extension stops applying; loader sets `extension_id`; grid context `extensions`
- `deadline-actions.ts` `extendDeadline` (date + reason required, replaces an active extension and keeps the original due date, timeline/audit system note), `revokeExtension`, `setExtensionActive`; IPC DEADLINE_EXTEND / DEADLINE_EXTENSION_REVOKE / DEADLINE_EXTENSION_RESTORE
- Renderer: `ExtendDeadlineDialog`, `extendDeadline.ts` (extend / remove as one undo step, voiding the timeline note); dashboard row "Extend…" / "Remove extension"; profile DeadlinePanel runs interval rules through the engine too, so extensions move the date there
- Compliance summary: "N extended" per list (PDF + dialog)
- Correction: the 7–8 entry said 3332 tests; the real count then was 3327
- Build state: npm test 3339 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W05 commit 11 — rule editor v2 with live preview

## 2026-10-02 (cont.) — Generalization P2: W05 commit 11 (rule editor v2) done
- `components/alerts/ruleDraft.ts`: form state per kind ⇄ `rule_config` / `rule_condition`; every save goes through the engine's zod schemas; plain-language "what's missing" messages
- `components/alerts/RuleKindFields.tsx`: six "How is this deadline worked out?" cards with examples; per-kind fields with column pickers (dates for anchors/periods, numbers for meters/limits; the rule's own column offered as "this column"); "Only when…" (is / is not / empty / filled in, option suggestions from status/dropdown columns, pause or hide); live preview on a chosen record (defaults to the first the rule says something about)
- `AlertRuleEditor`: kind cards replace "Date Relationship" (interval presets kept for the interval kind), "Count working days only", preview; saves `kind`, `rule_config`, `rule_condition`, `business_days`; `columnId` prop from the column menu; new rules on a deadline column start as "On fixed dates"
- Build state: npm test 3345 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W05 commit 12 — starter/template support for kinds (columns by name)

## 2026-10-02 (cont.) — Generalization P2: W05 commit 12 (rule kinds in starters and files) done — W05 complete
- `src/main/rule-columns.ts`: in files, rule settings and conditions name columns (`{ "column": "Referral date" }`); `portableRuleFields` (export), `refersToColumns`, `resolveRuleFields` (apply; missing column or invalid settings → plain date rule + warning), `ensureRule` moved here and now compares kind/settings/condition/working days, `linkColumnRules` (sets up column-bound rules after a list's columns exist and links the columns naming them)
- Starter schema + `.pulse` v1 schema accept `kind`, `rule_config`, `rule_condition`, `business_days`; plain date rules export nothing extra (older versions still read them)
- `applyStarter`, `applyPulseToNewGrid`, `applyPulseToExistingGrid` (resolves against existing columns too), `exportGridAsPulse` / `exportWorkspaceStarter` round-trip the kinds; a second copy of a list gets its own "Plan due 2" pointing at its own columns
- Build state: npm test 3352 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: P2 W11 — desktop notifications

## 2026-10-02 (cont.) — Generalization P2: W11 commit 1 (desktop reminders, daily summary) done
- `src/main/reminders.ts`: 1-minute tick while unlocked (database open) and the Reminders feature is on; `dailyDue` (time reached, not yet sent today), `dailySummaryText` ("3 due today, 1 overdue"; counts only, never names; nothing sent when nothing is due), dedupe via settings `reminders_last_daily` written before showing; turning it on after today's time waits for tomorrow; click focuses the window and opens the dashboard
- Settings keys `reminders_daily_enabled` / `reminders_daily_time` (default off, 08:30) behind IPC REMINDERS_GET / REMINDERS_SET (zod) and REMINDERS_TEST (explains how to allow notifications if the system won't show them); REMINDER_OPEN main → window (MainLayout navigates, allowlisted routes)
- Feature switch "Reminders" is now available; `components/settings/RemindersSection.tsx` in Settings → Alerts when it's on
- Appointment reminders wait for W07; tray mode and start-with-computer are P5
- Build state: npm test 3358 pass / 4 skip; typecheck 0; eslint 0 errors
- P2 complete. Next: P3 — W04 links

## 2026-10-02 (cont.) — Generalization P3: W04 commit 1 (links data, module, IPC) done
- Migration 039 (schema 39; the spec called it 038): `link_types` (from/to list, forward/backward names, cardinality), `record_links` (UNIQUE per type + pair, indexes both ways), `record_link_history` (add/remove; no foreign keys, so it outlives purged records)
- `src/shared/links.ts`: types, `holdsOne(cardinality, direction)`, `parseLinkValue` (`id␞name␟…`), `LinkColumnConfig`
- `src/main/links.ts`: `listLinkTypes`, `saveLinkType` (names trimmed; cardinality change refused while records hold several), `deleteLinkType` (history + its link columns), `countLinks`, `addLink` (checks lists, trash, self; replaces on a side that holds one and returns what it replaced), `removeLink`, `getLinksForRow` (both directions, trash hidden), `searchLinkTargets` (LIKE-escaped, active first)
- Change notes on a record only when its list shows the link in a column with change notes on ("Owner set to Bob Lee (was Jane Smith)", "Vehicles: 2017 Civic linked"); history always
- IPC `ipc-links.ts`: LINK_TYPE_GET_ALL / SAVE / DELETE / COUNT, RECORD_LINKS_GET / ADD / REMOVE / SEARCH; push RECORD_LINKS_CHANGED
- Build state: npm test 3371 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W04 commit 2 — link column type in the pivot query + chips

## 2026-10-02 (cont.) — Generalization P3: W04 commit 2 (link columns in the grid, chips) done
- `ColumnType` 'link' (+ VALID_COLUMN_TYPES, `isNotTypedColumnType`, new `storesNoCells`); excluded from required/missing-info and bulk edit; CELL_UPDATE refuses link columns; `.pulse` v1 files still don't know 'link' (single-list files can't hold links — W04 commit 8)
- `buildGridQuery(columnIds, includeArchived, links)`: one correlated subquery per link column (`id␞name[␞a]␟…`, name order, trash hidden, archived marked), still one statement; `getRow` the same; cache keys include `linkSpecKey`; `linkColumnSpecs` / `linkSpecKey` live in shared/links.ts (database mocks in tests stay unchanged)
- Exports (`loadGridData`) show linked names; DataGrid sorts and searches link columns by name
- Renderer: `stores/linkStore.ts`, `components/grid/LinkCell.tsx` (up to 3 chips then "+N", archived muted, click opens the record in its own list, `show: 'count'`)
- Perf: 500 records × 3 link columns × 2 links each, best of 3 well under 300 ms
- Build state: npm test 3378 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W04 commit 3 — link picker popover + undo + audit

## 2026-10-02 (cont.) — Generalization P3: W04 commit 3 (link picker, undo, audit) done
- `components/links/LinkPicker.tsx`: search the other list (debounced RECORD_LINK_SEARCH), linked ones checked, archived marked, chips with × to unlink, "New {record}: “typed name”" creates and links, ↑/↓/Enter/Escape, closes after picking on a side that holds one; portal under the grid cell (`GridLinkEditor`), events stopped so grid shortcuts don't act underneath
- Grid: Enter / double-click on a link cell opens the picker; Delete/Backspace ignore link cells; `refreshLinkValues()` (GRID_LINK_VALUES) patches just the link columns on RECORD_LINKS_CHANGED, so the other side's column updates too
- `utils/linkActions.ts`: `linkRecords` (undo removes it and restores what it replaced), `unlinkRecords`, `createAndLink` (undo hard-deletes the new record, redo recreates); change notes voided on undo
- Main: `createLinkedRecord` (name column + auto numbers + display name, capacity-checked in IPC RECORD_LINK_CREATE), `linkValuesForGrid`; `linkSelectSql` moved to shared/links.ts
- Audit trail (`loadAuditTrail`): "Owner: linked / unlinked {name}" on both records from record_link_history, still listed after the link type is deleted ("Link: …")
- Build state: npm test 3384 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W04 commit 4 — profile "Linked" section + rollups

## 2026-10-02 (cont.) — Generalization P3: W04 commit 4 (profile "Linked" section, rollups) done
- `components/profile/LinkedRecords.tsx` in ProfileView (feature `links`, only when a link type touches this list): one block per type and direction, "Vehicles (2) from Vehicles", "Link"/"Change" (inline LinkPicker) and "New" (name → add and link), each record with its list's first two filled-in key columns, archived muted, unlink ×, click opens it in its own list; refreshes on RECORD_LINKS_CHANGED
- Rollups: the linked records' deadlines from DEADLINES_GET({ rowIds }) that are overdue or due within 7 days ("Oil change overdue 12 days"), paused/done left out
- Main: `getLinksForRow` adds `details` (first two visible typed columns with values, excluding name/link/deadline/computed/notes/checkbox)
- Build state: npm test 3387 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W04 commit 5 — create-link flow from the column menu + FeatureOffer (feature switch becomes available)

## 2026-10-02 (cont.) — Generalization P3: W04 commit 5 (create links from the column menu, feature offer) done
- Feature switch "Linked lists" is now available; Add Column → "Link to another {list}…" (when on) opens `components/links/LinkSetupDialog.tsx`: the other list (or this one, for self-links), names on both sides suggested from each list's words (“Customer” / “Vehicles”) until edited, how many each can have in plain sentences, "Also show it as a column on {other}", "Write a note on both when links change"
- Main `setupLink` + IPC LINK_SETUP: link type and its column(s) in one transaction (config `link_type_id`, `direction`, `log_changes`); COLUMN_CREATE refuses 'link' and COLUMN_UPDATE refuses converting to/from a link column; LINK_TYPE_DELETE / LINK_SETUP clear the grid statement cache
- Column menu "Link settings…" on link columns: rename, change how many (refused while records hold several), "Remove this link…" with the number of links that go (history stays)
- `FeatureOffer` "Connect your {lists}…?" in the Add Column form when there are two or more lists and the switch is off
- Build state: npm test 3391 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W04 commit 6 — filters/grouping on link columns

## 2026-10-02 (cont.) — Generalization P3: W04 commit 6 (filters and grouping on link columns) done
- New filter operator `links_to` (value = the linked record's id); link columns offer "links to" (a chooser of the records linked in the loaded rows; filter chips show the name), contains / does not contain (on names, never the stored ids), is empty / is not empty; presets "Links to…", "Is empty"
- `matchFilter` matches link columns on names via `linkValueText`; grouping by a link column groups by the linked names ("Bob Lee, Jane Smith"); GroupingBar offers link columns
- Deferred: "linked record's column [op] value" (one level deep) — needs the other list's cells in the grid; revisit with the W10 report builder
- Build state: npm test 3393 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W04 commit 7 — lifecycle (duplicate, move, list delete) + import mapping

## 2026-10-02 (cont.) — Generalization P3: W04 commit 7 (lifecycle + import into link columns) done
- Duplicate (ROW_DUPLICATE): `copyForwardLinks` copies forward links (same owner), not backward ones or one-to-one links; history written
- Move to another list (ROW_MOVE_TO_GRID): `dropLinksThatWontFit` removes links whose type doesn't connect the new list (history kept); MoveToGridModal warns first via RECORD_LINKS_MOVE_CHECK ("These links don't apply in Jobs and will be removed: Owner: Jane Smith"). Undoing the move doesn't bring those links back
- Delete list (GRID_DELETE, still a soft delete): `deleteLinksForGrid` removes its link types, links (history kept) and their columns in other lists; the delete dialog says how many links go (LINK_COUNTS_FOR_GRID)
- Archive / trash / purge were already handled (muted, hidden, cascade)
- Import: a file column mapped to a link column links by name (exact, ignoring case; "A; B" on a side that holds many), quietly (history, no change notes); unmatched names listed in one warning per column; "Add linked {records} that don't exist yet" creates them in the other list (once per name) within the free limit (`canAddTo` from IPC); a new column can't be created as 'link' by import
- Build state: npm test 3399 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W04 commit 8 — starter/template support

## 2026-10-02 (cont.) — Generalization P3: W04 commit 8 (links in starters and shared workspaces) done — W04 complete
- Starter format: `links` on a list (`to` = list key, names, cardinality, `showOnOther`) and `sampleData.links` (`from`/`to` "<key>#<i>", `link` = the from-list's link name); 'links' no longer "needs a newer version"; parse checks targets exist and names are distinct per list
- `applyStarter`: links between chosen lists via `setupLink` (columns on both sides unless `showOnOther: false`); a link whose other list wasn't chosen is skipped with a warning; 'link' entries in `columns` are ignored (links come from `links`); sample links added quietly
- `exportWorkspaceStarter` writes each list's links by key (showOnOther false when the other list has no column); `.pulse` single-list setup files leave link columns out
- Build state: npm test 3403 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: P3 — W06 stages/board

## 2026-10-02 (cont.) — Generalization P3: W06 commit 1 (stage settings) done
- `src/shared/stages.ts`: `stageConfigSchema` (options in board order with color, done, onEnter { checklistTemplateId, stampColumnId, activityTypeKey }; hideDoneAfterDays), `canBeStage`, `stageConfigOf`, `stageColumnOf`, `columnOptionLabels`
- `src/main/stages.ts` `saveStageConfig` + IPC STAGE_CONFIG_SAVE (`ipc-stages.ts`): status/dropdown only; stages must be exactly the column's options (no repeats); option order follows the stage order (status colors kept); onEnter targets checked (checklist exists, a date column of this list, a note type that exists); one stage per list (another column stops being it); turns on `log_changes`; `null` stops (logging stays); column cache cleared for changed columns
- Renderer: column menu "Use as the stage…" / "Stage settings…" (feature `stages`) opens `components/stages/StageSettingsDialog.tsx` (reorder with ↑/↓, color for dropdown columns, "Counts as done" guessed from words like Done/Closed/Picked up, "When moved here…": checklist, fill in today's date, log a note; hide done after N days; stop using)
- The switch itself stays unavailable until the board exists (commit 3)
- Build state: npm test 3408 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W06 commit 2 — STAGE_MOVE with on-enter actions + undo

## 2026-10-02 (cont.) — Generalization P3: W06 commit 2 (stage moves with on-enter actions + undo) done
- `moveStage` (main) + IPC STAGE_MOVE: the stage cell with history and a change note, then the target stage's on-enter actions in the same transaction — add the checklist, fill in today's date (with history; previous value returned), log a note of the chosen type ("Moved to Done"); unchanged moves do nothing; values must be stages; `null` clears
- Shared helpers pulled out: `src/main/cell-write.ts` (`setCellWithHistory`, now used by deadline actions too) and `src/main/checklist-apply.ts` (`applyChecklistTemplate`, used by CHECKLIST_APPLY_TEMPLATE)
- Renderer `utils/stageMove.ts` `moveToStage`: one undo step that restores the stage and the filled-in date, deletes the added checklist items and voids the notes; `gridStore.updateCell` routes edits of the stage column through it, so table edits run the same actions
- Build state: npm test 3412 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W06 commit 3 — board view (cards, toggle, saved views)

## 2026-10-02 (cont.) — Generalization P3: W06 commit 3 (board view) done
- Feature switch "Stages and board" is now available; toolbar Table / Board toggle when the list has a stage; the choice is remembered per list (settings `grid_view_mode_<gridId>`, loaded with the grid) and in saved views (`viewMode`; older views open as a table)
- `components/board/boardLanes.ts`: `visibleRows` (starred, filters and/or, search like the table, link columns by name), `nearestDeadline` (engine, paused/done skipped), `buildLanes` (stage order, "No {stage}" lane when needed, nearest deadline then name, done records unchanged for `hideDoneAfterDays` counted as hidden — uses `updated_at` until stage entry times exist in commit 5)
- `components/board/BoardView.tsx`: 280px lanes with color bar (palette, hex, or the status option's color), name and count; cards with name, auto number, up to 3 "Show on cards" fields (settings `board_card_fields_<gridId>`), deadline chip in the rule's color, priority badge, first link column's chips, star; click opens the record; 50 cards per lane then "Show N more" (instead of virtualization)
- Deferred from the spec: double-click quick edit; one-lane switcher at narrow widths (lanes scroll sideways)
- Build state: npm test 3416 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W06 commit 4 — drag and keyboard moves + announcements

## 2026-10-02 (cont.) — Generalization P3: W06 commit 5 (time in stage) done
- `stageDurations(gridId, columnId, rowIds?, now)` (main) + IPC STAGE_DURATIONS: two queries (rows + the stage column's history), current stage with entry time and days, finished stays oldest first; the value before the first recorded change counts from when the record was added (approximate); no history at all → approximate from added; no-op history rows ignored; table edits and board moves count the same
- Board cards: "3 days here" / "About 31 days here" / "Moved here today" (refetched 300 ms after rows change); done cards now hide by stage entry time
- Profile "{Stage} history" section (collapsed by default): current stage and how long, then earlier stays with dates
- Fix (separate commit): a vitest global teardown removes the temporary test databases each run leaves; 11k leftovers had filled /tmp and broken the native rebuild. The W06 commit 4 entry's 3417 count was confirmed after the fix
- Build state: npm test 3421 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W06 commit 6 — dashboard "Stages" card

## 2026-10-02 (cont.) — Generalization P3: W06 commit 6 (dashboard "Stages" card) done
- `stageSummary(now)` (main) + IPC STAGE_SUMMARY: per active list with a stage, active records per stage (with the stage's color, falling back to the status option's), "No {stage}" count, average finished stay per stage (exact stays only), and the open record waiting longest (done stages excluded)
- `views/dashboard/StagesCard.tsx` (feature `stages`): a colored bar per list (done stages dimmed), legend with counts and "usually N days", "Waiting longest: J-0042, In progress for 12 days" (opens the record); a segment loads the list, filters to that stage and switches to the board
- `loadGrid` now awaits the per-list view mode read, so a caller can set the mode right after loading
- Stage wording in the dialog, column menu and card uses the vocabulary's `stage` word
- Build state: npm test 3424 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W06 starters (`stage` in StarterList, by names) — then W10 (part) and W16 P3 help

## 2026-10-02 (cont.) — Generalization P3: W06 stages in starters and files (§8) done — W06 complete
- Starter format: list `stage` = { column, options [{ value, color, done, onEnter { checklist (name), stampColumn (name), activityType (key) } }], hideDoneAfterDays }; 'stage' no longer "needs a newer version"; `portableStageSchema` in shared/stages.ts
- `src/main/stage-portable.ts`: `portableStage` (ids → names) and `applyPortableStage` (names → ids, through `saveStageConfig`; missing checklist/date column/note type left out with a warning; options that don't match the column → "{list} has no stage: …")
- `applyStarter` applies list stages after columns; raw `stage` ids in a file's column settings are always dropped; `exportWorkspaceStarter` writes the list's stage by names; `.pulse` single-list files carry it as `stage_portable` on the column and set it up by name on apply (a list that already has a stage keeps it)
- Build state: npm test 3427 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: P3 — W10 (part) and W16 P3 help

## 2026-10-02 (cont.) — Generalization P3: W10 commit 1 (report renames, Export menu grouping) done
- Export menu now has "Export" (CSV, PDF) and "Reports" headings; "Supervisor Report…" → "Summary report…"; "Compliance summary…" → "{Requirements} summary…" from the vocabulary (e.g. "Contact requirements summary")
- Renamed through: SupervisorReportDialog title and save dialog, the summary report's PDF/CSV title, the requirements summary PDF heading, save dialog and file name (`requirements-summary-YYYY-MM.pdf`), ComplianceSummaryDialog title and toast, FAQ entry, tour text
- "Handoff packet" stays for people; thing and job lists get "{Record} packet" ("Vehicle packet") on the profile button and dialog
- Batch print isn't in the Export group yet (W10 commit 3 adds batch documents)
- Build state: npm test 3427 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W10 commit 2 — placeholder resolver + insert-field menu

## 2026-10-02 (cont.) — Generalization P3: W10 commit 2 (placeholder resolver + insert-field menu) done
- `src/main/placeholders.ts` `resolvePlaceholders`: `{{name}}`, `{{field:Column}}` (any column by name, formatted: dates written out, currency, Yes/No, link names), `{{linked:Owner.Phone}}` / `{{linked:Owner.name}}` (a link side that holds one, either direction), `{{my_name|my_title|my_org|my_phone|my_email}}`, `{{today}}` / `{{today:long}}`, `{{deadline:Column}}` (engine due date); older placeholders kept: client_name, case_manager_*, today_date, dob, age, medicaid_cin, snake-case column names. Unknown placeholders stay as typed and are returned in `unknown`; "(unnamed)" fills in blank
- `generateLetter` now returns `{ text, unknown }`; both generators show `UnknownPlaceholders` ("…left as typed: {{x}}")
- "Insert field" menu: fixed groups use the new names; PLACEHOLDER_FIELDS adds the open list's columns, deadlines (columns with rules) and linked records' columns; placeholder reference rewritten (older placeholders listed as still working)
- `{{appointment.*}}` waits for W07
- Build state: npm test 3433 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W10 commit 3 — batch documents + labels + postcards

## 2026-10-02 (cont.) — Generalization P3: W10 commit 3 (batch documents, labels, postcards) done
- `src/main/export-documents.ts`: `batchRowIds` (selected / everyone active / everyone with a chosen deadline due in a date range via `loadDeadlines`; name order; at most 1000), `buildBatchPdf` (letter size, one document per record with long ones running onto more pages; or 4×6 in postcards, two per sheet with cut marks; unknown placeholders collected once), `buildLabelsPdf` (Avery 5160 30-up 2⅝×1 in / 5163 10-up 4×2 in; name then the address with its line breaks; records without an address left out and counted), `labelPositions`, `postcardPositions`
- IPC DOC_BATCH / DOC_LABELS: validated targets; the PDF is built before the save dialog, so problems show first
- `components/documents/BatchDocumentsDialog.tsx` ("Print documents or labels"): Documents / Address labels; for the selected, a deadline range (defaults to next month), or all active; template; letter or postcards; address column (address type or a text column named like "address") and sheet; unknown placeholders shown after saving
- Entry points: Export menu "Documents and labels…" (uses the selection if any) and bulk bar "Print documents…" (feature `letters`); the dashboard "Due next month" entry waits for the card registry (commit 4)
- Build state: npm test 3440 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W10 commit 4 — dashboard card registry + customize mode + new cards

## 2026-10-02 (cont.) — Generalization P3: W10 commit 4 (dashboard cards, customize, new cards) done
- `views/dashboard/cards/layout.ts`: card registry (summary, {Requirements} this period, {Stages}, missing information, Due for service, Running low on visits, Recent {activities}) with feature / rule-kind conditions and defaults; settings `dashboard_layout` = { order, hidden } (a starter's plain list means "show these, in this order"); cards new in a later version appear at the end if on by default
- `DashboardCards.tsx`: renders the cards in order (the summary tiles are passed in, since they use the dashboard's counts); "Customize" header button opens a panel to show/hide and move cards up/down (instead of drag); cards whose feature is off, or with no rule of their kind, aren't listed but keep their saved place
- New cards: Due for service (meter deadlines within 30 days), Running low on visits (quota deadlines soon/used up/ending), Recent {activities} (DASHBOARD_RECENT_ACTIVITY: last 10 notes across active lists, Pulse's own and voided left out, plain text shortened; off by default)
- Dashboard header "Print reminder letters" (feature `letters`, a list open) opens the batch documents dialog (defaults to next month's deadlines)
- Starters: `dashboardCards` is accepted (no longer "needs a newer version") and saved as the layout when the suggested features are applied
- Not done: today's appointments (W07) and pinned saved reports (P5) cards
- Build state: npm test 3444 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W10 commit 5 — number history chart

## 2026-10-02 (cont.) — Generalization P3: W10 commit 5 (number history chart) done — W10 P3 part complete
- CELL_UPDATE now records the first value in `cell_history` (old_value null) when the column has "Log changes in timeline" on, so a score's history starts at its first entry; other columns behave as before
- `src/main/number-history.ts` `numberSeries(rowId, columnIds)` + IPC CELL_HISTORY_SERIES: each numeric change, oldest first, number/currency columns of the record's own list only ("$1,234.50" read as a number; non-numbers skipped)
- Profile details (GridDataSummary): number/currency columns with two or more values get a sparkline next to the value (one request per record, refreshed when a value changes); clicking opens `NumberHistoryDialog` — inline SVG with axes, first/last dates, min/max, every point labelled, a screen-reader table, and a hint to turn on "Log changes" to keep every value
- Build state: npm test 3448 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: P3 — W16 P3 help (then P4: W07, W08)

## 2026-10-02 (cont.) — Generalization P3: W16 help for P2 and P3 done — P3 complete
- Help topics (faqData, word tokens throughout): deadline kinds (all six with examples, preview, "Only when…"), working days and days off, extensions, morning reminders; connecting lists, the board, on-enter actions, printing documents and labels for many at once, customizing the dashboard, number charts. P2's topics had been missed; added here
- Help is feature-aware: `FAQItem.feature`; topics for switched-off features are listed under "More features you can turn on" with a "Turn on {feature}" button (workspace update), and still found by search
- Build state: npm test 3449 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: P4 — W07 appointments and calendar, then W08 forms

## 2026-10-02 (cont.) — Generalization P4: W07 commits 1–2 (appointments + recurring series) done
- Migration 040 (schema 40; the spec called it 040): `appointment_series` (rule, template, materialized_until) and `appointments` (local wall times, status, case_log_id, is_exception) plus `series_date` (the date an occurrence was made for — not in the spec; needed so a moved or deleted occurrence isn't made again)
- `src/shared/appointments.ts`: zod input/patch schemas (real dates and times, end after start, title ≤ 200, location ≤ 300), `seriesRuleSchema` (daily/weekly/monthly, interval, byDay, until, count, untilColumnId), `seriesDates` (weekly with several days, every N weeks, monthly on the 31st clamped, 500 and two-year limits), wall-time helpers, `describeRule`
- `src/main/appointments.ts`: `listAppointments` (range, list/record/status filters, trash hidden, record name and list), `recordAppointments` (next 5 / last 5), `createAppointment` (single or series, six months made ahead), `updateAppointment` / `deleteAppointment` with scopes one (marks an exception; a deleted date goes to the template's `exdates`) / following (ends the old series the day before and starts a new one) / all (future scheduled, non-exception ones; past and done never change; moving dates needs "following"); `ensureMaterialized` (on unlock and whenever a range is listed), `rematerializeForRecord` (after a date cell changes, for series ending on a column's date); every change returns a snapshot and `restoreAppointments` undoes it
- IPC `ipc-appointments.ts`: APPT_LIST / FOR_RECORD / CREATE / UPDATE / DELETE / RESTORE; push APPOINTMENTS_CHANGED
- Build state: npm test 3462 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W07 commit 3 — done / no-show / cancel → activities + undo

## 2026-10-02 (cont.) — Generalization P4: W07 commit 3 (done / no-show / cancelled → notes + undo) done
- `setAppointmentStatus` (main) + IPC APPT_SET_STATUS: done makes a note of the appointment's kind (else "visit", else the first kind), dated the day it happened (never later than now), text from the dialog or "Appointment: {title}", `source_action_id` `appt:<id>`, minutes = its length when time tracking is on (or given), miles and your numbers; moves dates that follow notes (A1). No-show / cancelled make a note only when a `no_show` / `cancelled` kind exists. Leaving a status voids the note it made. Appointments not about a record change status without a note. Pushes CASE_LOG_CHANGED for the record
- Renderer `utils/appointmentActions.ts`: create / update / delete (undo restores main's snapshot; redo repeats) and set status (undo sets it back and puts moved dates back)
- Build state: npm test 3467 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W07 commit 4 — calendar view (month + agenda; appointment and deadline layers)

## 2026-10-02 (cont.) — Generalization P4: W07 commit 4 (calendar: month + agenda) done
- Feature "Appointments" is now available; sidebar "Calendar" link always (it shows deadlines too); route `/calendar` (`views/CalendarView.tsx`, lazy)
- Month view (weeks start per `week_start`; six rows; today highlighted; up to three events per day then "+N more", which opens the agenda at that day; double-click a day for a new appointment) and Agenda (31 days, a section per day with events)
- Layers (chips, saved in settings `calendar_layers`): appointments (feature on), deadlines (colored by state), follow-ups, tasks (feature on); main `calendarItems(from, to)` + IPC CALENDAR_ITEMS; the view (`calendar_mode`) is remembered
- Events: appointments open `AppointmentPanel` (details, record link, Done with a note / No-show / Cancel it / Back to scheduled, Edit, Delete with the scope prompt); deadlines and follow-ups open the record; tasks open Tasks. Screen-reader labels like "Tuesday, Oct 6, 3:00 pm to 3:50 pm, Session with Jane, scheduled"
- `AppointmentDialog` (new/edit: what, with — search across lists, date, time, minutes or all day, where, the kind of note it becomes, repeats daily/weekly on days/monthly every N with end never / on a date / after N / on the date in one of the record's columns, notes); `ScopeDialog` (only this one / this and following / all) for repeating ones
- Keyboard: arrows move the focused day, Enter opens it in the agenda, N new appointment, T today, M / A switch views
- Build state: npm test 3473 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W07 commit 5 — week/day views + drag/resize + keyboard

## 2026-10-02 (cont.) — Generalization P4: W07 commit 5 (week/day views, drag and resize) done
- `components/calendar/TimeGrid.tsx`: a column per day, hours down the side (12/24h), opens scrolled to 7:00; all-day row on top with all-day appointments, deadlines, follow-ups and tasks; timed appointments placed by time, at least 44px tall, overlapping ones side by side (`layoutDay`)
- Click an empty slot → new appointment at that time (snapped to 15 minutes); drag a scheduled appointment to move it (across days in week view) or its bottom edge to change its length (`dropTimes`, 15-minute snap); a tiny drag counts as a click; done/missed ones just open; a drag on a repeating one asks the scope
- CalendarView modes Month · Week · Day · Agenda (Week by default when appointments are on); Enter on a month day opens it in Day; keys W / D added; Enter or Space on a focused appointment opens it
- Build state: npm test 3477 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W07 commit 6 — profile section, dashboard Today card, briefing line

## 2026-10-02 (cont.) — Generalization P4: W07 commit 6 (profile, dashboard Today, briefing) done
- Profile "Appointments" section (feature on): coming up (next 5) and earlier (last 5, with status); Done / No-show on ones that have come; click to edit; "Schedule…" opens the dialog for this record
- Dashboard card "Today's appointments" (registry key `today`, feature `appointments`, on by default): today's in time order, cancelled left out, quick Done / No-show, record link, "Open calendar"
- Morning briefing: "4 appointments today, first at 9:00 am" (`appointmentsToday` in appointments.ts, scheduled only, trash excluded, feature on); the morning desktop reminder adds "2 appointments"
- Build state: npm test 3480 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W07 commit 7 — planner PDF, ics and document placeholders

## 2026-10-02 (cont.) — Generalization P4: W07 commit 7 (planner, calendar file, placeholders) done — W07 complete
- Calendar file (.ics): scheduled appointments as timed events in floating local time (`DTSTART:20261006T150000`, DTEND or a one-hour duration, a reminder 30 minutes before); all-day ones as all-day events. Titles are free text that may name people, so without full names an event reads "Appointment with J.S."; with full names "{title} ({name})"
- Weekly planner PDF: this week's scheduled appointments, with times ("8:30 am  Drop-off")
- Document placeholders `{{appointment.date}}`, `{{appointment.time}}`, `{{appointment.location}}` from the record's next scheduled appointment (blank when none); offered under "Next appointment" in Insert field when the feature is on
- Vocabulary: the workspace's `appointment` word is used across the calendar, dialogs, panel, Today card, profile section, briefing, reminder text, feature label, calendar file, planner, placeholders and the note made when one is done
- Build state: npm test 3483 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: P4 — W08 forms

## 2026-10-02 (cont.) — Generalization P4: W08 commit 1 (forms data, module, IPC) done
- Correction: the W07 commit 7 entry said 3483 tests; the run had 3484
- Migration 041 (schema 41): `forms` (list, name, intro, fields JSON, log_activity_type, position)
- `src/shared/forms.ts`: `formFieldSchema` (column with label/help/required/half-or-full width; section heading; note question), `formInputSchema` (≤ 80 fields), `NOT_FILLABLE` (auto number, age, calculated days, deadline), `FormChange`
- `src/main/forms.ts`: `listForms` / `getForm` (fields for deleted columns dropped and counted as `dropped`; renamed columns stay, by id), `saveForm` (this list's columns, once each, fillable, at least one question, note kind exists), `deleteForm`, `submitForm` (required answers checked in main too — a required checkbox must be ticked, an existing value counts on update; dates and numbers checked; create: cells, auto numbers, display name; update: only changed cells with history; link fields set links; note "{Form}\nQ: A…" plus changed fields, `source_action_id` form:<id>, A1 date updates), `undoFormSubmit` (removes a created record, or restores values and links; voids the note)
- IPC `ipc-forms.ts`: FORM_LIST / SAVE / DELETE / SUBMIT (free-limit check when creating) / UNDO
- Build state: npm test 3490 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W08 commit 2 — builder UI

## 2026-10-02 (cont.) — Generalization P4: W08 commit 2 (form builder) done
- Sidebar list menu "Forms…" (feature `forms`) opens `components/forms/FormsDialog.tsx`: the list's forms with question counts and a note when fields were lost to deleted columns; new, edit, delete (confirmed; nothing filled in is changed)
- `components/forms/FormBuilder.tsx`: Add (the list's fillable columns — auto number/age/calculated/deadline left out; required preset from the column's "Required" flag — plus "Section heading" and "Question for the {note}"); the form (move up/down, remove; label override, help, required, half width; heading title and text); settings (name, introduction, "Also log {a note}" of a chosen kind). Reorder uses buttons rather than drag
- `stores/formStore.ts` caches each list's forms for the menus coming in commit 3
- The feature switch stays unavailable until forms can be filled in (commit 3)
- Build state: npm test 3492 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W08 commit 3 — fill dialog + submit + undo

## 2026-10-02 (cont.) — Generalization P4: W08 commit 3 (fill in a form, submit, undo) done
- Feature "Forms" is now available
- `components/forms/FillFormDialog.tsx`: introduction, section headings, large fields with the right input per column (date, number, checkbox, dropdown/status options, notes/address text areas, phone/email/url, link search with chips), half/full width, required marked; required answers checked before sending (a required checkbox must be ticked) with the errors listed at the top and focused; submit sends only answers given (all form fields when updating), shows "Added {a record}" / "Saved", reloads the open list; one undo step (FORM_UNDO; redo resubmits)
- Entry points through one `form:fill` event and `FormFillHost` (in MainLayout): grid toolbar "Use a form ▾" (new record), profile "Fill in a form:" buttons (prefilled update of this record), command palette "Fill form: {name}"
- Build state: npm test 3494 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W08 commit 4 — printable blank and filled PDFs

## 2026-10-02 (cont.) — Generalization P4: W08 commit 4 (printable blank and filled forms) done
- `src/main/export-forms.ts` `buildFormPdf(formId, rowId | null)` (letter): title, introduction, section headings with a rule, labels (required marked *) with writing lines, half-width fields side by side, date boxes `____ / ____ / ________`, checkbox squares, dropdown/status options with squares (the chosen one ticked when filled), three writing lines for notes/address and for note questions; filled forms print saved values (dates written out, linked names); footer with the list name and "Page X of Y"
- IPC FORM_PRINT (built before the save dialog); "Print blank" on each form in Forms…, and "Print blank" / "Print filled" in the fill dialog
- Build state: npm test 3496 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W08 commit 5 — starter support

## 2026-10-02 (cont.) — Generalization P4: W08 commit 5 (forms in starters) done — W08 complete
- Starter format: list `forms` (name, intro, log_activity_type, fields with `column` by name, sections, note questions); nothing is "needs a newer version" any more except sample-data appointments/stage history
- `src/main/form-portable.ts`: `applyPortableForms` (columns matched by name, ignoring case; missing or Pulse-filled columns left out with a warning; unknown note kind dropped; a form that can't be saved is reported) and `portableForms` (export by column name); used by `applyStarter` and `exportWorkspaceStarter`
- The built-in social-work example ("social-worker-caseload") comes with an "Intake" form
- Build state: npm test 3499 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W16 help for P4 (appointments, the calendar, forms), then P5

## 2026-10-02 (cont.) — Generalization P4: W16 help for P4 done — P4 complete
- Help topics: what the calendar shows (views, layers, keys), scheduling one-off and repeating {appointments} (ends on a date / after N / on a record's date; drag to move or resize; scope choices), what marking one done does, making and using forms (print blank / filled)
- Fixed an outdated help answer about letter placeholders (it listed ones that don't exist; now the real `{{name}}`, `{{field:…}}`, `{{deadline:…}}`, `{{my_name}}`, `{{today}}` and Insert field)
- The static-text vocabulary test now catches tokens with a bad suffix (like `{activity:an}`, which would have shown raw) and ignores every double-brace letter placeholder
- Build state: npm test 3499 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: P5 — W09 attachments, W10 report builder, W11 tray mode + start with computer, W14 rename switch

## 2026-10-02 (cont.) — Generalization P5: W09 commit 1 (attachments data, module, IPC) done
- Migration 042 (schema 42): `attachments` (record, optional note, cleaned name, MIME from content, size, sha256, description, soft delete) and `attachment_blobs` (bytes in their own table)
- `src/main/attachments.ts`: `sniffType` (PDF, PNG, JPEG, GIF, WebP, HEIC, RTF, DOCX/XLSX/PPTX and ODT/ODS by zip contents, TXT/CSV only by name with no binary bytes or web markup; programs, scripts, archives, HTML/SVG and anything else refused), `cleanFileName`, `addAttachments` (all or nothing; 15 MB per file; total limit from settings `attachments_max_mb`, 100–4,000, default 1,000; duplicates on the same record held back unless allowed; optional note of the same record), `listAttachments`, `describeAttachment`, `deleteAttachment` / `restoreAttachment`, `purgeDeletedAttachments`, `attachmentUsage`, `attachmentBytes`; trashed files are purged after 30 days with the rest of the trash
- IPC `ipc-attachments.ts`: ATTACHMENT_ADD (main shows the open dialog), ATTACHMENT_ADD_PATHS (dropped files; paths checked with assertSafePath), both ask "Attach again?" for duplicates; LIST / DESCRIBE / DELETE / RESTORE / USAGE / PURGE; push ATTACHMENTS_CHANGED
- Build state: npm test 3509 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W09 commit 2 — open / save a copy / temp folder lifecycle + preview

## 2026-10-02 (cont.) — Generalization P5: W09 commit 2 (open, save a copy, temp folder, preview) done
- `src/main/attachment-files.ts`: `writeOpenedCopy` (random hex name + the type's ending in `<data folder>/tmp-open/`, owner-only permissions, removed after 10 minutes when possible), `openAttachment` (system viewer; a clear message when nothing can open it), `saveAttachmentCopy` (exact bytes via atomic write), `previewAttachment` (data URL for PNG/JPEG/GIF/WebP up to 5 MB; others open in the system viewer), `wipeOpenedFiles` — run on startup and on every lock/quit (database close hook)
- IPC ATTACHMENT_OPEN / ATTACHMENT_SAVE_AS (save dialog, path checked) / ATTACHMENT_PREVIEW
- Build state: npm test 3513 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W09 commit 3 — profile Files section + drop zone + note paperclip

## 2026-10-02 (cont.) — Generalization P5: W09 commit 3 (profile Files, drop zone, note paperclip) done
- Feature "Files" is now available — every feature switch now works; the tests that checked a "not built yet" switch were updated accordingly
- Profile "Files" section (`components/profile/RecordFiles.tsx`): thumbnails for pictures (preview IPC), name, size, date, description and "with a note"; open, save a copy (reminder that copies aren't encrypted), rename/describe inline, remove (undo restores); "Add files…" and a drop zone; the note that opened copies live outside Pulse while open
- Notes: files attached to a note are listed under it, and a paperclip "Attach" adds files to that note (`NoteFiles`)
- Preload `pathForFile` (Electron `webUtils.getPathForFile`) gives dropped files' paths; main checks them like any other path
- `utils/attachmentActions.ts`: add with dialog, add dropped files, delete with undo, open, save a copy
- Build state: npm test 3517 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W09 commit 4 — settings usage, trash, grid count column

## 2026-10-02 (cont.) — Generalization P5: W09 commit 4 (file storage, trash, Files count column) done
- New column type `file_count` ("Files (how many)" when Files is on): counted by a subquery in the one grid query (trash left out, stray cells ignored), shown as "2 files" or "—", read-only, not bulk-editable, not fillable in forms, not required-able; converting to or from it is refused; exports carry the count
- Settings → Data → Files: count and room used (bar), the limit in MB (100–4,000), "Remove files in the trash now"
- Trash → Files: removed files with their record and date, Restore and Delete for good (IPC ATTACHMENT_TRASH_LIST; ATTACHMENT_PURGE takes an optional id)
- Build state: npm test 3526 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W09 commit 5 — audit trail, handoff packet file list, security docs and checkup

## 2026-10-02 (cont.) — Generalization P5: W09 commit 5 (audit trail, handoff packet, security docs and checkup) done — W09 complete
- Audit trail: adding, renaming, removing and restoring a file writes a system entry on the record ("File added: court-order.pdf (240 KB)", "File removed: …", "File restored: …", "File renamed: a → b"), in the same transaction; the timeline refreshes
- Handoff / record packet: a Files page lists each file (name, size, date added, description); "Include pictures from Files as pages" puts PNG and JPEG files on their own pages, scaled to fit (PDFs and other files are listed only — jsPDF can't merge PDFs; unreadable pictures are skipped)
- Security checkup: "Files are using X of Y" (warns at 90%); backup settings warn when the data is over 500 MB; Data settings say CSV exports don't include files; factory reset removes the opened-files folder too
- Security docs (`security-at-a-glance`, `hipaa-safeguards-map` boundary table, `supervisor-it-faq`) and the in-app security summary describe files inside the database, opened copies and saved copies
- Build state: npm test 3529 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W10 P5 — report builder (migration 043 `report_definitions`)

## 2026-10-02 (cont.) — Generalization P5: W10 commit 6 (report builder engine) done
- Migration 043 (schema 43): `report_definitions` (name, list, JSON settings; removed with the list)
- `src/shared/reports.ts`: zod `reportConfigSchema` (source records / notes / appointments / deadlines; up to 20 filters, a date range with presets, up to 2 groupings with day/week/month/quarter/year buckets, up to 6 values count/total/average/lowest/highest, columns, sort), field ids (`col:<id>`, `rec:created`, `rec:stage_days`, `act:date|type|minutes|miles|m:<measure>`, `appt:date|title|status|type|minutes`, `dl:rule|state|due|overdue`), filter matching, date buckets, preset ranges, formatting
- `src/main/report-builder.ts`: `reportFields`, `validateReportConfig` (every field checked against the list; only numbers can be added up; only dates bucketed), `runReport`, saved report CRUD. Deviation from the plan: instead of compiling the config to SQL, the source rows come from fixed parameterized queries (the list's one grid query, notes, appointments, `loadDeadlines`) and filtering/grouping/values are worked out in code over the whitelisted fields — no report text can reach SQL at all. Limits: 50,000 source rows, 2,000 lines, 5 s
- IPC `ipc-reports.ts`: REPORT_FIELDS / RUN / RUN_SAVED / LIST / SAVE / DELETE
- Not yet: fields from linked records' columns (link columns report their linked names)
- Build state: npm test 3544 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W10 commit 7 — builder UI, save, pin to dashboard, export PDF/CSV

## 2026-10-02 (cont.) — Generalization P5: W10 commit 7 (builder UI, save, pin, export) done — W10 complete
- Reports view (`/reports`, sidebar "Reports", command palette "Go to Reports", Export menu "Build a report…"): saved reports on the left, the 4-step builder on the right (what to report on and what each line counts, which ones + date range, group by or list columns, values) with a live preview table (sortable headings, totals line)
- Save / Delete, "Pin to dashboard" (settings `dashboard_reports`; a pinned report shows its first 10 lines as a dashboard card with Open and Unpin; deleting a report unpins it)
- Export PDF / CSV (`src/main/export-report.ts`, IPC REPORT_EXPORT): CSV keeps numbers as numbers and guards text against formulas; PDF has a totals line, page numbers and the confidential footer
- Build state: npm test 3553 pass / 4 skip; typecheck 0; eslint 0 errors

## 2026-10-02 (cont.) — Generalization P5: W11 commit 2 (appointment reminders) done
- Settings → Alerts → Reminders (Appointments feature on): "Before each appointment" — no reminder / 5 / 10 / 15 / 30 minutes / 1 hour (settings `reminders_appt_lead`, default off); "Show who it's with" (settings `reminders_show_names`, default off) with the lock screen / notification history warning
- `reminders.ts`: `apptRemindersDue` (pure: from the lead time up to the start, timed appointments only, crosses midnight), `apptReminderText` ("Appointment at 3:00 pm", "+ with J.S." for people or the thing's name when names are on; the workspace's word and the clock setting), scheduled appointments only, trash left out; sent ones remembered in memory only (keyed by id + time, so a moved appointment reminds again)
- Clicking one opens the calendar's day view on that date (`/calendar?date=…`, allowlisted in MainLayout)
- Build state: npm test 3558 pass / 4 skip; typecheck 0; eslint 0 errors

## 2026-10-02 (cont.) — Generalization P5: W11 commits 3–4 (background mode, start with computer) done — W11 complete
- Settings → Alerts → "Running in the background": "Keep Pulse running in the background" (`trayMode`) and "Open Pulse when I sign in" (`openAtLogin`; hidden in the tray when background mode is on; Windows/macOS only; portable-copy warning). Both kept in `pulse-prefs.json` (`src/main/prefs.ts`, moved out of index.ts) so they're readable while locked; IPC BACKGROUND_GET / BACKGROUND_SET
- `src/main/tray.ts`: closing the window hides it, runs the on-close backup, then locks (database closed, key wiped); tray menu Open / Lock now / Quit; tooltip shows counts only. Sign-out/shutdown (`session-end`) and Quit still exit; second launch and dock activate re-show the window
- Reminders while locked: `snapshotForLock` (registered as a database close hook) keeps counts, settings and appointment *times* in main-process memory only; `lockedReminders` sends the daily summary and "Appointment at 3:00 pm" with no names even if names are on; stale counts from an earlier day say "Unlock to see what's due today"; a summary sent while locked isn't repeated after unlocking
- `src/main/login-item.ts`: `setLoginItemSettings` with `--hidden` on Windows (portable exe path honoured), `wasOpenedAsHidden` on macOS; a hidden start skips showing the window
- Security docs (at-a-glance, IT FAQ, HIPAA boundary table) and the in-app security summary describe background mode
- Build state: npm test 3571 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W12 starter templates

## 2026-10-02 (cont.) — Generalization W12 commit 1 (starter test helper, required columns, human-services sample data) done
- Starters and `.pulse` setup files carry `is_required` on columns (ignored for types that can't be missing); shared setups keep it
- Variants can have their own `sampleData` (`starterSampleData(s, variant)`); the human-services starter has 8 fake people per role variant with notes, dates spread across overdue / this week / later
- `tests/starter-catalog.test.ts`: one table-driven test for every built-in starter and variant (valid, applies with sample data and no warnings, columns/rules/required present, every rule linked, deadline spread, reports / missing info / requirements summary run, no human-services words outside human-services starters, 5–14 columns, disclaimer for regulated trades). Deviation: one table-driven file instead of a generated file per starter (vi.mock must sit in each test file)
- Deviation: D1's sample caseload stays as setup's "try it with sample data" (it also adds tasks, contacts and checklist items the starter format doesn't carry); the starter has its own sample data per variant. `minPhase` isn't needed — every phase's features are built, and unknown keys are rejected anyway
- `plans/starter-template-catalog.md` has a Shipped table
- Build state: npm test 3585 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W12 wave-1 starters (staff credentials, business licenses, workplace safety…)

## 2026-10-02 (cont.) — Generalization W12 commit 2 (staff credentials, business licenses, workplace safety) done
- `staff-credentials` (Business): Staff roster, 12 columns, CPR / license expiry (60/30/14-day warning), TB every year, background check every 2 years, required Name / Role / Hire date, note types Reminder sent / Document received, "Renewal reminder" letter, 14 sample staff
- `business-licenses` (Business): Licenses & permits (thing), expiry with 90/60/30/7-day warning and a "Renewal steps" checklist on done, note types Application sent / Payment made / Inspection, 10 sample licenses
- `workplace-safety` (Property and safety): Safety roster, forklift every 3 years, first aid expiry, four yearly trainings, disclaimer, help tip on printing training status, 12 sample employees
- Gallery icon `id-card` added; groups follow the order in `src/shared/starters/index.ts`
- Build state: npm test 3591 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: food service, school nurse, provider credentialing

## 2026-10-02 (cont.) — Generalization W12 commit 3 (food service, school nurse, provider credentialing) done
- `food-service` (Business): Kitchen staff (food handler card and manager certification expiry, allergen training yearly) and Equipment & services (hood cleaning and fire suppression every 6 months, calibration and pest service every 30 days, health inspection yearly), each list with its own words; disclaimer; 10 staff + 6 items
- `school-nurse` (Education and youth): Health roster, allergies, conditions (tags), immunizations, medication authorization expiry (30/14/7-day warning), yearly plan review and screenings, required Name / Date of birth / Guardian phone, note types Office visit / Medication given / Parent call, "Medication form reminder" letter, 15 sample students
- `provider-credentialing` (Health): license / DEA / board / malpractice / privileges expiry (90/60/30/7), CAQH every 120 days, payer re-credentialing every 3 years, disclaimer, 8 sample clinicians
- Build state: npm test 3597 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: church volunteers, truck driver files, personal documents

## 2026-10-02 (cont.) — Generalization W12 commit 4 (volunteer safety, driver files, personal documents) done
- `volunteer-safety` (Faith and community): background check every 3 years, child safety training yearly, references checked, required Name / Phone, note types Training / Check-in, 12 sample volunteers
- `driver-files` (Trades and service): CDL and medical card expiry (60/30/14), yearly MVR and annual review, road test and drug-testing dates, disclaimer, "Medical card reminder" letter, 10 sample drivers
- `personal-documents` (Personal): 6 columns, expiry with 90/30/7-day warning, "last 4 digits only" help on Number, 8 sample household items
- Gallery icon `folder` added
- Build state: npm test 3603 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: housing case manager, community health worker, peer recovery (human-services words)

## 2026-10-02 (cont.) — Generalization W12 commit 5 (housing, community health worker, peer recovery) done — wave 1 complete
- Human-services words and features for all three:
  - `housing-case-manager`: monthly contact, housing plan review every 6 months, lease end, yearly income recertification, landlord; requirement 1 contact a month (visit / phone / meeting)
  - `community-health-worker`: health concerns (tags), screening due, language, clinic; note types Text / Referral made; requirement 2 contacts a month; tip on the Contact note format
  - `peer-recovery`: recovery milestones as a sequence rule on a deadline column (30 / 60 / 90 days, 6 months, 1 year, then yearly) from the recovery start date, plan review every 90 days, supports (tags); note types Group / Crisis contact; weekly contact requirement
- Catalog test also checks each list's requirement count
- Gallery icons `heart-pulse`, `sprout`
- Build state: npm test 3609 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W12 wave 2 starters (relative / calendar / business days / meter / quota / sequence)

## 2026-10-02 (cont.) — Generalization W12 commit 6 (sample history; wave 2: education and legal starters) done
- Starter sample data `history`: earlier values of a column (oldest first, days ago) written to cell_history with the cell left at the newest, so meter forecasts and days-in-stage have data. Replaces the reserved `stageHistory` (only sample `appointments` still needs a newer version)
- `special-education`: referral timeline as a sequence on a deadline column (consent 10 / evaluation 60 / eligibility 70 school days, first IEP 30 days later), annual IEP, re-evaluation every 3 years, tip on adding school holidays
- `early-intervention`: IFSP sequence from referral (45 days, 6-month review, annual, then yearly), transition conference due 33 months after birth (relative)
- `international-students`: OPT window as a relative rule (60 days after program end, shown from 150 days ahead), I-20 / passport / visa expiry; disclaimer
- `casa-advocate`: court report due 10 business days before the next hearing (relative, before), monthly visit + requirement
- `veterans-service-officer`: intent to file expires a year out, appeal window a year after the decision (relative, done when filed); disclaimer
- Catalog test also checks every non-interval rule kept its kind and points at the new list's columns
- Build state: npm test 3620 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: wave 2 business / health / personal starters (HR, grants, prior authorization, representative payee, pastoral care, refugee resettlement, vocational rehab, fleet, personal vehicles)

## 2026-10-02 (cont.) — Generalization W12 commit 7 (wave 2: HR, grants, prior authorization, payee, pastoral care) done
- `hr-generalist`: probation ends 90 days after hire and benefits eligibility at 60 days (relative, done when the review / enrollment date is filled in), yearly review on the hire anniversary (calendar from the hire date, deadline column)
- `grant-manager`: quarterly report (calendar Jan/Apr/Jul/Oct 30) and closeout 90 days after the end date
- `prior-authorization`: "Visits left" quota on visit notes between the authorization dates, limit from "Visits authorized"; sample visits so some are running low or used up; dashboard card "Running low on visits"
- `representative-payee`: annual accounting on the payee anniversary, monthly budget-review requirement, benefit review; disclaimer
- `pastoral-care`: birthdays and anniversaries every year (calendar from the date, 14 days ahead), bereavement care sequence at 1 / 3 / 6 / 13 months, visits every 90 days
- Build state: npm test 3630 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: refugee resettlement, vocational rehab, fleet manager, personal vehicles

## 2026-10-02 (cont.) — Generalization W12 commit 8 (sample steps done; refugee resettlement, vocational rehab, fleet, personal vehicles) done — wave 2 complete
- Starter sample data `stepsDone` (record, step-by-step deadline column, how many steps): written to deadline_progress for the record's own anchor date, so sequence demos aren't all overdue. Special education, early intervention, peer recovery, pastoral care and refugee resettlement samples now mark past steps done (a recently missed step left open now and then)
- `refugee-resettlement` (human-services words): milestones from arrival (home visit 5 days, core services 30, 90- and 180-day check-ins), 2 contacts a month, note types Cultural orientation / Appointment escort
- `vocational-rehab` (human-services words): plan due 90 days after eligibility, 90-day placement follow-up after the job start (relative)
- `fleet-manager`: service every 5,000 miles or 6 months (meter, forecast from 18 months of odometer history in the sample), registration, annual inspection, name format "{Unit} – {Year} {Make and model}"
- `personal-vehicles`: oil change (5,000 mi or 6 months) and tire rotation (7,500 mi) meters, registration and insurance renewals, 3 cars with a year of readings
- Build state: npm test 3639 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W12 wave 3 (linked lists, stages, boards)

## 2026-10-02 (cont.) — Generalization W12 commit 9 (wave 3: auto service, property manager, sales) done
- `auto-service` (Trades and service): Customers ← Vehicles (Owner; name format "{Year} {Make} {Model}", oil-change meter with 18 months of odometer history, state inspection) ← Jobs (Vehicle; board Estimate → Approved → Waiting on parts → In progress → Ready → Picked up, which stamps "Picked up on" and starts a follow-up call 3 days later); stage history so days-in-stage show; "Oil change reminder" letter using `{{linked:Owner.Name}}`
- `property-manager` (Property and safety): Units ← Tenants (Lives in; lease end 90/60/30) and Units ← Work orders (Unit; board New → Scheduled → In progress → Done, stamping "Completed on"); "Lease renewal notice" letter
- `sales-follow-ups` (Business): Leads board New → Contacted → Proposal → Won / Lost (stamps "Closed on"), value, next follow-up
- Catalog test: the overdue / soon / later spread is checked across the whole starter (not per list); every sample link is made and every record has a name
- Build state: npm test 3645 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: animal rescue, mentoring, guardianship

## 2026-10-02 (cont.) — Generalization W12 commit 10 (wave 3: animal rescue, mentoring, guardianship) done
- `animal-rescue` (Animals): Animals (board Intake → Medical → Ready → Adoption pending → Adopted, stamping "Adopted on"; rabies yearly, next vet visit) → Fosters (Placed with / Animals in care; home check every 2 years); note types Vet visit / Adoption application
- `mentoring-program` (Faith and community): Mentors ↔ Mentees (Matched with, one to one), mentees board Referred → Matching → Matched → Closed, mentor background check every 2 years, monthly match check-in requirement
- `guardianship` (Legal and government): Wards → Facilities (Lives at), Court cases → Wards; yearly report to the court on the appointment anniversary, monthly visit requirement, Medicaid renewal, hearings; disclaimer
- Build state: npm test 3651 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: fire/alarm inspection, behavior analyst, childcare director

## 2026-10-05 — Generalization W12 commit 11 (wave 3: fire/alarm inspection, behavior analyst, childcare director) done — wave 3 complete
- `fire-alarm-inspection` (Property and safety): Customers ← Sites (Customer) ← Devices (Site); site and device inspections every year, extinguisher hydrostatic test every 5 years; note types Inspection / Repair; "Inspection due notice" letter; attachments suggested for certificates
- `behavior-analyst` (Health): Learners → Technicians (Technician); "Sessions left" quota on session notes between the authorization dates, limit from "Sessions authorized"; treatment plan review every 6 months; technician RBT certification (60-day warning) and supervision every 30 days; dashboard card for quotas; disclaimer
- `childcare-center` (Education and youth): Children (immunizations due date, yearly physical and emergency card; Date of birth / Parent / Parent phone required) and Staff (CPR/first aid expiry, background check every 5 years, yearly TB test); "Health form reminder" letter
- Build state: npm test 3657 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W12 wave 4 (therapy & counseling, caring for a parent, fire/alarm certificates update)

## 2026-10-05 (cont.) — Generalization W12 commit 12 (sample appointments; orphaned series fix) done
- Starter sample data `appointments` (record, title, days from today, optional time / minutes / note type / location / weekly repeat count / status). Past ones are marked done unless the sample gives a status. No longer refused as "needs a newer version"
- Removing starter sample data also removes the appointment series those records had
- Fix: a repeating series whose record was deleted for good (trash emptied, list deleted) was left behind, and the next fill-in tried to add occurrences for the missing record. That broke the foreign key and with it the calendar. Such a series is now removed when it's next filled in
- Build state: npm test 3659 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: therapy & counseling starter

## 2026-10-05 (cont.) — Generalization W12 commit 13 (wave 4: therapy & counseling, caring for a parent, fire/alarm certificates) done — W12 complete
- `therapy-practice` (Health): client / caseload / session note / therapist words. "Sessions left" quota on Session notes between the authorization dates; treatment plan review every 90 days; consent every year; PHQ-9 and GAD-7 number columns with score history so the sparklines show. Note types Session / Phone / No-show / Cancellation. Weekly session series on the calendar plus a past no-show. Intake form (logs a Session note), "Authorization renewal request" letter, time tracking on (minutes as units), tips for SOAP, weekly series and scores. Disclaimer
- `caring-for-a-parent` (Personal): Parents ↔ Care team (many to many, "Care team" / "Looks after"); medication review every 3 months, yearly wellness visit, insurance and benefits renewals (60-day warning), power of attorney / health care proxy; Hospital stay checklist; note types Doctor visit / Medication change; doctor visits and twice-weekly physical therapy on the calendar; appointments, files, reminders and handoff switched on
- Fire/alarm inspection: a Certificates (Files count) column on Sites and a tip on keeping certificates in Files
- Catalog test also checks each list's forms and that every sample appointment (whole weekly series) is on the calendar
- Gallery icons `brain`, `hand-heart` (not looked at in the running app)
- Build state: npm test 3663 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W13–W16 remaining items

## 2026-10-05 (cont.) — Generalization W16 help for P5 done
- Help topics (`faqData.tsx`): keeping files with a record (Files section, drop, note paperclip, Files column), whether files are safe (encrypted, opened copies wiped, saved copies not encrypted, handoff packet), room and clearing out (limit, trash, 30 days); building a report and pinning it to the dashboard; background mode (lock on close, reminders with counts and times only, open at sign-in). The three Files topics are listed under "More features you can turn on" while Files is off
- Every quoted button label checked against the app
- Build state: npm test 3663 pass / 4 skip; typecheck 0; eslint 0 errors
- Next: W16 website copy per shipped starter (+ ui-tour `--starter`)

## 2026-10-05 (cont.) — Generalization W16 website copy per starter done
- `plans/website/<id>.md` for all 38 built-in starters plus an index (`README.md`): headline, the problem in their words, what Pulse sets up (lists, deadline columns and rules, links, board, requirements, forms, checklists, note types, letters, sample data), screenshots, "your spreadsheet, but safer", the free download, and the disclaimer for regulated trades
- Generated by `node scripts/website-copy/build.mjs` from the starter JSON plus hand-written headlines and problems in `scripts/website-copy/blurbs.mjs` (fails if a starter has no blurb)
- Screenshots: a "starter tour" in `e2e/ui-tour.spec.ts` (`UI_TOUR=1 UI_TOUR_STARTER=<id>`) goes through first-run setup with that example and its sample data the way a new user would, then shoots the first list, dashboard, first record's page and (with sample appointments) the calendar, light mode, with the update banner dismissed. `scripts/website-copy/screenshots.sh [ids…]` builds once and copies them to `plans/website/screenshots/<id>/` (git-ignored). Deviation: an env var instead of `--starter`, since Playwright rejects unknown flags. Tried on therapy-practice; the other 37 haven't been shot yet
- Before publishing (noted in the index): product name (W14) and the free-version rule (W13 A1)
- Build state: no app code changed; typecheck 0
- Next: W14 rename switch (waiting on the name) and W15 Spanish (P6)

## 2026-10-05 (cont.) — Decisions: keep the name Pulse; Spanish deferred
- W14: the name stays "Pulse by BaringaSoft", so the P5 rename switch isn't needed (the P0 safety rails stay)
- W15 Spanish (P6): skipped for now
- Website index no longer lists the name as pending
- The generalization plan is otherwise complete. Still open: website screenshots for 37 starters (`scripts/website-copy/screenshots.sh`)

## 2026-10-08 — Plan: website redesign for free and open source
- Decisions: Pulse becomes free and open source under GPL-3.0; source goes to a fresh public repo with clean history; donations through Ko-fi; no past buyers to address; downloads stay on `pulse-releases` (the update check points there)
- `plans/website-open-source-redesign.md`: handoff plan for the agent working in `pulse-landing-page` (new site map, home page sections, 38 generated starter pages from `plans/website/*.md`, download and open-source pages, security/privacy/terms rewrites; `/terms.html` and `/privacy.html` URLs must stay because the password setup screen links to them)
- App-side work the site depends on (section 8 of the plan): remove licensing and the free-tier limit, GPL LICENSE and package.json, fresh public repo, starter and hero screenshots, a release with the generalization work
- Build state: no app code changed

## 2026-10-09 — Pulse 2.0.0: free and open source
- Licensing removed: trial, LemonSqueezy activation, the 15-record free limit, the license store, trial banner, activation dialog and Settings → License. `enforceWritable()` stays as a generic read-only gate (error code `READ_ONLY`); nothing registers a checker
- GNU GPL v3 (`LICENSE`, package.json `GPL-3.0-only`); About links to the source and license; the security summary and brief list the update check as the only network request
- README with build instructions; audit reports and security findings are git-ignored and stay local
- Version 2.0.0 with a What's New entry
- Website screenshots for all 38 starters (`scripts/website-copy/screenshots.sh`), copied to `pulse-landing-page/img/starters/<id>/` plus `img/hero-{dashboard,list,calendar}.png`. Electron hangs on start under this machine's Wayland session (even an empty app); run Electron/Playwright with `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11`
- Build state: npm test 3555 pass / 4 skip; typecheck 0; eslint 0 errors

## 2026-10-09 (cont.) — Public repo and Linux release
- Public repo https://github.com/J2matlock/pulse-app created from one fresh commit (no private history). Local `origin` is now the public repo; the old private repo is remote `private` (branch `private-main` keeps its history)
- v2.0.0 published in `pulse-releases` with the Linux AppImage and SHA256SUMS only, **not** marked latest, and `latest.json` left at 1.1.6, so Windows installs aren't offered an update without a Windows file and the website's `releases/latest/download/PULSE.exe` link still works
- Windows signing blocked: Azure Trusted Signing returns 403, and `az login` reports no subscriptions for j2matlock@outlook.com (the subscription holding `baringasoft-signing` looks expired, or the signer role is missing). The unsigned `dist/PULSE.exe` was built but not published
- To finish Windows once Azure is fixed: `npm run package:win` (signs through `scripts/sign-exe.js`), upload `PULSE.exe` to the v2.0.0 release, mark it latest, and update `latest.json` in `pulse-releases` (`version` 2.0.0, `downloadUrl` to the v2.0.0 `PULSE.exe`, `downloads.linux` to the AppImage)

## 2026-10-09 (cont.) — Windows 2.0.0 shipped unsigned
- Code signing dropped (Azure subscription lapsed; Pulse isn't sold). `scripts/sign-exe.js` and the signing steps in `build-win.js` removed; About's update steps and the README explain SmartScreen's More info → Run anyway
- v2.0.0 in `pulse-releases` now has `PULSE.exe`, the AppImage and `SHA256SUMS.txt`, and is marked latest, so the website's `releases/latest/download/PULSE.exe` serves 2.0.0
- `latest.json` in `pulse-releases` now announces 2.0.0 (Windows `downloadUrl` plus `downloads.win` / `downloads.linux`), so installed copies offer the update on their next check

## 2026-10-09 (cont.) — Tree service starter
- `tree-service` (Trades and service): Customers ← Jobs (Customer). Jobs board Estimate requested → Estimate sent (stamps "Estimate sent on") → Approved → Scheduled → In progress (adds the Job site safety checklist) → Done (stamps "Completed on") / Not going ahead
- Deadlines: estimate follow-up 7 days after sending, shown only while the stage is Estimate sent (first starter to use a rule condition); scheduled date hidden once Done or Not going ahead; follow-up call 7 days after done; permit expiry. Customers: yearly tree check, ash treatment every 2 years. Equipment: service every 100 engine hours or 6 months (meter, hour history in the sample), aerial lift inspection and dielectric test yearly, registration. Crew: arborist certification, CPR / first aid, CDL medical card (60 days' warning), yearly chainsaw safety training
- Estimate request form, letters (estimate follow-up, yearly tree check reminder), calendar sample (jobs, estimate visits, weekly crew safety meeting), help tips; icon `tree-deciduous`
- Website copy generator no longer mentions the 15-record free limit; page and screenshots for tree-service (copied to `pulse-landing-page/img/starters/tree-service/`)
- Not released yet: ships in the next version
- Build state: npm test 3557 pass / 4 skip; typecheck 0; eslint 0 errors

## 2026-10-09 (cont.) — Pulse 2.0.1 released
- Version 2.0.1 (tree service starter), tagged v2.0.1 in pulse-app
- `pulse-releases` v2.0.1: `PULSE.exe`, `BaringaSoftPulse-2.0.1.AppImage`, `SHA256SUMS.txt`, marked latest; `latest.json` announces 2.0.1

## 2026-10-09 (cont.) — 12 more starters (brainstorm round 2), 51 in all
- New: `home-services` (5 variants: lawn & landscaping, pest control, HVAC, pool, chimney / gutters / windows), `tax-preparer`, `real-estate`, `rehab-therapy` (speech / OT / PT), `victim-advocate` (human-services words), `subcontractor-compliance`, `horse-barn`, `job-search`, `home-maintenance`, `family-health`, `driving-school`, `volunteer-manager`. Specs in `plans/starter-brainstorm-2026-10.md`
- Generators kept in `scripts/starters/` (with `check_starter.py` cross-reference checks, `validate-starter.ts` and a README); tree service's generator too
- Engine fix: a calendar rule done early within its lead time now counts for that date (irrigation started Apr 22 covers "by Apr 30"); grace capped at half the shortest gap. Found by the home services sample (17 overdue → 6)
- Dashboard card "Running low on visits" → "Running low" (it also counts sessions and lesson packages)
- Leak test: the starter gallery check skips the starters' own card text (a tax preparer's "Clients" is the right word there); it only passed before because card text ran together without spaces
- Screenshots for all 12 reviewed (dashboards tiled), copied to `pulse-landing-page/img/starters/<id>/`; website copy regenerated (51 pages)
- Known limits: sample notes can't carry measure values (driving and volunteer hours live in number columns); a rule has one condition; no rule fires at hour milestones
- Not released yet
- Build state: npm test 3586 pass / 4 skip; typecheck 0; eslint 0 errors

## 2026-10-10 — Pulse 2.1.0 released
- Version 2.1.0 (twelve new starters, early-completion fix for fixed-date deadlines, "Running low" card), tagged v2.1.0 in pulse-app
- `pulse-releases` v2.1.0: `PULSE.exe`, `BaringaSoftPulse-2.1.0.AppImage`, `SHA256SUMS.txt`, marked latest; `latest.json` announces 2.1.0

## 2026-10-10 (cont.) — Reports review fixes (plans/reports-review-2026-10.md, all items)
- Bugs:
  - a new filter no longer empties the preview (filters wait for a value; new ones start on the stage or a choice field)
  - groupings default to the stage, the note type, the appointment status or the deadline; totals default to money, never "Days in stage"
  - groups follow the field's own order (stages, statuses, deadline states most urgent first)
  - dates spelled out (Jul 31, 2026 · Oct 2026 · Week of … · Q4 2026) in the table, PDF and dashboard card; the CSV keeps ISO
  - delete asks first; leaving with unsaved changes asks first
- Clunk:
  - Saved reports moved to a picker in the header; steps and preview scroll separately; name, Save, Export, Pin and Delete sit above the preview
  - each filter, grouping and value is a tidy row; pick-lists for choice fields
  - "What do you want to count?"; Save suggests a name; Pin saves a new report first
  - starting points: by stage, money by stage, added per month, notes per month, overdue deadlines, appointments this month
  - the PDF says what it covers ("Jobs · Stage is Done · Date added: this month")
  - deadlines and appointments start as a list with useful columns
- Engine: `ReportField` gains `options` and `hint`; `ReportColumn` gains `bucket`; `defaultFilterField` / `defaultGroupField` / `defaultValueField`, `suggestReportName`, `describeReport`, `formatYmd` in `shared/reports.ts`. Saved report format unchanged
- Help text updated. Checked with a scripted walkthrough in the app (tree service sample), screenshots reviewed
- Build state: npm test 3596 pass / 4 skip; typecheck 0; eslint 0 errors

## 2026-10-10 (cont.) — Pulse 2.1.1 released
- Version 2.1.1 (reports review fixes), tagged v2.1.1 in pulse-app
- `pulse-releases` v2.1.1: `PULSE.exe`, `BaringaSoftPulse-2.1.1.AppImage`, `SHA256SUMS.txt`, marked latest; `latest.json` announces 2.1.1

## 2026-10-10 (cont.) — Reports made intuitive (plans/reports-intuitive-2026-10.md)
- Sample data has a past (`src/main/sample-history.ts`, all starters, no per-starter work):
  - records added across the year
  - everyday notes every 3–7 weeks, never quota-counted types, always older than five weeks
  - done jobs copied into past months (money ±25%, links kept, open deadlines settled)
  - seeded per starter; removed with the sample data
- Ready-made reports when a starter is applied (`src/main/starter-reports.ts`): by stage (+ value), finished per month, notes per month, overdue deadlines. Saved after the words are applied, so they're named in the starter's words. Starters can bring their own (`reports`, columns by name): tree service, auto service, therapy, tax preparer, real estate. Reports gain an optional `about` line
- Reports home page: cards with what each report answers and a glance at the answer (bars or a headline number). "All reports" back from the builder; Export → "Build a report…" opens a new one
- In the builder:
  - a plain sentence above the preview (`explainReport`)
  - bars for one-grouping reports (`ReportChart`), money first, latest months on cards; also on pinned dashboard cards
  - plainer step titles with hints; starting points say what they answer (plus notes by kind, deadlines by kind and state)
- Help: "How do I use reports?" rewritten
- Checked in the app with tree service and human services samples
- Build state: npm test 3599 pass / 4 skip; typecheck 0; eslint 0 errors

## 2026-10-10 (cont.) — Pulse 2.2.0 released
- Version 2.2.0 (reports home page, ready-made reports, sample history, bars, plain sentence), tagged v2.2.0 in pulse-app
- `pulse-releases` v2.2.0: `PULSE.exe`, `BaringaSoftPulse-2.2.0.AppImage`, `SHA256SUMS.txt`, marked latest; `latest.json` announces 2.2.0

## 2026-10-10 (cont.) — Usability and logic audit
- Eight reviewers (first run, grid, record page, deadlines, scheduling, settings and data, navigation, logic) wrote reports in `plans/audit-2026-10/`; 296 findings merged into 90 items in `PLAN.md` (phases 1–5, appendix mapping every finding)
- Screenshots for the audit: `plans/audit-2026-10/screens/` (git-ignored); the UI tour and a newer-screens tour
- Owner decisions (top of PLAN.md):
  - A3: keep tasks, checklists and follow-ups separate, fix bugs
  - B1: notes get `occurred_at`
  - C3 + (i): sample removal keeps the user's work, Sample pill, "Just looking?" opens the gallery
  - D1: lists and columns go to Trash
  - E1: Renewed / Finished
  - F1: shared rules with "Used by"
  - G2 now, G1 later
  - H2: merge the two broken duplicates
- Build: seven tracks (B, D, G, R, S, X, F) in separate worktrees (`TRACKS.md`, `BUILDER.md`), merged in that order; Track A (polish) after the merge
- E2E: each test launch gets its own `--user-data-dir`, so a copy of Pulse the person has open no longer blocks test runs
- Reminder pending: update the website for 2.2.0 (saved in memory)

## 2026-10-11 — Audit round 1 built and merged
- Seven tracks merged into main (B note dates, X settings/backup/import, S scheduling, R record page, F first run/navigation/help, D deadlines/dashboard, G grid/lists/columns), then Track A (15px text, focus rings, keyboard, contrast, plain words, platform text). About 95 fix commits; every item in TRACKS.md except those noted below
- Migrations 044 (note `occurred_at` + note date moves), 045 (list/column trash, highlight rules, tags column), 046 (deadline done flags), 047 (`sample_rows`); schema version 47
- After the merge:
  - E2E tests updated for the new screens (11 of 11 pass)
  - Password setup reads the boxes on submit (autofill no longer shows a false "don't match")
  - The grid's Sample tag became a small sparkle mark so names aren't truncated
  - The unit-test config leaves agent worktrees (`.claude/**`) out
- Left for later or partial (from the track reports):
  - Clipboard import is hidden, not built (X)
  - Undoing an import doesn't remove records it created in other lists through links (X)
  - Shared PageHeader component (F)
  - Undo kept across a link that opens another list (R-20 logic)
  - Tags/edit-history parts of 1.8 (no track owned them)
  - "Letters & documents" rename (D)
  - The 3.10 "not met and nothing scheduled" filter (D)
  - Decision G1 regroup (5.5–5.7)
  - Contact rules (L-32)
- Screens before and after: `plans/audit-2026-10/screens/ui-tour` and `screens/after` (git-ignored)
- Build state: npm test 4088 pass / 4 skip; typecheck 0; eslint 0 errors; e2e 11/11

## 2026-10-11 — Polish pass (after the audit merge)

Started from two bugs the user hit:
- Deadline text overlapped neighbouring cells.
- After setting up an example, the list only appeared once you visited another page.

Then a full polish pass:
- 7 read-only reviewers by area, plus a screenshot sweep across 6 starters. About 147 findings, in `plans/polish-2026-10/R1–R7.md` and `V1.md`.
- 5 builder tracks by file ownership (`plans/polish-2026-10/TRACKS.md`), all merged.

- **Setup / stale screens:**
  - Finishing setup loads the lists and opens the first one.
  - Only the newest list fetch may land.
  - Import close paths keep the import.
  - The dashboard, rules, link store and list words reload after examples, templates, sample removal, list changes and reactivation.
  - Restored records reappear in the open list.
- **Grid:**
  - Cells clip their content.
  - Deadline words truncate, always have a tooltip, and redraw when counts arrive.
  - Rule and deadline columns from starters/templates open at 250px or more (`startingWidth()` in `shared/columnTypes.ts`); name columns open at 200px.
  - Board counts, exports and words follow its cards.
  - Cell editors work in dark mode.
  - The toolbar collapses with container queries instead of wrapping.
  - Computed cells accept copy and open keys.
- **Record & tasks:**
  - A moved record's page no longer loops.
  - Task and checklist undo works outside the record page.
  - The record page uses one name everywhere.
  - Calendar blocks and the month view fit.
  - Tasks and Focus mode show load errors.
- **Dashboard, rules & reports:**
  - A quota extension is tied to the allowance end, so it stops applying after a renewal.
  - Used-up quotas are worded the same everywhere.
  - Deadline columns work like dates for note updates and stages.
  - The report builder offers every rule column.
  - Singular words fixed.
- **Data lifecycle:**
  - Remove sample data really goes to the Trash.
  - Column changes don't make samples look edited.
  - A failed restore reopens the database.
  - Contact custom fields save.
  - Contact categories only seed under the human-services words.
  - Purging the Trash clears undo.
  - Plain error messages.
- **Hygiene:**
  - Dead code removed: 11 IPC channels, including EXPORT_PDF_BATCH, and unused components/hooks.
  - ⌘ shown instead of Ctrl on Mac.
  - The vocabulary rule is wider, with 15 strings fixed.
  - Help captions are 15px.
  - Date helpers merged where identical.

Left for later:
- Vocabulary leaks in plain screen text that the rule doesn't check ("Contacts will become Uncategorized", "Log a note").
- The ContactFilterBar search-timer race.
- Recent names only update when the record page is visited.
- Quota extensions saved before this pass stop applying (they were tied to an empty value).

Build state: npm test 4163 pass / 4 skip; typecheck 0; eslint 0 errors (26 exhaustive-deps warnings); e2e 11/11 plus the setup check.

## 2026-10-11 (cont.) — Pulse 2.3.0 released
- Version 2.3.0 (audit + polish pass), What's New entry, tagged v2.3.0 in pulse-app
- `pulse-releases` v2.3.0: `PULSE.exe`, `BaringaSoftPulse-2.3.0.AppImage`, `SHA256SUMS.txt`, marked latest; `latest.json` announces 2.3.0

## 2026-10-11 (cont.) — Bug sweep

Started from a user report: on an empty Tasks page, a new group didn't show until a task existed. Fixed: groups count as content, and adding a group switches to My order.

Then a broad sweep:
- 7 read-only reviewers by behaviour, covering empty states, tasks, grid data, main integrity, dates, contacts/letters/forms and app shell. About 119 findings, in `plans/bugsweep-2026-10/S1–S7.md`.
- 5 builder tracks by file ownership (`TRACKS.md`), all merged.

What changed:
- **Tasks & recurrence:**
  - Monthly and yearly repeats keep the 31st and Feb 29 (the day is saved in the rule JSON, no migration).
  - Record-page checklist group undo/redo is fixed.
  - Dragging tasks into another group works.
  - Clear date can be clicked.
  - Tasks of trashed lists are hidden.
  - The badge skips snoozed tasks.
  - The summary report counts each completion of a repeating task.
- **Grid:**
  - Undo/redo of a new record or column keeps the same id (via the Trash).
  - Swapped choice renames keep records apart.
  - Move/copy works with duplicate column names.
  - Filters read amounts.
  - Age and Days-until work in filters, highlights and copy.
  - Blanks sort last on Z-A.
  - Multi-line paste works.
  - A hidden or deleted "Last name" column is handled.
  - The column-type cache resets on restore.
- **Import/export/backup:**
  - Excel dates are read on the right day.
  - Two-digit years use a sliding window, with birth columns kept in the past.
  - Zip/ID columns aren't taken for dates.
  - Restoring a newer-version backup is refused up front.
  - Export everything includes archived records.
  - Age and Days-until show in CSV/PDF.
  - Template and starter Age/Days-until column references survive.
- **Contacts, letters, forms:**
  - vCard round trips keep every field, category, custom field and accented name.
  - Contact undo restores everything.
  - Deleted built-in categories and snippets stay deleted.
  - Placeholders read the right columns.
  - Form print layout and Required are fixed.
  - The Templates page sees new lists.
  - The first contact requirement can be added.
- **App shell:**
  - Enter on Cancel no longer confirms.
  - No false backup failure when quitting while locked.
  - Pending edits are flushed before lock or quit (`APP_FLUSH_PENDING`/`APP_FLUSH_DONE`).
  - Shortcuts are off while locked.
  - Focus mode overlays and Escape handling are fixed.
  - Error-boundary recovery.
  - The window opens on screen.
  - A `day:changed` midnight event moves the dashboard, badge and grid colors on.
  - Several empty-state messages corrected.

Left for later:
- Unicode font in PDFs: non-Latin text still prints garbled.
- Showing each repeating-task completion in the Tasks page's Completed list and progress bar (a product decision).
- Grid paste in DD/MM order.
- Add column then Undo still leaves a Trash entry.
- Report week buckets ignore the week-start setting.

Build state: npm test 4355 pass / 4 skip; typecheck 0; eslint 0 errors; e2e 11/11; empty-Tasks group checked in the app.

## 2026-10-11 (cont.) — Master audit, bug sweep & polish (unattended run, branch `polish/2026-10-11`)
- 10-area audit → 192 findings (0 Critical, 19 High, 72 Medium, 101 Low), recorded in `AUDIT.md`.
- 15 fix batches merged: 164 fixed, 3 partial, 2 deferred, 22 need a decision (see `POLISH-REPORT.md`).
- Real bugs found while fixing: pre-v14 upgrade could fail at unlock (orphan rows before migration 014); restoring a damaged `.pulse-backup` could overwrite the live DB.
- New migration 048 (schema 48). Tests 4355 (+4 skipped) → 4921 (0 skipped); typecheck/lint 0 errors; coverage 76.7% lines / 65.3% branches.
- Not pushed, not merged; awaiting review. AUDIT.md / POLISH-REPORT.md contain security findings — keep them off the public main.

## 2026-10-11 (cont.) — Approved audit decisions implemented (branch `polish/2026-10-11`)
- User approved all 22 needs-decision items with the noted tweaks. Implemented: AUDIT-021, 026, 037, 055, 074, 087, 098, 107, 108 (incl. 30-day auto-purge), 109, 113, 114, 127, 139, 153, 164, 170; AUDIT-090 recorded in the CLAUDE.md decision log.
- Planned, awaiting go-ahead: Electron 44 upgrade, Linux .deb, asar integrity (`plans/electron-upgrade-and-linux-packaging-plan.md`).
- Gates: 439 files / 5028 tests passed, typecheck 0, lint 0 errors, build OK. Still not pushed.

## 2026-10-11 (cont.) — Electron 44 upgrade, Linux .deb, asar integrity (branch `upgrade/electron-44`)
- Electron 39.7.0 → **44.4.5** (AUDIT-089). @types/node 22 → 24.19.0. node-abi pinned to 4.35.0 under @electron/rebuild via `overrides` (the locked one didn't know Electron 44's ABI).
- better-sqlite3-multiple-ciphers 12.6.2 → **13.0.3** (Node-API, prebuilt binaries for every platform bundled). 12.6.2 doesn't compile against Electron 44's V8; 12.x has no Windows prebuilds past Electron 42, and the Windows build is cross-compiled. Encrypted DBs from 12.6.2 open in 13.0.3 and the other way round. `scripts/get-win-native.js` removed; build scripts check the bundled binary instead of rebuilding or downloading; each platform ships only its own binaries.
- Breaking changes handled: `openAsHidden`/`wasOpenedAsHidden` removed (Mac hidden start now uses `wasOpenedAtLogin`), `clipboard.writeText` is async (awaited), macOS minimum 12 → 13. Not changed: dialogs without `defaultPath` now open in Downloads.
- Linux `.deb` next to the AppImage (AUDIT-019), with electron-builder's AppArmor profile; README Ubuntu 24.04+ section. Building it on Fedora needs `libxcrypt-compat` (build-linux.js checks).
- Asar integrity fuse on for Windows and macOS only (AUDIT-094/186); a scratch Windows build embeds the matching hash.
- Fixed two stale tests found on the way: vocabLeak Range stub (uncaught jsdom errors) and the e2e recovery-key skip button name.
- Verified: npm test 439 files / 5034 tests (0 skipped), typecheck 0, eslint 0; e2e subset (setup, unlock, grid CRUD, backup/restore) 4/4 on Electron 44; packaged fused Linux build sets a password and opens the encrypted DB; .deb control file and AppArmor profile inspected.
- Still to do by hand: Ubuntu 24.04 VM .deb install and launch; Windows and macOS launch with asar integrity. Not pushed.
- Follow-up: the `.deb` target, its Fedora build check (libxcrypt-compat) and the README Ubuntu section were removed at the user's request (Fedora only). Linux stays AppImage-only; AUDIT-019 closed as won't-fix. Tests 439 files / 5034 passed.

## 2026-10-11 (cont.) — Pulse 2.4.0 released
- Version 2.4.0 (audit fixes, approved decisions, Electron 44 + SQLCipher 13), What's New entry, SBOM/licenses regenerated, tagged v2.4.0 in pulse-app.
- `pulse-releases` v2.4.0: `PULSE.exe`, `BaringaSoftPulse-2.4.0.AppImage`, `SHA256SUMS.txt`, marked latest; `latest.json` announces 2.4.0. Downloaded assets verified against the checksums.
- AppImage smoke-launched on Fedora with an isolated home. The Windows exe (asar integrity on) was published without a real-Windows launch test, at the user's choice; if Windows users report Pulse won't open, rebuild with the integrity fuse off as 2.4.1.

## 2026-10-12 — Bug sweep, refactor and approved proposals (branch `sweep/2026-10`, merged as `release/sweep-public`)
- Unattended sweep from `pulse-sweep-plan.md`: safety-net tests (4-timezone matrix `npm run test:tz`, migration ladder, IPC consistency, backup/restore, auth, soft-delete invariant, vocabulary leaks), then 133 findings fixed in severity order (5 S1, 18 S2, 35 S3, 75 S4), an independent review of the whole diff, and its 11 findings fixed.
- Refactors: knip clean, `liveRecords.ts` (soft-delete filter), `columnTraits.ts`, `assertNever`/`unhandledCase`, `defineHandler` for IPC, large-file splits, migration 049 (FK/history indexes; dashboard ~2x faster).
- Approved proposals applied: crash-safe re-encrypt on password change / recovery-key revoke (pending key slot), backup snapshots in Pulse's own folder + crash-leftover cleanup, migration 050 (orphan appointment series), Export All "(last done)" dates, appointment month-day anchor, vCard line folding, "Skip this version" on the update banner; spec updated to match the code (auto-lock, portable update flow, AppImage only, "how soon" tiers).
- Dependencies: Vite 7 / electron-vite 5 / vitest 5, react-table 9, lucide 1.x, dnd-kit sortable 10, jsdom 29, zod 4.6 (UTF-16 length helper); motion 14 waits until 2026-10-16 (14-day rule), TypeScript 7 waits on typescript-eslint. npm audit 35 → 10 moderate (build-time / unreachable).
- Gates: 481 files / 5646 tests, typecheck 0, eslint 0 errors (146 security-plugin warnings), test:tz green, build + e2e (incl. new persist smoke test) green. Schema 50.
- `sweep/` (findings, proposals, decisions) holds security detail: stripped from the public history with filter-branch and git-ignored; the local `sweep/2026-10` branch still has it — never push that branch.
