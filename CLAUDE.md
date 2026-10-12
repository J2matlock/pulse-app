NOTE: plans/BUILD_PLAN.md has the explicit development plan, and plans/Pulse_Complete_Spec.md has further info if you have any questions. 

# Pulse — Claude Code Project Guide

## What This Is
Pulse (Pulse by BaringaSoft) is a free, open-source (GPL-3.0), offline-first Electron desktop app for tracking people and things with deadlines. It started as caseload management. It replaces Excel spreadsheets for care coordinators, social workers, case managers, and similar professionals who manage caseloads of humans with recurring deadlines.

**Read the full spec before implementing anything**: `plans/Pulse_Complete_Spec.md`

The spec is the source of truth. It contains exact SQL schemas, exact file paths, exact IPC channel names, exact UI layouts, and exact interaction behaviors. When in doubt, check the spec — the answer is almost certainly there.

## Tech Stack (check package.json for actual installed versions)

**IMPORTANT FOR AI SESSIONS:** Some of these versions may be newer than your training data. If you don't know an API or behavior for a specific version, use WebSearch to look it up rather than guessing from older knowledge. Always check `package.json` for the actual installed versions before making assumptions.

**Current versions (as of 2026-02-28):**
- **Electron 44** (Node 24, Chromium 152) + **React 19** + **TypeScript 5.9** (strict mode)
- **Vite 7** via **electron-vite 5** for build tooling (plus @vitejs/plugin-react 5; tests on **vitest 5**)
- **SQLite** via `better-sqlite3-multiple-ciphers` 13 (Node-API, prebuilt binaries bundled for every platform; encrypted local database — NOT `@journeyapps/sqlcipher`)
- **Tailwind CSS 4** with CSS-first `@theme` config (no tailwind.config.js, no autoprefixer)
- **electron-builder 26** for packaging
- **electron-store 8** for app preferences (outside the encrypted DB)
- **jspdf** + **jspdf-autotable** for PDF generation
- **tiptap 3** for rich text (scrap notes)
- **cmdk** for command palette
- **exceljs** for Excel import (replaced xlsx/SheetJS due to unpatched CVEs)
- **papaparse** for CSV import
- **zustand 5** for state management
- **react-router-dom 7** for routing
- **@dnd-kit** (core 6 + sortable 8) for drag-and-drop
- **motion 12** (framer-motion successor) for animations

All planned upgrades complete. See `UPGRADE_PLAN.md` for history.

## Project Structure (~600 source files under src/)
```
src/
  main/                    # Electron main process
    index.ts               # App entry, window management, auto-lock
    database.ts            # SQLCipher connection, migration runner, statement cache
    migration-list.ts      # Ordered MIGRATIONS list + applyMigration (register new migrations here, not in database.ts)
    auth.ts                # Password verification, key wrapping, recovery keys
    private-files.ts       # Owner-only modes for the stores (0600) and data folder (0700)
    backup.ts              # Three-layer backup system + key envelope / restore on a new computer
    logger.ts              # Structured logging
    contacts.ts            # Provider CRUD + vCard parse/emit
    contacts-vcard.ts      # vCard import/export
    contacts-categories.ts # Category management
    contacts-interactions.ts # Interaction logging
    attachments.ts         # Attachment store (sniffType, cleanFileName, keepExtension)
    attachment-files.ts    # Opening (temp copy) and saving attachments
    templates.ts           # Checklist + letter templates
    import.ts              # Excel/CSV import
    export.ts              # Export orchestrator
    export-csv.ts          # CSV export
    export-pdf.ts          # PDF + batch print
    export-supervisor.ts   # Supervisor report export
    ipc-handlers.ts        # IPC registration (delegates to ipc/ modules)
    ipc/                   # 36 files: one ipc-<domain>.ts per domain (grid, row, cell, auth, caselog,
                           #   tasks, checklists, contacts, dashboard, deadlines, alerts, export, app,
                           #   settings, onboarding, appointments, attachments, forms, reports, links, …)
      ipc-define.ts        # defineHandler / handlersFor / idArg / textArg — the pattern for new handlers
      ipc-utils.ts         # secureWrap, ok/fail, enforceWritable, assertSafePath, validation helpers
      ipc-auth.ts, ipc-app.ts  # stay on plain secureWrap (state checks before arguments)
    migrations/            # 50 sequential migrations (001–050, schema version 50)
  renderer/                # React frontend
    App.tsx                # Root component, routing, auth gating
    main.tsx               # React entry point
    views/                 # Top-level views (17 files + subdirectories)
      GridView.tsx         # Main grid with virtual scrolling
      ProfileView.tsx      # Client profile (scratch pad, case log, checklist, files, links)
      DashboardView.tsx    # Priority list, deadlines, completions
      ContactsView.tsx     # Two-panel provider directory
      TasksView.tsx        # Caseload tasks with recurrence
      CalendarView.tsx     # Appointments and deadlines calendar
      ReportsView.tsx      # Saved reports
      SettingsView.tsx     # Tabbed settings (appearance, security, backup, data)
      FocusModeView.tsx    # Distraction-free client review
      SnippetsView.tsx     # Snippet library CRUD
      TemplateManagerView.tsx   # Checklist template editor
      LetterTemplateView.tsx    # Letter template editor (tiptap)
      TrashView.tsx        # Soft-deleted rows (restore/purge)
      LockScreenView.tsx   # Password entry on launch
      SetupView.tsx        # First-run setup (example / spreadsheet / blank)
      HelpView.tsx         # Help/keyboard shortcuts
    components/            # Reusable components (~210 files, 17 subdirectories)
      grid/       (54)     # DataGrid, SortableRow, CellEditor, FilterBar, BulkActionBar, ImportWizard
      shared/     (57)     # ConfirmDialog, CommandPalette, ErrorBoundary, UndoHistoryPanel, TourOverlay
      profile/    (28)     # ScratchPad, CaseLog, Checklist, GridDataSummary
      settings/   (19)     # AppearanceSection, SecuritySection, BackupSection
      contacts/   (10)     # ContactForm, ContactCard, ContactDetail, CategoryManager
      alerts/ (9), reports/ (7), layout/ (6), calendar/ (5), forms/ (4), and 7 smaller folders
    stores/                # Zustand stores and their slices (23 files)
      gridStore.ts         # Grid state; slices gridRow/gridCellEdit/gridColumn/gridFilter/gridFormat/gridAcuity/gridCustomGroup (D-048: each slice owns its state)
      contactsStore.ts     # Provider directory (+ contactsActivitySlice, contactsUndo)
      profileStore.ts, taskStore.ts, settingsStore.ts, alertStore.ts, workspaceStore.ts, …
      undoStore.ts         # Undo/redo stack (100 items, side effects)
    hooks/     (31)        # useGridSelection, useAutoLock, useGlobalKeyboard, useVocab, useFocusTrap, etc.
    utils/     (33)        # deadlineCalc, snippetExpander, filterMatch, safeInvoke, dueTiers
  shared/                  # Types and constants shared between main and renderer
    ipc-channels.ts        # IPC channel name constants (single source of truth)
    ipc-contract.ts        # IPC request/response type definitions
    types.ts               # Shared TypeScript types (Row, Column, AlertRule, etc.)
    constants.ts           # App-wide constants
    query-limits.ts        # Pagination/limit constants
    dates.ts               # localDateString / parseDbTimestamp / shortDate — ALWAYS use for calendar dates and SQLite timestamps
    liveRecords.ts         # liveRow / notTrashedRow / archivedRow / liveGrid — the soft-delete SQL filters
    columnTraits.ts        # COLUMN_TYPES + COLUMN_TRAITS: what each column type can do
    assertNever.ts         # assertNever / unhandledCase exhaustiveness helpers
    deadlineEngine.ts      # Deadline states (the only place they're computed)
  preload/
    index.ts               # Preload API bridge (context isolation)
```

## Claude Code Tooling (`.claude/`)
Skills (`.claude/skills/`): `/verify` (typecheck touched files + lint + tests — run before calling work done), `/new-migration`, `/ipc-channel` (all three Claude can invoke on its own), and user-invoked audits `/security-audit`, `/backup-integrity`, `/accessibility-audit`, `/onboarding-ux`, `/pre-release`, `/deps-upgrade`. For diff-level review use the built-in `/code-review` and `/security-review`.

Hooks (`.claude/settings.json`): block direct vitest runs; after each Edit/Write, reject migrations that don't write `schema_version` or add columns without a `table_info` guard, and report eslint errors in the edited file.

## Architecture Rules

### Database
- **All DB access happens in the main process.** The renderer NEVER touches SQLite directly.
- Communication is via IPC channels defined in `src/shared/ipc-channels.ts`.
- Use the **pivot query pattern** for grid loads (see spec Section 4 "Performance-Critical Query Patterns"). NEVER do N+1 queries — one query loads the entire grid.
- All write operations use transactions.
- Use prepared statements for repeated queries.
- **Soft-delete filters come from `src/shared/liveRecords.ts`** (`liveRow('r')`, `notTrashedRow`, `archivedRow`, `liveGrid` for records of a list in the Trash). Don't hand-write `is_active = 1` / `deleted_at IS NULL` in read queries; only the UPDATE/DELETE guards in the trash/restore writers stay hand-written (D-040). `tests/soft-delete-invariant.test.ts` checks ~40 read paths and the exports for trashed data; `tests/soft-delete-writers.test.ts` checks every trash writer sets both columns. A new read path or export goes into the invariant test.
- **Column-type behaviour lives in `src/shared/columnTraits.ts`**: `COLUMN_TYPES` (the `ColumnType` union comes from it) and `COLUMN_TRAITS: Record<ColumnType, …>`. A new column type gets a traits row (the compiler insists); don't add another hand-written list of types elsewhere.

### IPC Pattern
```typescript
// Main process: defineHandler (src/main/ipc/ipc-define.ts) wraps secureWrap
// (sender check, humanized errors), then the read-only gate for writes, then
// one Zod schema per argument (first failing argument's message is the answer).
const define = handlersFor('ipc-tags')
define(IPC.TAG_CREATE, [
  idArg(),                                              // 'Invalid ID' by default
  textArg('Invalid tag name', { min: 1, max: 100 }),
  textArg('Invalid tag color', { max: 30 }),
], (gridId, name, color) => {
  // ... business logic (args are typed from the schemas) ...
  return ok(result)
}, { write: true })                                     // write: true = enforceWritable() first

// Renderer: invoke via safeInvoke (typed, error-handled)
const res = await safeInvoke(IPC.TAG_CREATE, gridId, name, color)
if (res.ok) { /* use res.data */ }
```

IPC handlers are split across `src/main/ipc/ipc-*.ts` files by domain and registered via `ipc-handlers.ts`. New handlers use `defineHandler` (helpers: `idArg`, `textArg(msg, { min, max, notBlank })`, `idListArg`, `schemaArg(schema, msg)`); checks that need the database or several arguments together stay in the body. Only ipc-auth, ipc-app, the three in `index.ts` and `BACKUP_RESTORE_OTHER` stay on plain `secureWrap` (D-044–D-047). Messages in schemas are scanned by `tests/renderer/friendlyError.test.ts` like `fail('…')` literals, and `tests/ipc-consistency.test.ts` checks every channel has a contract entry and exactly one handler.

### State Management
- **Zustand** for client-side state. One store per major feature domain.
- Grid data loads fresh from DB via IPC on every view switch — don't cache stale grid data.
- Optimistic updates for cell edits (update UI immediately, write to DB async, rollback on failure).

### Security
- Database encrypted with SQLCipher using a random 256-bit key
- Key is wrapped by the user's password via PBKDF2 (key wrapping pattern — see spec Section 4)
- `electron-store` holds wrapped keys, NEVER the raw DB key or password
- Context isolation ON, node integration OFF, sandbox ON
- All file paths from user input validated via `assertSafePath()` in `ipc-utils.ts`
- IPC handlers use `secureWrap()` which validates sender frame origin and catches errors
- Write operations guarded by `enforceWritable()` to prevent writes to locked/closed DB
- `connect-src 'self'` CSP — renderer cannot make external network requests
- All permissions denied (camera, mic, geolocation, etc.)
- Passwords >72 bytes pre-hashed with SHA-256 before bcrypt (standard prehash pattern)
- Account lockout after failed password attempts
- Recovery key system for password reset
- Auto-lock: default 15 minutes, max 120, no "disabled" (0 means 120), no "pause auto-lock" (see Decision Log; the spec matches since 2026-10-12)
- Every electron-store opens through `src/main/private-files.ts` (`configFileMode: 0o600`, chmodded 0600 on open); the data folder is 0700. A new store or data file must go through it (`tests/private-file-modes.test.ts`).
- `APP_OPEN_EXTERNAL` opens only Pulse's own https pages (`isAppLink`: `https://github.com/J2matlock/…`, `https://www.baringasoft.com/…`, no userinfo or port). Don't widen it to arbitrary URLs. `assertSafePath()` also refuses a credential/browser-profile deny list even when the path came from a dialog.
- Attachments: stored type comes from the bytes (`sniffType`), not the name. Opening writes a copy with a random name and the sniffed ending to `<data>/tmp-open/` (0600, removed after 10 minutes and on lock, quit and startup). Names go through `cleanFileName` (no device names, trailing dots, direction/zero-width marks). A rename keeps a new ending only if it's a kept type (pdf, images, Office, OpenDocument, txt, csv, rtf); anything else gets the old ending added ("run.bat.txt", D-021). "Save a copy" suggests the sniffed ending.

## UI/UX Rules — READ THESE CAREFULLY

This app is for social workers and care coordinators, many of whom are not tech-savvy. Every UI decision should prioritize clarity over cleverness.

- **Font size: 15px minimum.** Grid cells, body text, buttons — all 15px. NOT 13px.
- **Click targets: 44px minimum height.** Buttons, rows, interactive elements.
- **Focus rings: 3px solid**, clearly visible. This is an accessibility requirement.
- **Grid borders: chunky and visible.** Use gray-300+ for gridlines, not hairline borders.
- **Error messages: descriptive and human.** "We couldn't save your changes — try again" not "SQLITE_CONSTRAINT error"
- **No jargon in the UI.** "Clients" not "rows." "Columns" not "fields." "Deadlines" not "alerts."
- **Never hard-code record/list/note/contact words** ("client", "caseload", "case note", "provider", "acuity"). Use the vocabulary layer: `useVocab()` in components (`useVocab(null)` for screens spanning lists, `useVocabByList()` for mixed rows), `wordNow()` in stores, `{record:many}` tokens + `useVocab().f` for static text, `word()` / `vocabFor()` in main. The eslint vocab rule (`eslint/vocab-rule.mjs`) checks JSX text and props (incl. `content`, `message`, `description`, `confirmLabel`, `emptyText`), renderer `.ts` (toast, setError) and `src/main` (`fail()`, error classes, PDF text; migrations excluded); `tests/renderer/vocabStaticText.test.tsx` guards static text, and `tests/vocab-leak-main.test.ts` / `tests/vocab-leak-exports.test.ts` main-process messages and exports. Tests that check text call `setWords()` (renderer) or `setDbWords()` (main).
- **Color system for deadlines**: green → yellow → orange → red → pulsing red (see spec Section 7.2 for exact thresholds)
- **Dark mode**: full support, slate-900 backgrounds, same alert colors
- **System font stack** — no custom fonts to load

## Build Phases

Built sequentially. Each phase produced a working, testable build. See `plans/BUILD_PLAN.md` for the full checkbox tracker.

| Phase | Status | Summary |
|-|-|-|
| 1 — Foundation & Core Grid | COMPLETE | Electron shell, SQLCipher DB, auth/lock screen, grid with virtual scrolling, inline editing, column/row CRUD, sorting, search, sidebar, backup, keyboard nav, themes |
| 2 — Intelligence | COMPLETE | Dashboard (priority list, week/month views, completions), alert rules, conditional formatting, morning briefing |
| 3 — Profiles & Workflow | COMPLETE | Profile view (scratch pad, case log, activity timeline, contact info, documents), snippets, caseload tasks with recurrence |
| 4 — Templates & Data | COMPLETE | Export (CSV, PDF, batch print, supervisor report), import (Excel/CSV), snippet library, checklist templates, letter templates |
| 5 — Polish & Launch | ~COMPLETE | Command palette, undo/redo, filters, saved views, grouping, color labels, onboarding wizard, focus mode, trash/soft-delete, acuity levels, help view. Deferred: auto-update is a check + banner only (no in-app download/install); automated accessibility tests exist (22 files in `tests/renderer/a11y/`, 9 run axe-core) but the manual WCAG AA audit isn't done |
| 6 — Garden | REMOVED | Gamification layer — removed from scope |
| 7 — Contacts | ~COMPLETE | Provider directory, categories, custom fields, interaction log, client linking, vCard import/export. Deferred: drag-to-reorder of contact categories and custom fields (`position` exists, no reorder channel or UI); right-click menus in Contacts (the grid has them) |

**Current state:** Feature-complete. 50 migrations, schema version 50 (031 removed Reference Board and Documents; 032 case-note edit history; 033 calendar-month deadline rules; 034 monthly contact requirements; 035 time and mileage on notes; 036 workspace words and feature switches; 037 note types, custom measures column, requirement periods; 038 deadline engine v2; 039 linked records; 040 appointments; 041 forms; 042 attachments; 043 saved reports; 044 note occurred-at; 045 list Trash; 046 deadline done dates; 047 sample rows; 048 appointment note index; 049 foreign-key child indexes; 050 orphan appointment-series sweep). 5636 tests in 480 files passing (0 skipped) as of 2026-10-12. Remaining work is polish and accessibility. Since 2026-10-08 Pulse is free and open source (GPL-3.0): the trial, license activation and the 15-record free limit are gone. Public repo: https://github.com/J2matlock/pulse-app.

**Quality gates (2026-10-12):** `npm run typecheck` = 0 errors and `npx eslint src --quiet` = 0 errors. `npx eslint src` shows 146 warnings, all from eslint-plugin-security (122 non-literal fs paths, 17 unsafe regex, 4 non-literal regexp, 3 timing). react-hooks/exhaustive-deps shows 0 warnings, but src has 37 inline `eslint-disable` comments, unchanged since before the 2026-10 sweep: 31 exhaustive-deps, 4 non-literal fs paths in templates.ts/starters.ts, 2 no-explicit-any in ipc-utils.ts's handler types. There is no `@ts-ignore`, `@ts-expect-error` or `as any` in src. Don't add any of these: fix the dependency list or the type instead, and keep new exhaustive-deps warnings at 0. Keep errors at zero — the build (esbuild) does NOT typecheck, so run `/verify`, and `npm run gate` (typecheck + eslint --quiet + full tests, `scripts/gate.sh`) before a commit.

### Database Note
Uses `better-sqlite3-multiple-ciphers` (NOT `@journeyapps/sqlcipher`). See Decision Log below for rationale. Since 13.x (2026-10-11) it is Node-API: the same bundled binary loads in system Node and in Electron, so `electron-rebuild` and the ABI steps in `scripts/run-tests.sh` are now no-ops (kept, harmless).

## Code Style
- TypeScript strict mode, no `any` types except where genuinely unavoidable
- Functional React components with hooks, no class components
- Named exports, not default exports (except for views)
- Error handling: try/catch around all IPC calls, all DB operations, all file system operations
- Comments: explain WHY, not WHAT. The code should be readable without comments explaining obvious logic.

## Testing Approach
- **ALWAYS run tests via `npm test`, NEVER vitest directly** (a PreToolUse hook blocks it). `scripts/run-tests.sh` does the ABI dance: (1) `node-gyp rebuild` for system Node ABI, (2) vitest, (3) `electron-rebuild` back to Electron ABI (steps 1 and 3 are no-ops since the Node-API module, 2026-10-11). Args pass through: `npm test -- tests/auth.test.ts -t "lockout"`.
- Test suite: 477 files, 5571 tests, ~90 s. Typecheck: `npm run typecheck`. Lint: `npm run lint`.
- `npm run gate` (`scripts/gate.sh`): typecheck + `eslint src --quiet` + full tests. Run it before every commit; it must be green.
- `npm run test:tz`: the whole suite in UTC, America/Los_Angeles, Pacific/Auckland and Asia/Kolkata (`scripts/test-tz.sh`). Run it after any date/time change; tests that build "today" or timestamps must use local dates (local noon, not N × 24 hours), or they fail across a DST change.
- `npm run perf`: main-process and DataGrid benchmarks on a seeded 5,000-record workspace (`vitest.perf.config.ts`, `tests/perf/`); not part of `npm test`. Use `seedWorkspace()` from `tests/seedWorkspace.ts` for large test data.
- `npm run test:e2e` (Playwright; on this machine run with `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11`): includes `e2e/smoke-persist.spec.ts` (edit survives quit, relaunch and unlock).
- **Source-scanning tests read files by path**: e.g. `tests/shortcuts.test.ts` exemptions, the TourOverlay target scan (`tourSteps.tsx`), `tests/renderer/a11y/clickTargets.test.ts` (reads `SortableRow.tsx`), `tests/soft-delete-writers.test.ts`, `tests/migration-guards.test.ts`, `tests/vocab-leak-main.test.ts`, `tests/renderer/friendlyError.test.ts`. When you move or split code, update the paths those tests name in the same commit, or they pass vacuously or fail.
- Invariant tests to keep extending, not working around: `tests/migration-ladder.test.ts` (every start version upgrades to latest), `tests/ipc-consistency.test.ts`, the soft-delete tests above, `tests/exhaustiveness.test.ts`, the vocab leak tests.
- Test with real-world data volumes: 200+ clients, 20+ columns
- Test keyboard navigation thoroughly — many users prefer keyboard to mouse
- Test with 15px font size — if something looks cramped, the spacing is wrong
- Test the lock screen flow: lock → unlock → verify state is preserved
- Test backup restoration: backup → modify data → restore → verify original data

## Common Pitfalls to Avoid
- **Don't use `toISOString().slice(0, 10)` for a calendar date** — it's UTC and shifts days. Use `localDateString()`; parse SQLite `datetime('now')` values with `parseDbTimestamp()` (both in `src/shared/dates.ts`).
- **Don't use 13px fonts.** The spec says 15px. It means 15px.
- **Don't import `src/main/vocab.ts` from anything `database.ts` imports** (contacts.ts, auth.ts, backup.ts, ipc-utils.ts). The cycle makes database-mocking tests hit the real database. `tests/vocab-import-graph.test.ts` walks every runtime import from `database.ts` and fails if `vocab.ts` is reachable.
- **Don't render the grid with N+1 queries.** Use the pivot query from the spec.
- **Don't store the raw DB key anywhere.** Only wrapped versions in electron-store.
- **Don't skip error handling on IPC calls.** Every invoke needs a try/catch.
- **Don't use thin/hairline borders on the grid.** Chunky, visible borders.
- **Don't auto-restart for updates.** Ever.
- **Don't add network requests beyond the update check.** This is an offline app.
- **After `npm install` or dependency changes, rebuild native modules for Electron:** `npx electron-rebuild -f -w better-sqlite3-multiple-ciphers`. With the Node-API module (13.x) this is a no-op, but if the app launches and password setup/unlock silently fails, a native module built for the wrong ABI is still the first thing to check. `electron-rebuild` needs a `node-abi` that knows the Electron version; it's pinned under `overrides` in package.json, so bump it when bumping Electron.
- **Every migration MUST update `schema_version`.** End every migration with `db.prepare("UPDATE app_meta SET value = '<N>' WHERE key = 'schema_version'").run()`. Without this, the migration re-runs on every launch, non-idempotent statements (like `ALTER TABLE ADD COLUMN`) fail, `openDatabase()` dies, and the app looks like it rejects the password. Guard `ALTER TABLE ADD COLUMN` with a `pragma_table_info` check since it has no `IF NOT EXISTS`. Register the migration in `src/main/migration-list.ts` (not `database.ts`); `tests/helpers.ts` derives `LATEST_SCHEMA_VERSION` from that list. Never edit a shipped migration — add a new one.

## Context Efficiency

### Subagent Discipline

**Context-aware delegation:**
 - Under ~50k context: prefer inline work for tasks under ~5 tool calls.
 - Over ~50k context: prefer subagents for self-contained tasks, even simple ones — the per-call token tax on large contexts adds up fast.

When using subagents, include output rules: "Final response under 2000 characters. List outcomes, not process."

### File Reading
Read files with purpose. Before reading a file, know what you're looking for.
Use Grep to locate relevant sections before reading entire large files.
Never re-read a file you've already read in this session.
For files over 500 lines, use offset/limit to read only the relevant section.

### Responses
Don't echo back file contents you just read — the user can see them.
Don't narrate tool calls ("Let me read the file..." / "Now I'll edit..."). Just do it.
Keep explanations proportional to complexity. Simple changes need one sentence, not three paragraphs.

**Tables — STRICT RULES (apply everywhere, always):**
- Markdown tables: use minimum separator (`|-|-|`). Never pad with repeated hyphens (`|---|---|`).
- NEVER use box-drawing / ASCII-art tables with characters like `┌`, `┬`, `─`, `│`, `└`, `┘`, `├`, `┤`, `┼`. These are completely banned.
- No exceptions. Not for "clarity", not for alignment, not for terminal output.

## Decision Log
Ids such as D-###, F-###, Q-### and A##-## (and "sweep plan" / "sweep Phase" section numbers) in comments and below point at the 2026-10 sweep and earlier audit logs, which stay local and aren't in the public repo. The reason is always written next to the id, so nothing here depends on those files.

When implementation deviates from the spec, document it here:

| Date | Decision | Reason |
|-|-|-|
| 2026-02-17 | Use `better-sqlite3-multiple-ciphers` instead of `@journeyapps/sqlcipher` | `@journeyapps/sqlcipher` prebuilt binary links against `libcrypto.so.1.1` (OpenSSL 1.1.x); Fedora 43 ships OpenSSL 3.x only, no compat package available. `better-sqlite3-multiple-ciphers` bundles SQLCipher statically (no system OpenSSL dependency), passes full validation, and has the same synchronous API. |
| 2026-02-27 | Replace `xlsx` (SheetJS) with `exceljs` | xlsx 0.18.5 has unpatched prototype pollution (CVE) and ReDoS. SheetJS CE is unmaintained. exceljs is actively maintained, async API. |
| 2026-02-27 | Upgrade to Electron 39, NOT 40 (SUPERSEDED 2026-10-11, see below) | Electron 40 uses Node 24 (bleeding edge). Electron 39 uses Node 22 LTS (stable, better native module compat). Supported until May 2026. |
| 2026-10-11 | Upgrade to Electron 44 (44.4.5), replacing the "39, not 40" decision | Node 24 is an LTS line now, and Electron 39 went out of support on 2026-05-05 (unpatched Chromium). 44 is supported until 2027-03-02; re-bump every 1–2 majors. macOS minimum is now 13. Dialogs without a `defaultPath` open in Downloads (Electron 43). |
| 2026-10-11 | better-sqlite3-multiple-ciphers 12.6.2 → 13.0.3 (Node-API) | 12.6.2 doesn't compile against Electron 44's V8, and 12.x has no prebuilds past Electron 42, which the Windows build (cross-compiled from Linux) needs. 13.x bundles a Node-API binary per platform; each build ships only its own (`build.<platform>.files`). Checked that databases written by 12.6.2 open in 13.0.3 and the other way round. Linux prebuilt needs glibc 2.35+. |
| 2026-10-11 | Linux ships as an AppImage only (no .deb) | The maintainer builds and uses Fedora; a .deb (for Ubuntu 24.04's AppArmor sandbox rules) was built and then removed because it added a Fedora build dependency (libxcrypt-compat for fpm) for a format nobody here uses. AUDIT-019 closed as won't-fix; revisit if Ubuntu users report the AppImage won't start. |
| 2026-02-27 | Keep `@dnd-kit` at core 6 + sortable 8 | dnd-kit v10 (`@dnd-kit/react`) is beta (0.3.2), complete API rewrite. Wait for 1.0 stable. |
| 2026-02-27 | Keep `electron-store` at v8 | v9+ is ESM-only, requires main process ESM migration throughout. Not worth the effort. |
| 2026-10-12 | Vite 7 toolchain: vite 7.3, electron-vite 5.0, @vitejs/plugin-react 5.2, vitest + coverage-v8 5.0 (replaces "electron-vite 3 + Vite 6", 2026-02-27) | electron-vite 3.1 had gone 18 months without a release. The old blocker is gone: Tailwind runs through `@tailwindcss/postcss`, which has no Vite peer. The ceiling is now electron-vite 5, which accepts Vite 5–7, not 8; plugin-react 6 needs Vite 8, so it stays on 5.x. Main and preload externalize dependencies by default now (`externalizeDepsPlugin` dropped from the config); output is unchanged CommonJS (byte-identical main/preload bundles). plugin-react 5 ships types only via `exports`, so the config files typecheck under `tsconfig.config.json` (bundler resolution), a third pass in `npm run typecheck`. |
| 2026-02-28 | Tailwind 4 upgrade: `.btn` as `@utility` | Tailwind 4 `@apply` only resolves Tailwind utilities, not custom CSS classes. Converted `.btn` to `@utility btn {}` so `.btn-primary/secondary/danger` can `@apply btn`. |
| 2026-10-09 | No code signing | The Azure Trusted Signing subscription lapsed and Pulse isn't sold anymore. `scripts/sign-exe.js` and the signing steps in `build-win.js` were removed; releases ship a `SHA256SUMS.txt` instead. |
| 2026-10-08 | Free and open source under GPL-3.0; licensing removed | No trial, no license key, no record limit. `enforceWritable()` stays as a generic read-only gate (error code `READ_ONLY`), with nothing registering a checker. Audit and security-finding reports in `plans/` stay local (git-ignored) and aren't in the public repo. |
| 2026-10-01 | Built-in snippets, letter templates and list templates are seeded only under the human-services words | They're written for social work; a workspace with other words (e.g. a car shop) would see "Met with client at residence". Found by the W01 leak test. |
| 2026-10-11 | Accept `buffers@0.1.1` (no license) as a transitive production dependency | Pulled in by exceljs → unzipper 0.10 → binary. It declares no license and its upstream repo (substack/node-buffers) is gone, so there's nothing to check against. It's tiny, unmaintained-but-stable code on the import path only; overriding it with a fork costs more upkeep than the risk is worth. Revisit if exceljs drops unzipper 0.10 or a licensed fork appears (AUDIT-090). |
| 2026-10-11 | Auto-lock: default 15 minutes, max 120, no "disabled" option (0 is treated as 120); no "pause auto-lock" toggle | Spec says default 30, 0 = disabled, and a per-session pause (Ctrl+Shift+L). Kept stricter on purpose: an app holding client records shouldn't be able to stay unlocked indefinitely. Changing it loosens a security control (sweep D-015). Spec updated to match on 2026-10-12 (sweep S-1, S-2). |
| 2026-10-11 | Updates are check + banner only (no `electron-updater`, no in-app download or install) | Pulse ships a Windows portable .exe and a Linux AppImage (the .dmg needs a Mac host, and nothing is code-signed), which is spec 7.13's portable path: the banner links to the download page instead of updating in place. No beta channel. Spec 7.13 rewritten to this flow on 2026-10-12 (sweep S-3). |
| 2026-10-12 | Update banner has "Skip this version" (sweep S-4) | Built as the spec asked: the skipped version is kept in `pulse-prefs.json` (outside the database) via `app:update-skip` / `app:update-skipped-get`; the launch check doesn't show it, a newer version does. "Remind me later" hides it for the session only (the spec's 3 days was dropped). Settings → About's manual check still reports a skipped version and can stop skipping it. |
| 2026-10-12 | Migration 049 adds indexes on `record_links` from/to, `cell_history(column_id, row_id, id)` and `column_id` on six per-cell tables | Deadline loads (dashboard, briefing) about 215 → 115 ms at 5,000 × 40; the cost is index upkeep, so Empty Trash of 500 records goes about 365 → 425 ms. Dashboard runs on every visit, Empty Trash rarely. No covering cells index for the pivot (it would double the cells index) (sweep D-050). |
| 2026-10-12 | zod 4.6.5 with string lengths in UTF-16 units (replaces "hold zod at 4.4.3") | zod 4.5+ counts string `.min()/.max()/.length()` in code points, not UTF-16 units, which would loosen every length limit for text with emoji. Never put those on a `z.string()`; use `.check(textLength({ min, max }, message))` from `src/shared/textLength.ts`, which counts `String.length` like the renderer's `maxLength` (textArg uses it). `tests/textLength.test.ts` fails on any `z.string()…max(` chain in src; `tests/ipc-define.test.ts` pins the units (sweep D-053, P-011). |
| 2026-10-12 | Dependency bumps take the newest release that has been on npm for at least 14 days | Guards against a compromised release in its first days; majors go through a written proposal, not a sweep (sweep D-052). |
| 2026-10-12 | "Change password" and "Revoke recovery key" can also re-encrypt the database with a new key (the spec says the key never changes) | A plain change still only re-wraps. With the option, an old password or revoked recovery key plus an old backup stops opening today's data. Crash-safe: pending credential slot → rekey → promote, and unlock tries current then pending (`src/main/key-switch.ts`). Old backups still open with the old credentials; pre-switch local auto-backups no longer restore on this install (sweep P-001, D-059..D-062). |

Communication Style

When I ask a question or for an explanation, give me a plain English answer first. Do not launch into codebase exploration or tool calls unless I ask for investigation. If I want a hypothetical answer, don't run tools.

Workflow Rules

"What's next" = summary only. When I ask "what's next" on the roadmap, produce a brief summary of remaining items and wait for me to choose one. Do NOT start exploring the codebase or creating plans until I explicitly ask you to.
Plan when it's worth it. Small or clear tasks: just do them. Large or open-ended work (new features, audits, reviews, brainstorms): write a short plan to a file in plans/ first and check it with me before implementing — in the same session is fine.
Stay in scope. If I say "do Phase 14 only" or "just this one thing", do NOT proceed to the next phase or expand scope. Stop and ask before moving on.
Always close out. After implementation, ALWAYS commit, push, and update progress.md before ending the session. The commit/push/progress-update is part of every implementation task.

Tech Stack / Conventions

This project uses plain state + Zod safeParse for forms. Do NOT use react-hook-form or other form libraries that aren't already installed.

TypeScript Conventions

When adding new enum values (e.g., AuditAction, NotificationType), ALWAYS search for ALL exhaustive Record/switch/map usages of that enum across the codebase and update every one. Run `npm run typecheck` after to verify.

Unions are defined from `as const` lists (`RULE_KINDS`, `PERIODS`, `COLUMN_TYPES`, `REPORT_SOURCES`, …), and lookup maps are `Record<Union, …>` (not `Record<string, …>` or `Partial<…>`) so a missing member fails to compile. Switches end with a helper from `src/shared/assertNever.ts` (D-036):
- `assertNever(x)` (throws) only where the value can come from code alone;
- `unhandledCase(x)` (compile-time only, returns) followed by the existing safe fallback wherever the value may be stored (DB rows, saved views/reports, settings, a backup from a newer version). Never throw on stored data.

### Internet Connectivity
This is an offline-first app. Only one feature makes network calls:
1. **Update check** — GET to GitHub releases JSON (read-only, no data sent; can be turned off in Settings → About)

It uses an 8-second timeout. The renderer's CSP enforces `connect-src 'self'` — it cannot make external requests. All permissions (camera, mic, geolocation) are denied. No database contents ever leave the app.
