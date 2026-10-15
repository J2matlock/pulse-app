# Q4 — Undo as the safety net instead of confirmations

Phase 2 idea 4. Wave B. Written 2026-10-15 against `main` after Phase 1 (f4fc6be9; P7 made every confirmation use `ConfirmDialog` with a named button).

## Goal

If something can be got back, Pulse does it at once and shows **"<what happened> · Undo"** for about 8 seconds, instead of asking "Are you sure?". The step also stays in the top bar's Undo, in Ctrl+Z and in the history panel after the toast has gone. Confirmations stay only where nothing can bring the data back:

- **Typed** confirmations: Empty Trash, erase everything, restore a backup over current data, and delete a list or a column forever. These are typed already.
- **Plain** confirmations: delete one record or file forever, and the few actions whose effects land somewhere the user can't see from where they are (see "the dependents rule" below).

No database migration. One new main-process channel for the six library items that are hard-deleted today (step B2), and one for "add a reason" after an archive. Both are built with the `/ipc-channel` skill. No network calls. Every word goes through the vocabulary layer. 15 px / 44 px / 3 px.

## Current behaviour

### The undo machinery (exists)

- `stores/undoStore.ts`: a stack of 100 steps (`:90`); `push` / `pushWithToast` (`:199-216`); the toast lasts `UNDO_TOAST_MS = 5000` (`:91-92`) and holds while the pointer or focus is on it (`holdToast`, `:348-353`); side effects void and unvoid system notes (`:23-41`).
- `components/shared/UndoToast.tsx`: fixed `bottom-6 right-6 z-[300]` (`:46`), text `text-sm` (`:57`), Undo button `minHeight: 36` with `hit-44` (`:58-67`), a countdown bar, `role="status"`. **The Undo button calls `undo()`, which undoes the top of the stack** (`:60`). `push()` doesn't clear the toast (`undoStore.ts:199-205`). So if a plain `push` (a cell edit, a rename) lands while a toast is showing, the toast's Undo undoes **that** step, not the one it names. With more toasts and 8 s, this has to be fixed first.
- **Toast overlap (left over from Phase 1, assigned "→ Q6" in ORCHESTRATION.md):** react-hot-toast's `<Toaster position="bottom-right" toastOptions={{ duration: 5500 }} />` is mounted 5 times in `App.tsx` (`:141`, `:153`, `:165`, `:185`, `:366`), in the same corner as `UndoToast` (mounted at `App.tsx:317`). A "Saved" toast and an Undo toast stack on top of each other. Q4 fixes it, because Q4 is what makes the Undo toast common. Q6 is told it's done.
- Undo already exists for (descriptions from `pushWithToast` / `push`): record to Trash (`gridRowSlice.ts:104-137`), archive with its cancelled appointments (`:141-178`), bulk Trash (`GridDialogs.tsx:206-232`), bulk archive (`BulkActionBar.tsx:74`), column to Trash (`gridColumnSlice.ts:172-196`), list to Trash (`gridStore.ts:250-275`), deadline rule delete (`alertStore.ts:130`), checklist item, group, clear completed and reset cycle (`Checklist.tsx:298`, `:514`, `:425`, `:388`), task delete, task group delete and clear completed (`taskStore.ts:143`, `TasksView.tsx:329`, `taskStore.ts:170`), case note delete and void (`CaseLog.tsx:509`, `:533`), contact delete and interaction delete (`contactsStore.ts:~173`, `contactsActivitySlice.ts:73-90`), appointment delete (`appointmentActions.ts:56-62`, main snapshot + `APPT_RESTORE`), Replace all (`GridView.tsx:78-87`), change column type (`ChangeTypeDialog.tsx:36-52`).
- Main-side restores exist for: rows (`ROW_RESTORE_DELETED`, `ROW_BULK_ACTION 'restore'`), columns (`COLUMN_RESTORE`), lists (`GRID_RESTORE`), rules (`ALERT_RULE_RESTORE`), notes (`CASE_LOG_RESTORE`), tasks (`TASK_RESTORE`), appointments (`APPT_RESTORE`), attachments (`ATTACHMENT_RESTORE`).
- **Hard deletes with no undo:** checklist templates (`ipc-checklists.ts:343-346`), letter templates (`ipc-export.ts:723-726` → `templates.ts:747`), saved list templates (`ipc-export.ts:647-651` → `templates.ts:240`), forms (`ipc-forms.ts:37` → `forms.ts:80`), saved reports (`ipc-reports.ts:68` → `report-builder.ts:462-475`, which also unpins from the dashboard), snippets (`ipc-tasks.ts:436-439`), link types (`links.ts:106`, which also removes the links and their columns).

### Inventory: every confirmation

`grep -rn "<ConfirmDialog" src/renderer` finds **38 uses in 28 files**. There are also **9 confirmations that don't use it** (a custom dialog, or an inline "click again"). Classes:

- **A**: reversible with undo today → replace with do-it + Undo toast.
- **B**: reversible in principle, but no undo yet → add undo (B2), then replace.
- **C**: truly irreversible → keep.
- **D**: not a safety confirmation (unsaved draft, a choice, a warning) → keep, unless noted.

| # | Where | Asks | Class | Q4 action |
|-|-|-|-|-|
| 1 | `components/grid/GridDialogs.tsx:132` `DeleteRowDialog` (mounted `DataGrid.tsx:802-807`, opened by `useGridRowActions`) | Move this record to the Trash? | A | Replace: `deleteRow(id)` at once |
| 2 | `GridDialogs.tsx:206` `BulkDeleteDialog` (`DataGrid.tsx:844-851`) | Move N records to the Trash? | A | Replace: body becomes `trashRows(ids)`; toast "Moved 12 clients to the Trash · Undo" |
| 3 | `views/ProfileView.tsx:670` | Move {name} to the Trash? | A | Replace (`confirmTrash` `:332-337` runs at once) |
| 4 | `views/ProfileView.tsx:655` (reason + cancel appointments) | Archive {name}? | A | Replace; reason moves to the toast (below) |
| 5 | `GridDialogs.tsx:56` `ArchiveDialog`, custom (`DataGrid.tsx:864-870`, `BulkActionBar.tsx:224`) | Archive record(s), reason, cancel appointments | A | Replace, same as #4 |
| 6 | `components/grid/ColumnHeader.tsx:563` | Move the column to the Trash? (lists dependents) | A | Replace when `COLUMN_DEPENDENTS` is empty; **keep** when it isn't (dependents rule) |
| 7 | `components/alerts/DeleteRuleConfirm.tsx:24` (`AlertsSection.tsx:132`) | Delete deadline rule? (lists columns) | A | Replace when no column uses it; **keep** when some do (dependents rule) |
| 8 | `components/profile/Checklist.tsx:885` | Uncheck all completed items? | A | Replace |
| 9 | `Checklist.tsx:895` | Delete N completed items? | A | Replace |
| 10 | `Checklist.tsx:906` | Delete the group? | A | Replace |
| 11 | `views/TasksView.tsx:925` | Delete the group? | A | Replace |
| 12 | `TasksView.tsx:936` | Delete N completed tasks? | A | Replace |
| 13 | `components/grid/FindReplaceBar.tsx:336` | Replace in N cells…? (says "You can undo this") | A | Replace; the toast names the count and how many were left alone |
| 14 | `components/contacts/ContactDetail.tsx:393` | Delete "{name}" forever? (says "You can undo this right away") | A* | Replace. Undo works for this session (the contact comes back under a new id, `contactsUndo.ts`). The toast says "It doesn't go to the Trash." (E-14 wording) |
| 15 | `views/template-manager/ChecklistTemplateRow.tsx:83` (deletes via `TemplateManagerView.tsx:182`) | Delete "{template}"? | B | B2 restore, then replace |
| 16 | `Checklist.tsx:1371` (deletes via `:1043-1044`) | Delete the template? | B | B2, then replace |
| 17 | `views/letter-template/DeleteConfirmModal.tsx:32` (`LetterTemplateView.tsx:93`, `:312`) | Delete "{template}"? | B | B2, then replace; delete `DeleteConfirmModal.tsx` |
| 18 | `components/forms/FormsDialog.tsx:85` (`:42`) | Delete "{form}"? | B | B2, then replace |
| 19 | `components/reports/ReportBuilder.tsx:499` (`:257-260`) | Delete "{report}"? | B | B2 (restore also re-pins to the dashboard), then replace |
| 20 | `views/TrashView.tsx:278` | Delete "{record}" forever? | C | Keep (plain) |
| 21 | `TrashView.tsx:303` | Delete list forever (type its name) | C | Keep (typed) |
| 22 | `TrashView.tsx:318` | Empty the Trash? (type EMPTY) | C | Keep (typed) |
| 23 | `components/grid/DeletedColumnsSection.tsx:63` | Delete column forever (type its name) | C | Keep (typed) |
| 24 | `components/shared/TrashFiles.tsx:58` | Delete this file forever? | C | Keep (plain) |
| 25 | `components/settings/BackupSection.tsx:550` | Restore from backup? (type RESTORE) | C | Keep (typed) |
| 26 | `components/settings/DataSection.tsx:269` | Delete all cell history? | C | Keep (plain) |
| 27 | `components/shared/UndoHistoryPanel.tsx:301` | Forget the undo history? | C | Keep |
| 28 | `components/links/LinkSetupDialog.tsx:176` | Remove this link? (N links + their columns) | C today | Keep. Making it undoable needs a main snapshot of the links and their columns; out of scope, note it in the README |
| 29 | `TrashView.tsx:292` | Restore the list first | D (a choice) | Keep |
| 30 | `views/HelpView.tsx:269` | Start the N-step tour? | D (harmless) | Recommend removing; **Q7 owns the tour**, hand over, don't touch |
| 31 | `views/PasswordSetupView.tsx:198` | Skip recovery key? | D (security warning) | Keep |
| 32 | `views/ReportsView.tsx:149` | Discard your changes? | D (unsaved draft) | Keep |
| 33 | `views/letter-template/EditTemplateModal.tsx:250` | Discard your changes? | D | Keep |
| 34 | `components/contacts/ContactForm.tsx:451` | Discard your changes? | D | Keep |
| 35 | `components/forms/FillFormDialog.tsx:292` | Discard your changes? | D | Keep |
| 36 | `UndoHistoryPanel.tsx:284` | Undo these actions? (a jump of several steps) | D (Redo reverses it) | Keep |
| 37 | `components/shared/SampleDataBanner.tsx:139` | Remove sample data? (it clears the undo stack, `:92`) | D (the model confirmation in the review) | Keep |
| 38 | `views/GridView.tsx:192` | Change column type? (store path `gridColumnSlice.ts:128-142`) | D | Keep. Every renderer caller passes `skipConfirm` (`ColumnHeader.tsx:122`, `GridToolbar.tsx:566`) and the real flow is `ChangeTypeDialog` (a preview, with undo), so this looks unreachable. Note it for a post-merge cleanup (GridView.tsx belongs to Q3 this wave) |
| 39 | `calendar/AppointmentActions.tsx:120` | Mark it done anyway? (future appointment; it opens the Done form next, `:87`) | D | Replace with one warning line inside the Done form: "This {appointment} is on a later day, so it hasn't happened yet." The form's own Cancel is the way out |

Confirmations that don't use `ConfirmDialog`:

| Where | Asks | Class | Q4 action |
|-|-|-|-|
| `components/profile/CaseLogEntry.tsx:222-239` (inline Delete / ✕, within `CASE_NOTE_DELETE_WINDOW_MINUTES`) | Delete the note? | A (`CaseLog.tsx:509`) | Replace: the trash icon deletes at once |
| `CaseLogEntry.tsx:240-273` (inline Void with reason) | Reason for voiding | D (a reason prompt for the audit trail) | Keep |
| `components/contacts/ContactInteractionLog.tsx:141-150` ("Click again to delete") | Delete the interaction? | A | Replace; buttons at 44 px (now `minHeight: 36`) |
| `views/SnippetsView.tsx:356-372` (inline Delete / Cancel) | Delete the snippet? | B | B2, then replace |
| `views/template-manager/SetupTemplateCard.tsx:97-115` (inline Delete / Cancel) | Delete the list template? | B | B2, then replace |
| `components/layout/Sidebar.tsx:53-85` `DeleteCaseloadModal` | Delete list → Trash | A, kept on purpose | Keep: a whole list and everything in it disappears at once (scope). Not owned, unchanged |
| `components/calendar/AppointmentDialog.tsx:282`, `AppointmentActions.tsx:119` `ScopeDialog` | Delete which ones: this one / following / all | D (a choice) | Keep. A single appointment is already deleted at once with undo (`AppointmentDialog.tsx:274`) |
| `components/settings/DataSection.tsx:355-397` | Erase everything (type RESET EVERYTHING + password) | C | Keep |

**Totals.** Replace now (A, plus #39): 14 `ConfirmDialog` uses (#1–4, 8–14, 39, and #6/#7 when nothing depends on the item), the custom `ArchiveDialog`, and 2 inline confirmations. Replace after B2: 5 `ConfirmDialog` uses + 2 inline. Keep: 9 C + 10 D (#30 goes to Q7). After Q4, `<ConfirmDialog` tags in source go from 38 to **21**: #6 and #7 keep their tags for the dependents case, #17's file is deleted.

### The dependents rule

A confirmation stays, even though undo exists, when the action changes things somewhere else that the user can't see from here: a column used by rules, forms or views (`ColumnHeader.tsx:574-581`, from `COLUMN_DEPENDENTS`), or a rule that columns use (`DeleteRuleConfirm.tsx:35-40`). The dialog's job there is to show that list, not to ask "are you sure". With nothing depending on it, the action is immediate.

## The change

### 1. Make the Undo toast trustworthy (`undoStore.ts`, `UndoToast.tsx`)

- `UNDO_TOAST_MS` 5000 → **8000** (`undoStore.ts:92`). The countdown bar and the comment in `UndoToast.tsx:1-6` follow.
- The toast carries the step it belongs to: `toast: { description, itemId, action? } | null`. `pushWithToast` sets `itemId = item.id`.
- **Any later `push`/`pushWithToast`/`coalesce` that changes the top of the stack clears a toast whose `itemId` is no longer on top.** `undo()` and `redo()` clear it too, as today. So the toast's Undo always undoes exactly what it names. If the step has gone, the toast has gone too, and the top bar, Ctrl+Z and the history panel still work.
- An optional second button: `action?: { label: string; run: () => void }`, used only by Archive ("Add a reason…").
- `UndoToast.tsx`: text at 15 px (`text-base`, `:57`); Undo button `minHeight: 44` (`:62`); the Undo button's `title` "Undo (Ctrl+Z)" using `modHelp`; the description is never truncated (it already wraps). Keep `role="status"` / `aria-live="polite"` and the hold on hover and focus.
- **Overlap fix:** new `components/shared/AppToaster.tsx` wraps react-hot-toast's `<Toaster position="bottom-right" toastOptions={{ duration: 5500 }} />` and lifts its container above the Undo toast while one shows. `UndoToast` publishes its height to a CSS variable `--undo-toast-h` on `document.documentElement` via `ResizeObserver` (0 when hidden). `AppToaster` sets `containerStyle={{ bottom: 'calc(24px + var(--undo-toast-h, 0px) + 12px)', right: 24 }}`. `App.tsx`'s five `<Toaster …/>` lines become `<AppToaster />` (only those lines change). Q6 animates both later.

### 2. Replace class A confirmations (immediate action + Undo toast)

Each one calls the existing undoable action directly. The toast text is the existing `description`, worded as the result; all of them already exist except where noted:
- **Record to Trash**: grid row menu / context menu (`useGridRowActions.ts`: `handleDeleteRow` calls `deleteRow` instead of `setDeleteTarget`), profile "Move to the Trash…" → **"Move to the Trash"** (no ellipsis, since no dialog follows; `ProfileView.tsx:367`). Toast: `"Maria Garcia" moved to the Trash` + Undo.
- **Bulk Trash**: `BulkDeleteDialog` becomes a plain function `trashRows(ids, …)` in `GridDialogs.tsx`, called from the bulk bar. Toast: "Moved 12 {records} to the Trash" + Undo. The bulk bar button names the count ("Move 12 to the Trash"), so the action is clear before the click.
- **Archive** (grid, bulk, profile): archives at once, cancelling upcoming appointments as the dialog does by default today. Toast: `"Maria Garcia" archived; 2 upcoming {appointments} cancelled` + **Undo** + **Add a reason…**. Undo restores both (`gridRowSlice.ts:170-173`). "Add a reason…" opens a small `ArchiveReasonDialog` (one text field, 1000 chars, Save / Cancel). It saves through the new channel **`ROW_ARCHIVE_REASON (rowIds: number[], reason: string)`** in `ipc-row.ts`: it sets `archived_reason` on those rows if they're still archived, and adds one system note "Reason for archiving: …" per row, in one transaction, `{ write: true }`. That keeps the case log honest: the "archived" note was already written. The note ids go into the step's side effects, so undoing the archive voids them too. `ArchiveDialog` and its `archiveReason` state in `DataGrid.tsx` / `ProfileView.tsx` / `BulkActionBar.tsx` go away. The profile still leaves the record after archiving (`leaveRecord()`); the toast is global, so Undo works from the list.
- **Column to Trash** (#6): `handleDelete` (`ColumnHeader.tsx:189-194`) fetches `COLUMN_DEPENDENTS` as today. If the list is empty, it calls `deleteColumn` straight away; otherwise it opens the existing dialog, unchanged.
- **Deadline rule** (#7): `DeleteRuleConfirm` calls `deleteRule` straight away when `uses.length === 0`. Rename its parts if that reads better; keep the file.
- **Checklist and task bulk actions** (#8–12): the buttons act at once. Their existing descriptions are the toast text (`Checklist.tsx:388`, `:425`, `:514`; `TasksView.tsx:329`; `taskStore.ts:170`). Make sure each uses `pushWithToast`, not `push`: check `Checklist.tsx:388` / `:425` / `:514` and switch where needed.
- **Replace all** (#13): `FindReplaceBar` calls `onReplaceAll` at once. `GridView.tsx:85` already pushes one toast step; Q4 doesn't edit GridView, so FindReplaceBar shows the "left alone" count as its own toast (react-hot-toast, now stacked above the Undo toast).
- **Contact delete** (#14): immediate; `contactsStore.deleteProvider` already uses the toast (`contactsStore.ts:~188`). Its toast text gains "It doesn't go to the Trash." The menu item label loses "forever…" → "Delete {contact}".
- **Note delete within the window**: the trash icon deletes at once (`CaseLogEntry.tsx:275-283` calls `onDelete`). **Interaction delete**: the trash icon deletes at once.
- **Mark a future appointment done** (#39): opens the Done form with the warning line; the `ConfirmDialog` goes.

### 3. Class B: add undo for the six hard-deleted library items (B2)

Renderer-side "re-create on undo" would give the item a **new id**. That breaks references: a column's `done_checklist_id`, a form's filled copies, a report's dashboard pin, and later undo/redo steps. So the restore happens in main, with the original id:

- New `src/main/library-restore.ts`. `snapshotForDelete(kind, id)` reads the row(s) inside the delete's transaction. `restoreSnapshot(kind, snapshot)` re-inserts with the same id(s) in one transaction, and refuses with a plain message ("That {kind} can't be brought back: something new is using its place.") if the id is taken. `kind` is a closed list, `LIBRARY_KINDS = ['checklist-template', 'letter-template', 'setup-template', 'form', 'report', 'snippet'] as const`, mapped to `Record<LibraryKind, { table, children? }>`. The table name never comes from the renderer. Columns are intersected with `pragma_table_info(table)`; values must be string, number or null, with a size cap. The report kind also stores and re-applies its dashboard pin position (`report-builder.ts:466-474`). Use `unhandledCase` for the kind switch (`src/shared/assertNever.ts`).
- Each of the six DELETE handlers returns `{ snapshot }` instead of `true` (contract change in `ipc-contract.ts`; update the six renderer callers' `safeInvoke<true>` types).
- One new channel **`LIBRARY_RESTORE (kind, snapshot)`**, via `defineHandler` with `schemaArg(z.enum(LIBRARY_KINDS))` and a snapshot schema, `{ write: true }`. Use the `/ipc-channel` skill: channel constant, contract, handler, the `ipc-consistency` test.
- Renderer: a helper `utils/libraryUndo.ts`, `deleteWithUndo(kind, id, label, reload)`. It calls the delete and pushes `pushWithToast` with `undo` = `LIBRARY_RESTORE` and `redo` = delete again (keeping the new snapshot). Then the five `ConfirmDialog`s (#15–19) and the two inline confirmations (Snippets, SetupTemplateCard) go.
- Model it on `APPT_RESTORE` (`ipc-appointments.ts:97`, `validSnapshot`). Run `/security-review` on this step: the renderer hands main a snapshot.

If B2 runs long, it can ship after the rest. Those five confirmations stay until it lands, and the policy test (below) lists them as "pending B2".

### 4. A policy test so this doesn't drift

New `tests/renderer/confirmationPolicy.test.ts`, a source scan using the same `openingTag` helper as `confirmDialogLabels.test.ts`:
- Every file that renders `<ConfirmDialog` is on an allowlist, each entry with its class (C or D) and a one-line reason (the table above). A new `ConfirmDialog` anywhere else fails with: "Can this be undone? Then do it and show the Undo toast (see plans/ux-review-2026-10/phase2/plan-Q4-undo-not-confirm.md). If it can't, add it here with the reason."
- Every `variant="typed"` is in {TrashView (list forever, Empty Trash), DeletedColumnsSection, BackupSection}.
- No "Click again to delete" / `confirmDelete` inline pattern in `src/renderer` (grep for `Click again`).

## Files owned

Renderer:
- `src/renderer/stores/undoStore.ts`
- `src/renderer/components/shared/UndoToast.tsx`
- `src/renderer/components/shared/AppToaster.tsx` (new)
- `src/renderer/components/shared/ArchiveReasonDialog.tsx` (new)
- `src/renderer/utils/libraryUndo.ts` (new, B2)
- `src/renderer/components/grid/GridDialogs.tsx`
- `src/renderer/components/grid/DataGrid.tsx` (dialog mounts `:754`, `:802-870` only)
- `src/renderer/hooks/useGridRowActions.ts`
- `src/renderer/components/grid/BulkActionBar.tsx`
- `src/renderer/components/grid/FindReplaceBar.tsx`
- `src/renderer/components/profile/Checklist.tsx`
- `src/renderer/components/profile/CaseLogEntry.tsx`
- `src/renderer/views/TasksView.tsx`
- `src/renderer/components/alerts/DeleteRuleConfirm.tsx`
- `src/renderer/components/contacts/ContactDetail.tsx`, `src/renderer/components/contacts/ContactInteractionLog.tsx`, `src/renderer/stores/contactsStore.ts` (toast wording only)
- `src/renderer/components/calendar/AppointmentActions.tsx`
- B2: `src/renderer/views/TemplateManagerView.tsx`, `src/renderer/views/template-manager/ChecklistTemplateRow.tsx`, `src/renderer/views/template-manager/SetupTemplateCard.tsx`, `src/renderer/views/LetterTemplateView.tsx`, `src/renderer/views/letter-template/DeleteConfirmModal.tsx` (deleted), `src/renderer/components/forms/FormsDialog.tsx`, `src/renderer/components/reports/ReportBuilder.tsx`, `src/renderer/views/SnippetsView.tsx`

Main / shared:
- `src/main/ipc/ipc-row.ts` (`ROW_ARCHIVE_REASON`, appended)
- `src/main/library-restore.ts` (new, B2)
- `src/main/ipc/ipc-checklists.ts` (`CL_TEMPLATE_DELETE` `:343-346`), `src/main/ipc/ipc-forms.ts` (`:37`) + `src/main/forms.ts` (`:80`), `src/main/ipc/ipc-reports.ts` (`:68`) + `src/main/report-builder.ts` (`:462-475`), `src/main/ipc/ipc-tasks.ts` (`SNIPPET_DELETE` `:436-439`), `src/main/templates.ts` (`:240`, `:747`). Also a new `ipc-library.ts` registered in `ipc-handlers.ts` for `LIBRARY_RESTORE`.

Shared files touched narrowly:
- `src/renderer/App.tsx`: only the five `<Toaster …/>` lines and one import. Q7 may also edit App.tsx (tour mounts); keep the hunks apart.
- `src/renderer/views/ProfileView.tsx`: only `askArchive` / `askTrash` state, `confirmArchive` / `confirmTrash` (`:323-337`), the two menu items (`:363`, `:367`) and the two dialogs (`:655-677`). Q2 edits ProfileView for the note box; keep the hunks apart.
- `src/renderer/components/grid/ColumnHeader.tsx`: only `handleDelete` (`:189-194`) and the delete dialog block (`:562-582`). **Q3 owns the rest of this file; merge Q3 first, then rebase Q4.**
- `src/main/ipc/ipc-export.ts`: only the `SETUP_TEMPLATE_DELETE` (`:647-651`) and `LETTER_TEMPLATE_DELETE` (`:723-726`) handlers. Q1a import may edit this file; keep the hunks apart.
- `src/shared/ipc-channels.ts`, `src/shared/ipc-contract.ts`: append-only (`ROW_ARCHIVE_REASON`, `LIBRARY_RESTORE`, the six delete return types).
- `src/main/ipc-handlers.ts`: one registration line.
- `CLAUDE.md`: one Decision Log row (close-out).

Not touched: `ConfirmDialog.tsx` and other Q5 primitives (if Q5 renamed or replaced `ConfirmDialog` in Wave A, use the new name and API; the classification stands), `GridView.tsx` (Q3), `Sidebar.tsx`, `HelpView.tsx` / `tourSteps.tsx` (Q7), `SampleDataBanner.tsx`, settings sections (Q1c), `ImportWizard` (Q1a).

## Commit steps

Run `npm run gate` before every commit.

1. **Toast you can trust.** `undoStore` gets `itemId`, clears a stale toast and supports `action`; 8 s; `UndoToast` at 15 px / 44 px; `AppToaster` + `App.tsx` swap; the `--undo-toast-h` variable. Tests: `undoStore.test.ts` (stale-toast clearing, 8 s using `UNDO_TOAST_MS`, action), `UndoToast` test (Undo undoes the named step after an unrelated `push`), `AppToaster` test (offset while a toast shows).
2. **Records: Trash and archive without asking.** `useGridRowActions`, `DataGrid` mounts, `GridDialogs` (`trashRows`, remove `DeleteRowDialog`/`BulkDeleteDialog`/`ArchiveDialog`), `BulkActionBar`, `ProfileView` hunks, `ArchiveReasonDialog` + `ROW_ARCHIVE_REASON` (via `/ipc-channel`). Update `GridDialogs.test.tsx`, `BulkActionBar.test.tsx`, `DataGrid.test.tsx`, `GridContextMenu.test.tsx`, `recordActions.test.tsx`, `profileHeaderActions.test.tsx`, `profileView-record.test.tsx`, `tests/ipc-row.test.ts` (new channel), `tests/ipc-consistency.test.ts` stays green.
3. **Columns and rules: the dependents rule.** `ColumnHeader` delete hunk, `DeleteRuleConfirm`. Update `ColumnHeader.test.tsx` (delete with and without dependents) and `DeleteRuleConfirm.test.tsx`.
4. **Checklists, tasks, notes, interactions, Replace all, contacts, future appointment.** `Checklist.tsx` (#8–10), `TasksView.tsx` (#11–12), `CaseLogEntry.tsx`, `ContactInteractionLog.tsx`, `FindReplaceBar.tsx`, `ContactDetail.tsx` + toast wording, `AppointmentActions.tsx`. Update `Checklist.test.tsx`, `checklistGroupUndo.test.tsx`, `TasksView.test.tsx`, `tasksView-data.test.tsx`, `appointmentsElsewhere.test.tsx` and the contacts tests.
5. **B2: library items get undo.** `library-restore.ts`, the six delete handlers return snapshots, `LIBRARY_RESTORE`, `libraryUndo.ts`, the five dialogs and two inline confirmations removed. Tests: a round trip per kind (delete → restore → same id and fields; refused when the id is taken; a report re-pinned), snapshot validation (an unknown column, a bad value type, an oversize value → refused), the `ipc-consistency` entry, renderer tests for each call site. Run `/security-review`.
6. **Policy test, label test, Decision Log, screenshots.** Add `confirmationPolicy.test.ts`. Update `confirmDialogLabels.test.ts:52-54`: `expect(uses.length).toBeGreaterThan(30)` fails at 21 → `toBeGreaterThan(15)`, with a comment pointing at the policy test. Add the Decision Log row. Run the Q4 screenshot spec.

## Acceptance checks

- Right-click a record → "Move to the Trash": the record leaves the list at once with no dialog, and the toast "<name> moved to the Trash · Undo" is visible for about 8 s (longer while hovered). Undo brings it back in place. The step is still in the top bar's Undo after the toast has gone.
- Edit a cell while that toast is showing: the toast disappears (the step it named is no longer on top), and Ctrl+Z undoes the cell edit, then the Trash.
- Archive from the profile: you're back on the list, the toast says "<name> archived; 2 upcoming {appointments} cancelled" with Undo and "Add a reason…". The reason is saved, appears in the case log as "Reason for archiving: …", and shows in the dashboard's Recently archived tab (`archived_reason`). Undo un-archives and restores the appointments, and voids the reason note.
- A column with no rules, forms or views using it goes to the Trash without a dialog. A column that something uses still shows the dialog listing what will stop working.
- Checklist "Uncheck all", "Delete N completed", "Delete group", Tasks "Delete group" and "Delete N completed" act at once with an Undo toast.
- After B2: deleting a checklist template, letter template, list template, form, report or snippet acts at once with Undo, and Undo brings it back **with the same id**. A column's "add this checklist when done" still points at the template; a pinned report is pinned again.
- These still ask, unchanged: Empty Trash (EMPTY), delete list or column forever (type the name), Restore from backup (RESTORE), Erase everything (RESET EVERYTHING + password), delete a record or file forever, Delete all cell history, Remove link, Discard changes, Skip recovery key, Remove sample data.
- A react-hot-toast message ("Saved") never overlaps the Undo toast; it sits above it.
- No migration (schema 50), no network call. `npm run gate` passes; `npm run test:tz` passes (the archive-reason note timestamp).

Screenshots (`env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 UX_REVIEW=1 npx playwright test e2e/ux-review/Q4.spec.ts --reporter=line`; `openSeededApp()` and `shotter('Q4')` from `e2e/ux-review/harness.ts`, light and dark at 1366×768):
- `Q4/trash-record-toast.{light,dark}.png`: the list right after "Move to the Trash", with the toast and no dialog.
- `Q4/archive-toast.light.png`: the toast with Undo and "Add a reason…"; `Q4/archive-reason.light.png`: the reason dialog.
- `Q4/toast-stack.light.png`: trigger a react-hot-toast message while the Undo toast is up; they don't overlap.
- `Q4/column-dependents.light.png`: the kept dialog for a column a rule uses.
- `Q4/checklist-clear-toast.light.png`, `Q4/template-delete-toast.light.png` (after B2).
- In the spec, assert `page.getByRole('dialog')` has count 0 right after each replaced action, and that Undo restores (`visibleText` contains the name again).

## Tests to add or update

- New: `tests/renderer/confirmationPolicy.test.ts`; `tests/renderer/components/shared/UndoToast.test.tsx` (if there isn't one; otherwise extend it); `tests/renderer/components/shared/AppToaster.test.tsx`; `tests/library-restore.test.ts` (main, round trips + validation); `tests/renderer/utils/libraryUndo.test.ts`; `tests/renderer/components/shared/ArchiveReasonDialog.test.tsx`.
- Update: `tests/renderer/stores/undoStore.test.ts` (`:340` uses the constant, so it follows 8000; add the stale-toast cases), `tests/renderer/confirmDialogLabels.test.ts` (count), and every test that clicks a now-removed confirm button: `GridDialogs.test.tsx`, `BulkActionBar.test.tsx`, `DataGrid.test.tsx`, `GridView.test.tsx` / `gridView-data.test.tsx` if they open the delete dialog, `ColumnHeader.test.tsx`, `DeleteRuleConfirm.test.tsx`, `Checklist.test.tsx`, `checklistGroupUndo.test.tsx`, `checklistWriteFailure.test.tsx`, `TasksView.test.tsx`, `tasksView-data.test.tsx`, `recordActions.test.tsx`, `profileHeaderActions.test.tsx`, `profileView-record.test.tsx`, `appointmentsElsewhere.test.tsx`, and the contacts / snippets / template-manager / letter-template / forms / reports tests that delete. Never delete a test: change what it asserts from "the dialog opens, then Confirm acts" to "the click acts, a toast step exists, Undo restores".
- Main: `tests/ipc-row.test.ts` (`ROW_ARCHIVE_REASON`: archived rows only, writes the note, a 1000-char limit), `tests/ipc-consistency.test.ts` (new channels have contract entries and one handler each), `tests/renderer/friendlyError.test.ts` scans the new `fail()` messages, `tests/vocab-leak-main.test.ts` (no hard-coded "template"/"client" where a vocabulary word applies; library kinds are app words, not record words).
- e2e: `e2e/ux-review/B.spec.ts`, `B2.spec.ts` and `C.spec.ts` click "Move to the Trash" / "Archive" confirms. They're the git-excluded harness, so update them so the after-pass still runs. Grep `e2e/*.spec.ts` (tracked) for the same labels and update those too.

## Risks

- **One mis-click does more at once** (bulk Trash of many records, Uncheck all). Mitigations: the Trash keeps records for 30 days; one Undo step per bulk action; the bulk button names the count; 8 s toast with hold on hover and focus; the top bar Undo and history panel. A whole list keeps its confirmation (scope).
- **The toast's Undo hitting the wrong step.** It does today; fixed in step 1, which must land before anything else.
- **Timing and accessibility (WCAG 2.2.1).** The toast holds while hovered or focused, and Undo is always available through Ctrl+Z, the top bar and the history panel, so the 8 s limit isn't the only way. Screen readers hear the `role="status"` text. Keyboard users get "Undo (Ctrl+Z)" in the title, and the toast text could say "Press Ctrl+Z to undo". Check with the screen-reader test in `tests/renderer/a11y/`.
- **The undo stack is cleared** by some actions (Empty Trash, restore a backup, remove samples, changing the record word: `useAuthGating.ts:112`, `BackupSection.tsx:178`, etc.). After that, a B-class item deleted earlier is gone for good, which is no worse than today's confirm-then-delete. Contacts (#14) have no Trash, so undo is the only way back. Say so in the toast.
- **Snapshot restore is a write path the renderer feeds.** The closed kind list, a column allowlist from `table_info`, primitive values only, a size cap, refuse if the id is taken, and `/security-review` on step 5.
- **The archive reason after the fact** writes a second system note instead of rewriting the first. That's deliberate: the case log is an audit trail and isn't edited.
- **Merge overlaps:** `ColumnHeader.tsx` (Q3: merge Q3 first), `ProfileView.tsx` (Q2), `App.tsx` (Q7), `ipc-export.ts` (Q1a), `ipc-channels.ts` / `ipc-contract.ts` (anyone adding channels: append-only, resolve by keeping both). Q5 runs in Wave A: rebase on its primitives before starting. Q6 (Wave C) takes over toast motion; tell it the overlap is fixed.
- **Decision Log row** (CLAUDE.md, step 6): `| 2026-10-xx | Reversible actions no longer ask "Are you sure?": they happen at once with an Undo toast (8 s, holds on hover/focus; also top-bar Undo, Ctrl+Z, history). Confirmations stay for what can't be undone (Empty Trash, erase everything, restore a backup, delete forever, delete all history, remove a link type), for discarding unsaved edits, and where the action changes things elsewhere (a column or rule others use). Library items (checklist/letter/list templates, forms, reports, snippets) get a main-process restore with the same id | Phase 2 idea 4; 2026-10-14 UX review for non-technical users: confirmations were clicked through by habit, and undo is the real safety net. tests/renderer/confirmationPolicy.test.ts keeps the list |`
