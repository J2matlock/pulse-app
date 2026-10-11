# Bug sweep — 2026-10-11

Prompted by the empty Tasks page hiding a new group. This is a second, bug-focused pass after the polish pass (plans/polish-2026-10). The areas are sliced by behaviour, not by folder, so the reviewers look with fresh eyes.

| # | Slice | Focus |
|-|-|-|
| S1 | Empty and first states | Every screen with zero of something (lists, records, tasks, groups, contacts, categories, notes, rules, reports, snippets, templates, forms, appointments). Does adding the first one show up straight away? Does deleting the last one leave a sane screen? |
| S2 | Tasks, checklists, recurrence | Task groups, templates, recurrence and snooze edge cases, checklist due dates, completion and undo |
| S3 | Grid data integrity | Every cell type's validation, paste, fill, bulk edit, undo/redo, column add/rename/retype/delete, saved views and filters, sorting and filtering by each type |
| S4 | Main-process integrity | Cascades and orphans on delete/trash/restore/purge, transactions, backup/restore and import/export round-trips, the integrity check |
| S5 | Dates and time | Timezone/DST, month ends, leap years, `localDateString`/`parseDbTimestamp` misuse, recurrence across month ends, calendar weeks, "today" rollover while the app is open |
| S6 | Contacts, snippets, letters, forms, templates | CRUD, linking, vCard round-trips, placeholders, printing |
| S7 | App shell | Lock/unlock state, auto-lock, command palette, global keyboard shortcuts, modals and focus traps, settings persistence, multiple windows, update banner |

Process:
1. Read-only reviewers write S1–S7.md.
2. I triage.
3. Builder tracks fix by file ownership, then everything is merged and verified (typecheck, eslint, full `npm test`, e2e).
4. Commit, push, update progress.md.
