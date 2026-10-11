# Bug sweep: build tracks

The findings are in S1–S7.md in this folder. Each finding belongs to the track that owns its main file. When reviewers report the same problem twice, that track fixes it once. Skip anything already fixed on main; check the current code first.

## Ownership

| Track | Owns (edit freely) | Findings |
|-|-|-|
| T1 Tasks & recurrence | `views/TasksView.tsx`, `views/tasks/**`, `components/tasks/**`, `stores/taskStore.ts`, `components/profile/Checklist*.tsx`, `utils/checklistTick.ts`, `shared/recurrence.ts`, `main/ipc/ipc-tasks.ts`, `main/ipc/ipc-checklists.ts` and their main-side helpers, `views/dashboard/TaskRow.tsx`, `views/dashboard/ChecklistDueRow.tsx`, the task badge count | S2 (all); S5 recurrence drift and snoozed tasks counted in the badge; S4 tasks of trashed lists |
| T2 Grid | `components/grid/**`, `components/board/**`, `stores/gridStore.ts` and its slices, `views/GridView.tsx`, `utils/filterMatch*`, `utils/gridSort.ts`, `main/ipc/ipc-cell.ts`, `ipc-row.ts`, `ipc-grid.ts`, `main/column-options.ts`, column type handling | S3 (all); S5 Age/Days-until blank in copy, filters and highlight rules; S1 "No columns yet" when all are hidden, first tag not showing the Tags column; S4 column-type cache after restore, "Last name" column hidden or deleted |
| T3 Import, export, backup, dates | `main/import.ts`, import UI (`ImportWizard` etc.), `shared/parseDate.ts`, `main/export*.ts`, `main/ipc/ipc-export.ts`, `main/backup.ts`, restore UI, `main/templates.ts` and `main/starters.ts` (column references), summary/supervisor report | S5 Excel dates a day early, date formulas, two-digit years, zip/ID columns detected as dates, summary period label; S4 newer-version backup restore, export missing archived records, import count, Age/Days-until references in templates/starters |
| T4 Contacts, letters, forms, snippets, templates | `views/ContactsView.tsx`, `components/contacts/**`, `stores/contactsStore.ts`, `main/contacts*.ts`, `main/ipc/ipc-contacts.ts`, `views/LetterTemplateView.tsx`, `main/placeholders.ts`, letter printing, `components/forms/**`, `main/forms.ts`, `main/export-forms.ts`, `views/SnippetsView.tsx`, snippet store/main, `views/TemplateManagerView.tsx`, `ContactRequirementsDialog.tsx` | S6 (all); S1 contact items, Templates page stale lists, first contact requirement |
| T5 App shell & the rest | `components/shared/ConfirmDialog.tsx` and other shared dialogs, `main/index.ts`, lock/auth hooks, `useGlobalKeyboard`, command palette, `views/FocusModeView.tsx`, error boundaries, window state, morning briefing, `views/DashboardView.tsx` + `views/dashboard/**` (not T1's rows), reports views, `views/TrashView.tsx`, `components/profile/CaseLog*.tsx`, `ScratchPad`, `App.tsx`, `events.ts` | S7 (all); S1 dashboard search "All clear!", Trash holding only files, note filters "No notes yet", new report with no lists stuck on "Working…"; S5 midnight refresh (a day-changed event that the dashboard, badge and grid colours listen to; T1 and T2 may subscribe once it's on main) |

## Shared files

Keep edits to these small and additive:
- `ipc-channels.ts`
- `ipc-contract.ts`
- `events.ts`
- `tests/helpers.ts`
- `database.ts`
- `undoStore.ts`
- `shared/types.ts`

No migrations. If a fix truly needs one, skip it and report it. For the recurrence drift, prefer deriving the intended day from the rule or the original due date over a schema change.
