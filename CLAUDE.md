NOTE: plans/BUILD_PLAN.md has the explicit development plan, and plans/Pulse_Complete_Spec.md has further info if you have any questions. 

# Pulse — Claude Code Project Guide

## What This Is
Pulse (Pulse by BaringaSoft) is a free, open-source (GPL-3.0), offline-first Electron desktop app for tracking people and things with deadlines. It started as caseload management. It replaces Excel spreadsheets for care coordinators, social workers, case managers, and similar professionals who manage caseloads of humans with recurring deadlines.

**Read the full spec before implementing anything**: `plans/Pulse_Complete_Spec.md`

The spec is the source of truth. It contains exact SQL schemas, exact file paths, exact IPC channel names, exact UI layouts, and exact interaction behaviors. When in doubt, check the spec — the answer is almost certainly there.

## Tech Stack (check package.json for actual installed versions)

**IMPORTANT FOR AI SESSIONS:** Some of these versions may be newer than your training data. If you don't know an API or behavior for a specific version, use WebSearch to look it up rather than guessing from older knowledge. Always check `package.json` for the actual installed versions before making assumptions.

**Current versions (as of 2026-02-28):**
- **Electron 39** + **React 19** + **TypeScript 5.9** (strict mode)
- **Vite 6** via **electron-vite 3** for build tooling
- **SQLite** via `better-sqlite3-multiple-ciphers` (encrypted local database — NOT `@journeyapps/sqlcipher`)
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

## Project Structure (~270 files)
```
src/
  main/                    # Electron main process
    index.ts               # App entry, window management, auto-lock
    database.ts            # SQLCipher connection, migrations, statement cache
    auth.ts                # Password verification, key wrapping, recovery keys
    backup.ts              # Three-layer backup system + key envelope / restore on a new computer
    logger.ts              # Structured logging
    contacts.ts            # Provider CRUD + vCard parse/emit
    contacts-vcard.ts      # vCard import/export
    contacts-categories.ts # Category management
    contacts-interactions.ts # Interaction logging
    templates.ts           # Checklist + letter templates
    import.ts              # Excel/CSV import
    export.ts              # Export orchestrator
    export-csv.ts          # CSV export
    export-pdf.ts          # PDF + batch print
    export-supervisor.ts   # Supervisor report export
    ipc-handlers.ts        # IPC registration (delegates to ipc/ modules)
    ipc/                   # IPC handlers split by domain (21 files)
      ipc-grid.ts          # Grid CRUD
      ipc-row.ts           # Row CRUD (soft-delete, restore, duplicate)
      ipc-cell.ts          # Cell CRUD + history + formats
      ipc-auth.ts          # Auth (setup, verify, lock, recovery)
      ipc-caselog.ts       # Case log entries
      ipc-tasks.ts         # Caseload tasks + recurrence
      ipc-checklists.ts    # Checklist templates
      ipc-contacts.ts      # Contacts/providers
      ipc-dashboard.ts     # Dashboard aggregations
      ipc-alerts.ts        # Alert rules
      ipc-export.ts        # Export operations
      ipc-app.ts           # App lifecycle, update check, integrity
      ipc-settings.ts      # User preferences
      ipc-onboarding.ts    # First-run wizard
      ipc-saved-views.ts   # Saved grid views
      ipc-saved-filters.ts # Saved filter presets
      ipc-tags.ts          # Row tags
      ipc-acuity.ts        # Acuity levels
      ipc-file-assoc.ts    # File associations
      ipc-compliance.ts    # Monthly contacts, missing info, compliance summary
      ipc-utils.ts         # secureWrap, ok/fail, validation helpers
    migrations/            # 38 sequential migrations (001–038, schema version 38)
  renderer/                # React frontend
    App.tsx                # Root component, routing, auth gating
    main.tsx               # React entry point
    views/                 # Top-level views (16+ files + subdirectories)
      GridView.tsx         # Main grid with virtual scrolling
      ProfileView.tsx      # Client profile (scratch pad, case log, timeline)
      DashboardView.tsx    # Priority list, deadlines, completions
      ContactsView.tsx     # Two-panel provider directory
      TasksView.tsx        # Caseload tasks with recurrence
      SettingsView.tsx     # Tabbed settings (appearance, security, backup, data)
      FocusModeView.tsx    # Distraction-free client review
      SnippetsView.tsx     # Snippet library CRUD
      TemplateManagerView.tsx   # Checklist template editor
      LetterTemplateView.tsx    # Letter template editor (tiptap)
      TrashView.tsx        # Soft-deleted rows (restore/purge)
      LockScreenView.tsx   # Password entry on launch
      SetupView.tsx        # First-run setup (example / spreadsheet / blank)
      HelpView.tsx         # Help/keyboard shortcuts
      dashboard/           # Dashboard sub-components
      tasks/               # Task sub-components
    components/            # Reusable components (109 files, 11 subdirectories)
      grid/       (29)     # DataGrid, SortableRow, CellEditor, FilterBar, BulkActionBar
      shared/     (28)     # ConfirmDialog, CommandPalette, ErrorBoundary, UndoHistoryPanel
      profile/    (17)     # ScratchPad, CaseLog, ActivityTimeline, GridDataSummary
      contacts/   (10)     # ContactForm, ContactCard, ContactDetail, CategoryManager
      settings/   (10)     # AppearanceSection, SecuritySection, BackupSection
      layout/     (4)      # TopBar, Sidebar
      alerts/     (1)      # AlertRuleEditor
      tasks/      (1)      # Task components
    stores/                # Zustand stores (15 files)
      gridStore.ts         # Grid state + slices (column, filter, format, acuity, grouping)
      profileStore.ts      # Profile view state
      taskStore.ts         # Caseload tasks
      contactsStore.ts     # Provider directory
      settingsStore.ts     # User preferences
      undoStore.ts         # Undo/redo stack (100 items, side effects)
      alertStore.ts        # Alert rules
      condFormatStore.ts   # Conditional formatting rules
      backupStatusStore.ts # Backup status
    hooks/     (19)        # useGridSelection, useAutoLock, useGlobalKeyboard, etc.
    utils/     (11)        # deadlineCalc, snippetExpander, filterMatch, safeInvoke
  shared/                  # Types and constants shared between main and renderer
    ipc-channels.ts        # IPC channel name constants (single source of truth)
    ipc-contract.ts        # IPC request/response type definitions
    types.ts               # Shared TypeScript types (Row, Column, AlertRule, etc.)
    constants.ts           # App-wide constants
    query-limits.ts        # Pagination/limit constants
    dates.ts               # localDateString / parseDbTimestamp — ALWAYS use for calendar dates and SQLite timestamps
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

### IPC Pattern
```typescript
// Main process: register handler via secureWrap (validates sender, catches errors)
secureWrap(IPC.ROW_CREATE, 'ipc-row', async (_e, gridId: number, position: number) => {
  const guard = enforceWritable(); if (guard) return guard
  if (!validId(gridId)) return fail('Invalid ID')
  // ... business logic ...
  return ok(result)
})

// Renderer: invoke via safeInvoke (typed, error-handled)
const res = await safeInvoke(IPC.ROW_CREATE, gridId, position)
if (res.ok) { /* use res.data */ }
```

IPC handlers are split across `src/main/ipc/ipc-*.ts` files by domain and registered via `ipc-handlers.ts`.

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

## UI/UX Rules — READ THESE CAREFULLY

This app is for social workers and care coordinators, many of whom are not tech-savvy. Every UI decision should prioritize clarity over cleverness.

- **Font size: 15px minimum.** Grid cells, body text, buttons — all 15px. NOT 13px.
- **Click targets: 44px minimum height.** Buttons, rows, interactive elements.
- **Focus rings: 3px solid**, clearly visible. This is an accessibility requirement.
- **Grid borders: chunky and visible.** Use gray-300+ for gridlines, not hairline borders.
- **Error messages: descriptive and human.** "We couldn't save your changes — try again" not "SQLITE_CONSTRAINT error"
- **No jargon in the UI.** "Clients" not "rows." "Columns" not "fields." "Deadlines" not "alerts."
- **Never hard-code record/list/note/contact words** ("client", "caseload", "case note", "provider", "acuity"). Use the vocabulary layer: `useVocab()` in components (`useVocab(null)` for screens spanning lists, `useVocabByList()` for mixed rows), `wordNow()` in stores, `{record:many}` tokens + `useVocab().f` for static text, `word()` / `vocabFor()` in main. An eslint rule enforces it in JSX; `tests/renderer/vocabStaticText.test.tsx` guards static text. Tests that check text call `setWords()` (renderer) or `setDbWords()` (main).
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
| 5 — Polish & Launch | ~COMPLETE | Command palette, undo/redo, filters, saved views, grouping, color labels, onboarding wizard, focus mode, trash/soft-delete, acuity levels, help view. Deferred: auto-update, accessibility audit |
| 6 — Garden | REMOVED | Gamification layer — removed from scope |
| 7 — Contacts | ~COMPLETE | Provider directory, categories, custom fields, interaction log, client linking, vCard import/export. Deferred: drag-to-reorder categories, right-click menus |

**Current state:** Feature-complete. 43 migrations, schema version 43 (031 removed Reference Board and Documents; 032 case-note edit history; 033 calendar-month deadline rules; 034 monthly contact requirements; 035 time and mileage on notes; 036 workspace words and feature switches; 037 note types, custom measures column, requirement periods; 038 deadline engine v2; 039 linked records; 040 appointments; 041 forms; 042 attachments; 043 saved reports). 3558 tests passing (4 skipped) as of 2026-10-02. Remaining work is polish and accessibility. Since 2026-10-08 Pulse is free and open source (GPL-3.0): the trial, license activation and the 15-record free limit are gone. Public repo: https://github.com/J2matlock/pulse-app.

**Quality gates (2026-09-30):** `npm run typecheck` = 0 errors and `npx eslint src --quiet` = 0 errors (react-hooks plugin installed; ~26 exhaustive-deps warnings remain). Keep both at zero — the build (esbuild) does NOT typecheck, so run `/verify`.

### Database Note
Uses `better-sqlite3-multiple-ciphers` (NOT `@journeyapps/sqlcipher`). See Decision Log below for rationale. After `npm install` or dependency changes, always rebuild: `npx electron-rebuild -f -w better-sqlite3-multiple-ciphers`.

## Code Style
- TypeScript strict mode, no `any` types except where genuinely unavoidable
- Functional React components with hooks, no class components
- Named exports, not default exports (except for views)
- Error handling: try/catch around all IPC calls, all DB operations, all file system operations
- Comments: explain WHY, not WHAT. The code should be readable without comments explaining obvious logic.

## Testing Approach
- **ALWAYS run tests via `npm test`, NEVER vitest directly** (a PreToolUse hook blocks it). `scripts/run-tests.sh` does the ABI dance: (1) `node-gyp rebuild` for system Node ABI, (2) vitest, (3) `electron-rebuild` back to Electron ABI. Args pass through: `npm test -- tests/auth.test.ts -t "lockout"`.
- Test suite: 210 files, ~3013 tests, ~30s + ~1 min of native rebuilds. Typecheck: `npm run typecheck`. Lint: `npm run lint`.
- Test with real-world data volumes: 200+ clients, 20+ columns
- Test keyboard navigation thoroughly — many users prefer keyboard to mouse
- Test with 15px font size — if something looks cramped, the spacing is wrong
- Test the lock screen flow: lock → unlock → verify state is preserved
- Test backup restoration: backup → modify data → restore → verify original data

## Common Pitfalls to Avoid
- **Don't use `toISOString().slice(0, 10)` for a calendar date** — it's UTC and shifts days. Use `localDateString()`; parse SQLite `datetime('now')` values with `parseDbTimestamp()` (both in `src/shared/dates.ts`).
- **Don't use 13px fonts.** The spec says 15px. It means 15px.
- **Don't import `src/main/vocab.ts` from anything `database.ts` imports** (contacts.ts, auth.ts, backup.ts, ipc-utils.ts). The cycle makes database-mocking tests hit the real database.
- **Don't render the grid with N+1 queries.** Use the pivot query from the spec.
- **Don't store the raw DB key anywhere.** Only wrapped versions in electron-store.
- **Don't skip error handling on IPC calls.** Every invoke needs a try/catch.
- **Don't use thin/hairline borders on the grid.** Chunky, visible borders.
- **Don't auto-restart for updates.** Ever.
- **Don't add network requests beyond the update check.** This is an offline app.
- **After `npm install` or dependency changes, always rebuild native modules for Electron:** `npx electron-rebuild -f -w better-sqlite3-multiple-ciphers`. The native module must match Electron's Node ABI, not the system Node ABI. If the app launches but password setup/unlock silently fails, this is almost certainly the cause.
- **Every migration MUST update `schema_version`.** End every migration with `db.prepare("UPDATE app_meta SET value = '<N>' WHERE key = 'schema_version'").run()`. Without this, the migration re-runs on every launch, non-idempotent statements (like `ALTER TABLE ADD COLUMN`) fail, `openDatabase()` dies, and the app looks like it rejects the password. Guard `ALTER TABLE ADD COLUMN` with a `pragma_table_info` check since it has no `IF NOT EXISTS`.

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
When implementation deviates from the spec, document it here:

| Date | Decision | Reason |
|-|-|-|
| 2026-02-17 | Use `better-sqlite3-multiple-ciphers` instead of `@journeyapps/sqlcipher` | `@journeyapps/sqlcipher` prebuilt binary links against `libcrypto.so.1.1` (OpenSSL 1.1.x); Fedora 43 ships OpenSSL 3.x only, no compat package available. `better-sqlite3-multiple-ciphers` bundles SQLCipher statically (no system OpenSSL dependency), passes full validation, and has the same synchronous API. |
| 2026-02-27 | Replace `xlsx` (SheetJS) with `exceljs` | xlsx 0.18.5 has unpatched prototype pollution (CVE) and ReDoS. SheetJS CE is unmaintained. exceljs is actively maintained, async API. |
| 2026-02-27 | Upgrade to Electron 39, NOT 40 | Electron 40 uses Node 24 (bleeding edge). Electron 39 uses Node 22 LTS (stable, better native module compat). Supported until May 2026. |
| 2026-02-27 | Keep `@dnd-kit` at core 6 + sortable 8 | dnd-kit v10 (`@dnd-kit/react`) is beta (0.3.2), complete API rewrite. Wait for 1.0 stable. |
| 2026-02-27 | Keep `electron-store` at v8 | v9+ is ESM-only, requires main process ESM migration throughout. Not worth the effort. |
| 2026-02-27 | Use electron-vite 3 + Vite 6, NOT electron-vite 4 + Vite 7 | Tailwind 4 PostCSS plugin doesn't support Vite 7 yet. Vite 6 path is safer and more battle-tested. |
| 2026-02-28 | Tailwind 4 upgrade: `.btn` as `@utility` | Tailwind 4 `@apply` only resolves Tailwind utilities, not custom CSS classes. Converted `.btn` to `@utility btn {}` so `.btn-primary/secondary/danger` can `@apply btn`. |
| 2026-10-09 | No code signing | The Azure Trusted Signing subscription lapsed and Pulse isn't sold anymore. `scripts/sign-exe.js` and the signing steps in `build-win.js` were removed; releases ship a `SHA256SUMS.txt` instead. |
| 2026-10-08 | Free and open source under GPL-3.0; licensing removed | No trial, no license key, no record limit. `enforceWritable()` stays as a generic read-only gate (error code `READ_ONLY`), with nothing registering a checker. Audit and security-finding reports in `plans/` stay local (git-ignored) and aren't in the public repo. |
| 2026-10-01 | Built-in snippets, letter templates and list templates are seeded only under the human-services words | They're written for social work; a workspace with other words (e.g. a car shop) would see "Met with client at residence". Found by the W01 leak test. |

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

When adding new enum values (e.g., AuditAction, NotificationType), ALWAYS search for ALL exhaustive Record/switch/map usages of that enum across the codebase and update every one. Run npx tsc --noEmit after to verify.

### Internet Connectivity
This is an offline-first app. Only one feature makes network calls:
1. **Update check** — GET to GitHub releases JSON (read-only, no data sent; can be turned off in Settings → About)

It uses an 8-second timeout. The renderer's CSP enforces `connect-src 'self'` — it cannot make external requests. All permissions (camera, mic, geolocation) are denied. No database contents ever leave the app.
