# Performance Notes — CaseConnect Pulse

Deliberate decisions and mitigations that audits should not re-flag.

## Startup Flow
- `initDatabase()` is a **no-op** — it checks `isPasswordSetup()` and returns immediately. The actual `openDatabase()` runs inside `AUTH_VERIFY_PASSWORD` / `AUTH_SETUP_PASSWORD` IPC handlers, after the window and lock screen are already visible. Window shows instantly on launch.

## Crypto
- PBKDF2 uses **async** `crypto.pbkdf2()` (callback-based), NOT `pbkdf2Sync`. The main event loop is not blocked during key derivation. Changed from sync in Feb 2026.

## React Rendering
- **All views** are `React.lazy()` in App.tsx — TipTap (ScratchPad), DashboardView, ContactsView, etc. None are in the initial bundle.
- **SortableRow** has a custom `React.memo` comparator that prevents cascade re-renders. When one cell edits, only that row re-renders. Inline callbacks and format calculations inside SortableRow are scoped to one component instance, not 200.
- **CellDisplay** receives pre-parsed `parsedConfig` prop — no JSON.parse per render. Parent computes `parsedColumnConfigs` via useMemo.
- **GridToolbar** does NOT subscribe to `rows` — acuity point sum is isolated in `AcuityPointsBadge` component with its own store subscription.
- **hasAnyHighlightRules** precomputed once in DataGrid via `useMemo` and passed as boolean prop to SortableRow — avoids per-row array spread + `.some()` across all column configs.
- **rowFormatStyle** early-exits the column loop when no highlight rules exist (no cellFormats and no column conditionalFormat with highlightRow).
- **useShallow** applied to ~30+ store subscriptions across contacts, settings, undo, alert, task, profile stores, GridStatusFooter, ProfilePrintLayout, GlobalTaskDialog.
- **Grid search** is debounced 150ms in TopBar.tsx via setTimeout/clearTimeout useEffect.
- **Dashboard search** is debounced 150ms via setTimeout.
- Virtual scrolling overscan=20 with fixed 44px row height — stable and appropriate for target scale.

## Data Operations
- **PDF batch export** yields via `setImmediate` between each client render — does not block main process. Grid/columns/nameColId hoisted outside the per-client loop (shared context) to avoid redundant queries.
- **ProfileView snippets** hoisted — SNIPPET_GET_ALL fetched once in ProfileView and passed as prop to CaseLog + ScratchPad (was fetched twice independently).
- **applySavedView** uses batch IPC `COLUMN_BATCH_UPDATE_VISIBILITY` — one transaction for all column visibility changes instead of N sequential IPC calls.
- **CSV/Excel import** uses 50-row transaction chunks with `setImmediate` yield + progress IPC callbacks.
- **Backup Layer 1** (auto-backup on close) uses async `copyFile()` — non-blocking.
- **Dashboard deadline queries** have `LIMIT 500 ORDER BY date ASC` to prevent unbounded result sets.
- **Dashboard follow-up queries** have `LIMIT 300` to prevent unbounded result sets.
- **getInteractions()** has `LIMIT 500` to prevent unbounded provider interaction loads.
- **CSV/Excel import** hoists `db.prepare()` outside the row loop — statements compiled once, not per-row.
- **CSV/Excel import preview** uses async `readFile()` (not readFileSync) — main thread not blocked during file read.
- **TASK_GET_ALL** has `LIMIT 500` to prevent unbounded growth from completed tasks.
- **TASK_GET_HISTORY** has `LIMIT 50` to prevent unbounded history loads.

## SQLite
- **Pivot query pattern** eliminates N+1 for grid loads — one query loads entire grid.
- **Statement cache** (LRU, max 128) avoids recompilation of common queries.
- **WAL mode** + `synchronous=NORMAL` + 32MB cache_size configured.
- **Cell edit debounce**: 300ms on frontend before IPC write.
- **display_name column** on rows with triggers — eliminates fullNameSubquery() overhead (14 call sites removed).
- **Compound indexes** cover all hot query paths (see migrations 013, 015, 017, 018, 019, 020, 021).
- **Lookup indexes** on row_tags(row_id), saved_filters(grid_id), saved_views(grid_id), provider_client_links(provider_id) (migration 019).
- **Partial index** on case_log(follow_up_date) for follow-up dashboard queries — only indexes active, non-voided follow-ups (migration 020).
- **Partial index** on checklist_items for CHECKLIST_GET_URGENT — only indexes urgent/incomplete/non-archived items (migration 021).
- **Pivot query cached** via `cachedStmt` in GRID_GET — avoids recompiling the pivot SQL on every grid switch.
- **Dashboard queries cached** via `cachedStmt` — all dashboard sub-queries (including DASHBOARD_GET_COMPLETED and DASHBOARD_GET_ARCHIVED) use statement cache.
- **GRID_GET_ALL** and **CELL_FORMAT_GET_FOR_GRID** cached via `cachedStmt` — avoids recompilation on grid list and cell format loads.
- **loadGridList() deduplicated** — GridView guards with `if (!gridListLoaded)` to avoid firing duplicate IPC when Sidebar already loaded the list.
- **Trash auto-purge** (30 days) and **cell history pruning** (50 per cell + 90 days) run deferred 15s after unlock.
- **incremental_vacuum(200)** runs deferred 15s after unlock — reclaims freed pages so DB file doesn't grow monotonically.
- **High-frequency SELECT * replaced**: GRID_GET_ALL and CASE_LOG_GET use explicit column lists. Remaining ~22 SELECT * are in low-frequency handlers only.

## Known Accepted Tradeoffs
- **AdmZip `writeZip()` is synchronous** — blocks main process during backup compression. Acceptable at current DB sizes (<50MB). Should switch to streaming compression (archiver/zlib) if databases regularly exceed 50MB.
- **OFFSET pagination** on case_log — acceptable under 2,000 entries per client. Switch to keyset pagination if logs grow beyond that.
- **Client-side filtering** in DataGrid — acceptable under 500 rows per grid. Move to SQL-side WHERE clauses if grids exceed 1,000 rows.
- **SELECT \*** in ~22 low-frequency IPC handlers — marginal overhead, not worth changing unless profiling shows it matters.
- **rowMap not in SortableRow memo comparator** — cross-row conditional format highlighting may be briefly stale after a cell edit until the next grid reload/sort/filter. The alternative (including rowMap) would defeat the memo entirely since rowMap changes on every edit.
- **Store subscriptions in non-grid views** (FocusModeView, TasksView, TemplateManagerView) — these subscribe to `grids` from gridStore without `useShallow`. Causes wasted re-renders on cell edits but has zero user-visible impact since these views aren't active during grid editing. Low priority.
