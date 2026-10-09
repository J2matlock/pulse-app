# Generalization specs

Detailed specs for each workstream in `plans/generalization-plan.md` (revision 2: one flexible workspace + optional starter templates). The plan says *what* and *why*; these say *exactly how*, down to tables, types, screens, files and commits.

| Spec | Workstream | Phase |
|-|-|-|
| [W01-workspace.md](W01-workspace.md) | Words, feature switches, starter template format, Settings → Workspace, setup v2 + guided blank start | P0–P1 |
| [W02-list-kinds.md](W02-list-kinds.md) | People / things / jobs lists, display formats, auto numbers | P1 |
| [W03-activity.md](W03-activity.md) | Activity types, measures, recurring requirements | P1 |
| [W04-links.md](W04-links.md) | Linked records between lists | P3 |
| [W05-deadline-engine.md](W05-deadline-engine.md) | Deadline engine v2: relative, calendar, meter, quota, sequence, conditions, extensions | P2 |
| [W06-stages-board.md](W06-stages-board.md) | Stage column and board view | P3 |
| [W07-appointments-calendar.md](W07-appointments-calendar.md) | Appointments, recurring series, calendar view | P4 |
| [W08-forms.md](W08-forms.md) | Forms for entry, printable blanks | P4 |
| [W09-attachments.md](W09-attachments.md) | Encrypted attachments | P5 |
| [W10-reports-dashboard.md](W10-reports-dashboard.md) | Report renames, report builder, document templates + batch, dashboard cards, number charts | P3–P5 |
| [W11-reminders.md](W11-reminders.md) | Desktop notifications, tray mode, start with computer | P2, P5 |
| [W12-starter-templates.md](W12-starter-templates.md) | Starter template content, authoring guide, first-wave specs | P1–P5 |
| [W13-W16-licensing-rename-i18n-help.md](W13-W16-licensing-rename-i18n-help.md) | Free tier counting, rename, Spanish, help and docs | P1, P5, P6 |

## Conventions used in every spec
- **Sizes:** S ≤ 2 days, M 3–5, L 6–10.
- **Commits:** each spec ends with a commit-by-commit breakdown. Every commit must pass `npm run typecheck`, `npx eslint src --quiet` and `npm test`.
- **IPC:**
  - Channel names are added to `src/shared/ipc-channels.ts`, types to `src/shared/ipc-contract.ts`.
  - Main handlers use `secureWrap` + `enforceWritable` for writes + `validId` + zod for objects.
  - Renderer calls go through `safeInvoke`/`storeInvoke`.
- **Migrations:** each writes `schema_version`, guards `ALTER TABLE ADD COLUMN` with `pragma_table_info`, and is registered in `src/main/database.ts` and `tests/helpers.ts`. The next free number is **036**.
- **UI:** 15px text, 44px targets (`hit-44`), 3px focus rings, dark mode, plain language, and words from the vocabulary layer (W01), never hard-coded "client".
- **Undo:** every user-visible change is undoable through `useUndoStore` (one undo step per user action, side effects included).
- **Audit:** every change to records, links, stages, deadlines and attachments must appear in the audit trail (`src/main/export-audit.ts`), either via `cell_history`, `case_log` system entries, or a table the audit loader reads.
- **Dates:**
  - Calendar dates as `YYYY-MM-DD` via `localDateString()`.
  - Stored timestamps as SQLite UTC `datetime('now')`, parsed with `parseDbTimestamp()`.
  - Local wall-clock times (appointments) as `YYYY-MM-DDTHH:MM` with no zone.

## Build order (from the plan)
P0 safety rails → P1 (W01, W02, W03, W13) → P2 (W05, W11 notifications) → P3 (W04, W06, W10 part) → P4 (W07, W08) → P5 (W09, W10 rest, W11 tray, W14) → P6 (W15).
