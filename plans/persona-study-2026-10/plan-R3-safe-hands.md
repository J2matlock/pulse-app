# R3 — Safe hands: double-clicks, empty records, the column Trash, and "where did it go?"

Phase 3 polish, Wave 1, merge slot 3. Written 2026-10-15 against main at 65e773fb. Read `REPORT.md` rows D8, D11, #2 and #8 first.

## Goal

Hands that double-click, tremble or click twice on a slow laptop get the same result as a careful single click. Add makes one record. A menu or dialog opened with a double-click stays open. A checkbox double-clicked stays ticked. A record nobody typed into doesn't stay behind and get counted. A column full of dates isn't one key press from the Trash, and when it does go there, the Trash page says where it is. When search finds nothing, it says whether the record is in the Trash or archived.

## Personas and findings

- **Joe** (D11): every double-click on Add Client made two rows, giving four ghosts and "10 clients" for six homes (`persona-joe/p2-04-dblclick-add-client.png`, `p6-02-four-more.png`). Cleaning up the ghosts is how he trashed Bergstrom (`p7-02-five-selected.png`, `p7-03-after-trash-dblclick.png`).
- **Joe** (#2): a double-click on Done for a renewal, Done on…, the column ⋯ and the row ⋯ opened and closed at once, so it looked dead (`p9-04-lindquist-renewal-dblclick-nothing.png`, `p4-01-inspection-menu.png`, `p11-01-row-menu-dblclick.png`). A double-click on a checkbox ticked and unticked it (`p1-03-dblclick-terms.png`, `p7-01-dblclick-checkbox.png`).
- **Joe** (#8): "No clients found" for Bergstrom in the Trash and for the Olsons in Recently archived (`p8-01-search-berg.png`, `p12-02-search-olson.png`).
- **Karen** (D11): "+ Add Student" then Esc left a nameless student, counted as 13 (`persona-karen/53a-blank-row.png`).
- **Mark** (D11): Ctrl+N, then a hint bubble flustered him, and an empty volunteer stayed and was counted (`persona-mark/82-in-grid.png`). (D8) One extra arrow press ran "Move column to the Trash", his dates were gone, and the Trash page said "The Trash is empty" (`94-deadline-rule-dialog.png`, `97-trash.png`); it took 12 minutes through Help → List settings (`101-list-settings.png`).
- **Candy** (D11): Add Patient, then pulled away: a blank nameless patient was counted (`persona-candy/33b-reopened.png`).
- **Bobby** (D8, adjacent): "Move column to the Trash is one wrong click from where I aimed" (`persona-bobby/r-13-claim-rule-popup.png`).

## Current behaviour

- `stores/gridRowSlice.ts:98-117`: `addRow` calls `ROW_CREATE` at once, with no in-flight guard, and every caller (toolbar `GridToolbar.tsx:290`, empty state `GridNotices.tsx:58`, Ctrl+N `useGlobalKeyboard.ts:95`, palette `CommandPalette.tsx:132`) creates another row. The row exists in the database before anything is typed.
- `hooks/useGridEditing.ts:44-46`: `setEditingCell` just sets state; nothing notices that a just-added row was left untouched.
- `ui/RowMenu.tsx:179`, `:221`: the trigger's `onClick` toggles `setOpen(o => !o)`, so the second click of a double-click closes the menu. `ui/Dialog.tsx:119`: the backdrop's `onClick` closes the dialog, and the second click of the double-click that opened it lands there. The column ⋯ in `ColumnHeader.tsx` is a hand-built toggle with the same problem. Native checkboxes toggle on each click.
- `grid/ColumnHeader.tsx:513-545`: the menu runs Column settings…, then (date columns) a separator and "Deadline rule…", then a separator and "Move column to the Trash". From "Deadline rule…" one ArrowDown reaches Trash. `:222-228` `handleDelete`: when `COLUMN_DEPENDENTS` is empty it calls `deleteColumn` straight away (Phase 2 Q4's "dependents rule").
- `views/TrashView.tsx` lists records and lists only. Deleted columns appear only in `grid/DeletedColumnsSection.tsx`, mounted in `ListSettingsDialog.tsx:232`.
- `shared/UndoToast.tsx`: a keyboard user's focus isn't on the toast, and the text doesn't mention Ctrl+Z.
- `grid/GridNotices.tsx:33`: "No {records} found matching '…'". Search filters only the live rows in memory (`gridFilterSlice`); nothing asks about trashed or archived ones.
- `grid/BulkActionBar.tsx`: "Move 5 to the Trash" doesn't say which records, and nameless ghosts and a real home look the same.

## The change

### 1. One repeat-click guard for the whole app

- New `hooks/useRepeatClickGuard.ts`, mounted once in `App.tsx` (one line). It adds a capture-phase `click` listener on `document`. When `event.detail > 1` and the target (`closest`) is a `button`, `[role="button"]`, `[role="menuitem"]`, `[role="option"]`, `input[type="checkbox"]`, `input[type="radio"]`, `a[href]` or a dialog backdrop (`[data-dialog-backdrop]`, added in `Dialog.tsx` and the other backdrops below), call `preventDefault()` and `stopPropagation()`. The second click of a double-click never reaches React. `dblclick` events still fire, so double-click-to-rename a column header (a Joe praise) keeps working.
- **Opt-out**: `data-allow-repeat` on the element or an ancestor. Apply it to every control meant to be clicked fast: number steppers, Customize's up/down arrows, the calendar's previous/next month, the zoom and size steppers, the grid's sort arrows if they cycle. Find them with `grep -rn "aria-label=\"\\(Next\\|Previous\\|Move up\\|Move down\\|Increase\\|Decrease\\)" src/renderer` and by reading `DashboardCards.tsx` (Customize), `CalendarView.tsx` header and `AppearanceSection.tsx`. A test lists the opted-out controls.
- **Backdrop guard**: `Dialog.tsx` also ignores backdrop clicks for 350 ms after opening (a slow double-click arrives with `detail` reset on some systems). Add `data-dialog-backdrop` to its backdrop, and to the remaining hand-built backdrops (`grep -rn "fixed inset-0" src/renderer/components` and take the ones with an `onClick` close). `RowMenu.tsx` ignores a toggle-close within 350 ms of opening.
- Text inputs, textareas and contenteditable aren't matched, so double-click-to-select-a-word works.

### 2. One record per Add; untouched new records don't stay

- `gridRowSlice.addRow`: an `addingRow` flag (in the slice; returns early while true) covers every caller. If `lastAddedRowId`'s row still exists and is **untouched** (every typed column empty, and no note, checklist item or file, read from the row in memory plus `row.updated_at === row.created_at`), don't create another: focus its name cell again (set `lastAddedRowId` to it again so DataGrid's auto-edit effect runs, `DataGrid.tsx:491-…`, no DataGrid change needed).
- New `gridRowSlice.discardIfUntouched(rowId)`: if the row is untouched, remove it with no toast. Use the existing trash-and-purge path or a plain delete through `ROW_BULK_ACTION`, whichever needs no new channel; check `ipc-row.ts`. Then drop the "Added new {record}" step from the undo stack (`useUndoStore` has `remove(id)` or the equivalent; if not, add `discardTop(id)` there, one function).
- Call sites:
  - `useGridEditing.setEditingCell`: when the cell that was being edited belongs to `lastAddedRowId` and the new value is null or another row, call `discardIfUntouched(prev.rowId)` on the next tick, after the save of a typed value has been applied optimistically. So Esc on the name, or clicking elsewhere without typing, removes it.
  - `gridStore` list switch and `loadGrid`, and on lock: discard an untouched `lastAddedRowId`. That covers Candy and Mark walking away. For the lock, don't race the database closing. The grid store is a module-level zustand store, so it outlives the lock and `lastAddedRowId` is still set after unlock. The `loadGrid` that runs on unlock does the discard. No edit to `settingsStore.ts` or `useAutoLock.ts` (R2 owns those lines). If the store turns out to be reset on lock, keep a module-level `pendingDiscardRowId` in `gridRowSlice.ts` instead.
- The count everywhere follows, since the row really goes.

### 3. The column Trash isn't one key press away

- **Menu order** (`ColumnHeader.tsx:513-545`): Deadline rule… goes *above* Column settings…, so "Column settings…" sits between the rule and the danger item, which keeps its separator. One extra ArrowDown from "Deadline rule…" lands on Column settings, a harmless dialog.
- **Ask when there's something to lose**: `handleDelete` (`:222-228`) also counts the column's non-empty values (from the rows in memory, `useGridStore.getState().rows`). If any exist, or `COLUMN_DEPENDENTS` isn't empty, it opens the existing dialog, which gains one line: "{n} {record:many} have a value in this column. They come back if you restore it from the Trash within 30 days." The button is **Move to the Trash**. An empty column still goes at once with the Undo toast (Q4 stands for empty columns).
- **The Trash page shows columns**: `TrashView.tsx` gains a "Columns" section listing deleted columns for every live list (the same data as `DeletedColumnsSection`, via its existing channel per grid, or one new list-all call if the per-grid call loops badly; check the channel used by `DeletedColumnsSection.tsx`). Each row reads "Background check · from Volunteers · 2 values · 30 days left · **Restore**", and Restore keeps focus on the next row or the section heading. Reuse `DeletedColumnsSection` with a `showListName` prop rather than duplicating it. "Delete forever" keeps its typed confirmation.
- The empty-Trash text says "The Trash is empty" only when there are no records, lists **or** columns.
- **Undo toast**: the description of a column-to-Trash step ends "· Ctrl+Z also undoes", and `UndoToast.tsx` gets `aria-keyshortcuts="Control+Z"` on its Undo button. The toast never takes focus, so Joe's Enter doesn't hit it.
- `faqData.tsx`: the "remove column" answer says "It goes to the Trash (the Trash page lists it under Columns)", and "deleted column" becomes a keyword.

### 4. "It's in the Trash" when search finds nothing

- New channel `ROW_SEARCH_ELSEWHERE (gridId, query)` in `ipc-row.ts` (via `/ipc-channel`; `idArg`, `textArg('Invalid search', { min: 1, max: 200 })`), returning `{ trashed: { count, firstRowId, firstName }, archived: { count, firstRowId, firstName } }`. It matches on the display name and text cells the way the grid search does, `LIMIT` 50, and reads trashed rows **on purpose** with `archivedRow('r')` / the trashed filter from `shared/liveRecords.ts`. Add it to `tests/soft-delete-invariant.test.ts` as an intended trash/archive reader, so the invariant test knows.
- `GridNotices.tsx:33`: under "No {records} found…", one line per non-zero count, each a link button: "Bergstrom home is in the Trash · Show" (opens `/trash` with the search filled in) and "Olson home is archived · Show" (turns on "Show archived" with the search kept). Debounced 300 ms after typing stops.

### 5. Bulk Trash says what it's trashing

`BulkActionBar.tsx`: the label names up to two records and counts the rest, keeping nameless ones apart: "Move Bergstrom home and 4 unnamed to the Trash". With more: "Move Bergstrom home, Nowak home and 3 more to the Trash". The toast after it names them the same way. The selected-row colour is R5's (SortableRow).

## Files owned

- `src/renderer/hooks/useRepeatClickGuard.ts` (new)
- `src/renderer/components/ui/Dialog.tsx`, `src/renderer/components/ui/RowMenu.tsx`
- `src/renderer/stores/gridRowSlice.ts`, `src/renderer/hooks/useGridEditing.ts`, `src/renderer/stores/gridStore.ts` (list-switch hunk only), and `undoStore.ts` (`discardTop` only, if missing)
- `src/renderer/views/TrashView.tsx`, `src/renderer/components/grid/DeletedColumnsSection.tsx`
- `src/renderer/components/shared/UndoToast.tsx`
- `src/renderer/components/grid/GridNotices.tsx`, `src/renderer/components/grid/BulkActionBar.tsx`
- `src/main/ipc/ipc-row.ts` (`ROW_SEARCH_ELSEWHERE`, appended)
- The `data-allow-repeat` attributes in the files that have steppers (one attribute each)
- Tests: `tests/renderer/hooks/useRepeatClickGuard.test.tsx` (new), `tests/renderer/stores/gridRowSlice.test.ts`, `tests/renderer/hooks/useGridEditing.test.ts`, the TrashView, DeletedColumnsSection, GridNotices, BulkActionBar and ColumnHeader tests, `tests/ipc-row.test.ts`, `tests/soft-delete-invariant.test.ts` (append).

**Shared hunks:**
- `src/renderer/components/grid/ColumnHeader.tsx`: only the menu block (`:497-545`, order) and `handleDelete` plus its dialog text (`:222-228`, the delete dialog block ~`:600-640`). **R5 owns the header buttons (`:340-420`) and merges after R3.**
- `src/renderer/App.tsx`: one line (R2 adds its own line).
- `src/shared/ipc-channels.ts`, `src/shared/ipc-contract.ts`: append-only.
- `src/renderer/views/help/faqData.tsx`: the remove-column answer only.

## Commit steps

`npm run gate` before every commit.

1. **Repeat-click guard.** The hook, App mount, `data-dialog-backdrop`, the backdrop and RowMenu timing guards, `data-allow-repeat` on steppers. Tests: a `dblclick` sequence (click detail 1, click detail 2) on a button runs `onClick` once; on a checkbox it stays ticked; a RowMenu trigger double-clicked stays open; a Dialog opened by a double-click stays open; a `data-allow-repeat` stepper counts 2; a text input's double-click selection is unaffected; `onDoubleClick` on a header still fires.
2. **One Add; untouched records go.** `addingRow`, reuse of the untouched row, `discardIfUntouched`, the call sites. Tests: two `addRow()` calls in a row create one row; Add → Esc → zero rows and no undo step; Add → type a name → stays; Add → switch list → gone; a row with a note isn't discarded.
3. **Column Trash.** Menu order, the value-count confirmation, the Trash page Columns section, the toast text, the FAQ line. Tests: a column with values opens the dialog with the count; an empty column goes at once with Undo; the menu order (Deadline rule…, Column settings…, separator, Move column to the Trash); TrashView lists a deleted column and Restore brings it back with values.
4. **Search elsewhere.** The channel, contract, handler, invariant entry, GridNotices lines. Tests: main returns counts for trashed and archived matches and doesn't return live ones; GridNotices shows "in the Trash · Show" and the link navigates.
5. **Bulk names.** BulkActionBar label and toast. Tests: labels for 1, 2, 5 and unnamed rows.
6. **Decision Log row, screenshots.**

## Acceptance

- **Joe's spec as regression** (`e2e/ux-review/persona-joe.spec.ts`, phases in order with `JOE_PHASE`; copy the harness into the worktree):
  - p2 and p6: double-click Add Client → **one** new row each time, and "6 clients" for six homes (compare `p6-02-four-more.png`).
  - p4 and p11: double-clicking the column ⋯ and the row ⋯ leaves the menu open.
  - p9: double-clicking Done on Lindquist's renewal opens the renewal dialog and it stays open (`p9-04-…nothing.png` showed nothing).
  - p1: double-clicking "I agree" leaves it ticked.
  - p8 and p12: searching "berg" after trashing shows "Bergstrom home is in the Trash · Show"; "olson" after archiving shows "is archived · Show".
- **Mark** (new `e2e/ux-review/R3.spec.ts`, keyboard only): open a date column's ⋯ menu, End, ArrowUp ×2 lands on "Deadline rule…", one more ArrowDown lands on "Column settings…" not Trash. On Trash with values, a dialog opens. After trashing, the Trash page lists the column under Columns, and Restore returns it with values.
- **Karen** (`k?` blank-row step, or `R3.spec.ts`): "+ Add Student" then Escape → the count is unchanged.
- **Candy** (`candy 3` preamble): Add Patient, then navigate to Settings and back → no blank patient.
- Screenshots (`shotter('R3')`, light and dark, 1366×768): `R3/trash-columns.{light,dark}.png`, `R3/column-trash-confirm.light.png`, `R3/search-elsewhere.light.png`, `R3/bulk-names.light.png`.
- Unit tests above; `npm run gate` green; the `ipc-consistency`, soft-delete invariant and `confirmationPolicy` tests updated (the column dialog is still a dependents-rule confirmation, so it stays on the allow-list with the new reason: "column has values or dependents").
- No migration, no network call. Vocabulary layer for every record or list word. 44 px link buttons, 15 px text, 3 px rings.

## Risks

- **The global guard is broad.** A control that legitimately counts fast clicks and isn't opted out stops at one per double-click interval. Mitigation: the opt-out list and its test, plus a sweep of `onClick` handlers that increment (`grep -rn "+ 1\|- 1" src/renderer --include=*.tsx | grep onClick`). Owner decision listed.
- **Discarding untouched records**: "untouched" must be conservative. Any typed cell, note, checklist item, attachment, tag, star or priority level means touched. The row was created seconds ago in the same session (`lastAddedRowId`), so nothing older is ever removed. It's a real delete, not a Trash move, because a ghost in the Trash is clutter too. The undo step "Added new {record}" is dropped with it.
- **The column confirmation partly reverses Phase 2 Q4** for columns that hold values. It's argued as the dependents rule ("changes things you can't see from here": 50 volunteers' dates). Decision Log row.
- **Search elsewhere** reads trashed data deliberately. Only names and counts go back, it's limited to the list being searched, and it's listed in the invariant test.

## Decision Log row

`| 2026-10-xx | The second click of a double-click is ignored on buttons, menu items, checkboxes and dialog backdrops (data-allow-repeat opts out steppers); Add makes one record at a time and a new record left untouched is removed; a column that holds values asks before going to the Trash (empty columns still go at once with Undo) and the Trash page lists deleted columns; search with no matches says when a record is in the Trash or archived | 2026-10-15 persona study: double-clicks made duplicate records and menus that blink shut (Joe), a nameless record stayed and was counted (Karen, Mark, Candy), and one extra arrow press trashed a column the Trash page couldn't find (Mark). Extends Q4's dependents rule to columns with values |`
