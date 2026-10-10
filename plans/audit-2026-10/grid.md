# Audit: the list (grid) view and the board

Reviewer area: the list view, its toolbar, columns, cells, filters/search/sort/group, selection and bulk actions, find and replace, deadline colors, links, archive and trash, the board, list settings, new list and multiple lists. ID prefix **G**.

Evidence notes:
- `test-results/ui-tour/current/` does not exist on disk, so none of the `10-grid*` or `33-client-menu*` screenshots could be checked.
- In `test-results/audit-tour/`, only `07-grid-customers.png` and `11-list-settings.png` show what their names say. `08-grid-jobs.png` shows the Customers list. `09-board-jobs.png`, `10-column-menu.png`, `12-filter-open.png`, `13-views-open.png` and `14-add-column.png` show the Dashboard (`10` has the sidebar list menu open). There is no screenshot of the board, the column menu, the filter panel, Views or Add Column.
- `plans/website/screenshots/human-services/01-list.png` is the best picture of deadline colors. `tree-service/01-list.png` and `auto-service/01-list.png` show the toolbar wrapping onto two rows at 1366px.

Nothing was run. Each "confirmed" below comes from reading the code path end to end. Anything I couldn't fully trace is marked **suspected**.

---

## 1. Top 5

1. **Fix the three bugs that can wreck a list:** Bulk Edit crashes on a status column (G-01). Filters, search and grouping carry over to the next list, so it shows up empty with "No customers yet" (G-03). Adding an option to the stage column leaves the board stuck (G-02).
2. **Make "what you see" the unit of every action.** Select all, Ctrl+A, export, find/replace and the record counts should act on the records on screen, not on all records (G-05, G-07, G-27, G-24).
3. **Make deadline cells explain themselves.** Show the due date and a word ("Overdue", "Due in 5 days"), not just the stored date and a color. Add a small color key. Sort deadline columns by due date and add a "Due status" filter (G-09, G-10, G-11, G-12).
4. **Stop promising "Undo" where data is gone,** and stop silently mangling data. Deleting a column and moving a record to another list both destroy data behind an Undo button. Pasted dates aren't normalized, so their deadlines stop working. Delete or paste on a deadline cell wipes its "done" date (G-15, G-16, G-14, G-17).
5. **Calm the toolbar and the column menu with progressive disclosure:** Add, Search, Filter and a single "View" menu up front. Merge Saved filters into Views. Move the advanced column options (logging, update from notes, checklists, format rules) into a "Column settings…" dialog. Make checkboxes behave like checkboxes (G-20, G-21, G-22, G-06).

---

## 2. Findings

### G-01 · Bulk Edit crashes when you pick a status or stage column · Severity: Blocker · Type: bug
- **Where:** `src/renderer/components/grid/BulkEditDialog.tsx:324-343`. Status options are objects `{label,color}` (`ColumnHeader.tsx:154-163`, `src/shared/starters/tree-service.json:217`), but the dialog renders `{opt}` as if it were a string.
- **What the user experiences:** They select 10 jobs, click **Bulk Edit** and choose "Stage" (or any status column). React throws "Objects are not valid as a React child" and the screen is replaced by the error boundary.
- **Why it matters:** Changing the stage or status of many records at once is one of the most common bulk jobs. 10 of the starters have status columns.
- **Fix:** Use `columnOptionLabels(column)` from `shared/stages.ts` to get the option labels. For the stage column, go through `moveToStage` with one undo step (see G-26). Add a test with a status column.
- **Effort:** S

### G-02 · Adding or renaming an option on the stage column leaves the board stuck · Severity: High · Type: logic
- **Where:** `ColumnHeader.tsx:151-169` (Edit options keeps the old `stage` config). `src/main/stages.ts:48-53` (save requires stages to equal the options) and `:104-105` (a move is refused if the value isn't a stage). `StageSettingsDialog.tsx:23-26` (the dialog starts from the saved stages and never picks up new options).
- **What the user experiences:** They add "On hold" through **Edit options…**. Choosing "On hold" in a cell then fails with `"On hold" isn't one of the stages`. The board has no "On hold" lane. Opening the stage settings to fix it fails with "The stages must be the options of Stage. Change the options first…" — but the options already are changed. If they rename "Scheduled" to "Booked", every Scheduled record lands in "No stage".
- **Why it matters:** Lists change over time, and this is a dead end with no visible way out. The only escape is to turn the stage off (which throws away the on-enter actions) and set it up again.
- **Fix:** When saving options on a stage column, merge them into `config.stage.options`: keep the settings of existing options, add new ones at the end, drop removed ones. Better still, make the stage dialog the editor for the options themselves (add, rename, reorder in one place). On rename, offer to update existing records ("Change 12 records from Scheduled to Booked?").
- **Effort:** M

### G-03 · Filters, search and grouping follow you to the next list, which then looks empty · Severity: High · Type: bug
- **Where:** `gridStore.ts:144-215` (`loadGrid` never clears `activeFilters`, `searchQuery`, `groupByColumnId` or `showStarredOnly`). `utils/filterMatch.ts:30-49` (a filter on a column that doesn't exist matches nothing). `FilterBar.tsx:232` (the chip says "Col 412"). `DataGrid.tsx:778-791` (empty state).
- **What the user experiences:** They filter Customers on "Preferred contact equals Text", then click **Jobs** in the sidebar. Jobs shows no records, a blue chip reading "Col 412 equals Text", and the message "No jobs yet — Click Add Job…". Grouping by a Customers column turns into one meaningless group.
- **Why it matters:** Many users will believe their data is gone. It also invites them to add duplicate records.
- **Fix:** Keep filter, search, group and starred state per list (keyed by grid id, like `viewMode`), or reset them in `loadGrid` when the id changes. Also drop any filter or group whose column isn't in the list.
- **Effort:** S

### G-04 · The empty message ignores filters and gives a shortcut that reloads the app · Severity: Medium · Type: usability / bug
- **Where:** `DataGrid.tsx:771-791`. `useGlobalKeyboard.ts:78-87` (the real shortcut is Ctrl+N). `src/main/index.ts:164` (`autoHideMenuBar`, no app menu set on Windows/Linux, so Electron's default menu and its accelerators stay live).
- **What the user experiences:** With a filter or "starred only" on and nothing matching, they read "No customers yet. Click Add… or press **Ctrl+Shift+R**". Ctrl+Shift+R doesn't add a record. **Suspected:** on Windows/Linux it force-reloads the window through Electron's default menu.
- **Why it matters:** The message is wrong in both directions.
- **Fix:** When records exist but are hidden, say "No customers match your filters" with a **Clear filters** button. Show Ctrl+N. Remove the default menu (`Menu.setApplicationMenu(null)` on non-mac) so reload keys don't work in production.
- **Effort:** S

### G-05 · "Select all" and Ctrl+A select records the search is hiding · Severity: High · Type: bug
- **Where:** `GridHeaderRow.tsx:137-143` and `gridKeyboardNav.ts:143-148` use `filteredRows`, which is filtered before the search. The search is applied later by TanStack's `globalFilter` (`DataGrid.tsx:483-497`).
- **What the user experiences:** They search "smith", see 2 records, tick the header checkbox and see "120 customers selected". Then they press **Delete**, **Archive** or **Bulk Edit**, and it acts on all 120.
- **Why it matters:** Mass actions hit records the person never saw. Trash can recover deletes, but bulk edits and archives silently change many records.
- **Fix:** Select from `table.getRowModel().rows`, the rows actually shown. Clear or trim the selection whenever filters or search change. Have the bulk bar say "3 selected (1 hidden by your search)" if any are hidden.
- **Effort:** S

### G-06 · Row checkboxes don't behave like checkboxes · Severity: High · Type: usability
- **Where:** `useGridSelection.ts:49-55`. A plain click clears the other selections and selects only this row. Adding to the selection needs Ctrl.
- **What the user experiences:** They tick three records one after another and end up with only the last one ticked. Without knowing about Ctrl or Shift, they can't build a selection.
- **Why it matters:** Ticking boxes is the most basic selection habit there is. Bulk actions are effectively hidden from Excel-level users.
- **Fix:** A plain click on the checkbox toggles that row. Keep Shift+click for a range. Ctrl+click is no longer needed.
- **Effort:** S

### G-07 · Export ignores the filter, search, selection and sort · Severity: High · Type: logic
- **Where:** `GridToolbar.tsx:154-160` and `:170-175` always send `activeRowIds: []`. `export-csv.ts:20-22` and `export-pdf.ts:74-76` treat empty as "every record". `export-shared.ts:213-219` uses database order, not the on-screen sort.
- **What the user experiences:** They filter to "my 6 overdue clients" and choose **Export as PDF** to hand to a supervisor. The PDF has all 200 clients, in a different order.
- **Why it matters:** For social workers this is also a privacy problem: more client data leaves the app than they meant to share.
- **Fix:** Pass the visible row ids in visible order. Let the column dialog choose between "The 6 shown (filtered)" (default when a filter is on), "The 3 selected" and "All 200". Add hidden columns to the column choice; they are missing today (`GridToolbar.tsx:688`).
- **Effort:** S

### G-08 · Exports and copies print stored values, not what the cell shows · Severity: Medium · Type: logic
- **Where:** `export-shared.ts:192-203` (deadline columns export the "last done" date, tag columns export `["a","b"]`). `gridHelpers.ts:5-21` (copying a link cell copies hidden separator characters, `\u001e` and `\u001f` from `shared/links.ts:74-75`).
- **What the user experiences:** A printed list shows "2025-10-06" under "Annual review" when the screen says "Oct 6, 2026 · in 361 days". Pasting a copied link cell into an email gives garbled text.
- **Fix:** Share one "display text" function between the cell, clipboard and export. For deadline columns, export the due date plus its state.
- **Effort:** M

### G-09 · Deadline cells don't say what the color means or when it's actually due · Severity: High · Type: usability
- **Where:** `SortableRow.tsx:243-263` (the color comes from the due date, but the cell shows the stored date through `CellDisplay.tsx:64-66`, and the explanation is only a native `title` tooltip). Threshold `label`s ("Due soon", "Overdue", `src/main/sample-data.ts:98-106`) are never shown. Screen: `plans/website/screenshots/human-services/01-list.png`.
- **What the user experiences:** A red, orange or yellow date with no words. For an "Every year" rule (`audit-tour/28-settings-alerts.png`) the date shown is the *last* time, while for an "Expires" rule it's the due date itself. The two look the same. You only learn which by hovering slowly over each cell, and that doesn't work with a keyboard or touch.
- **Why it matters:** This is the app's core promise ("what's due"), and the meaning is hidden.
- **Fix:** For date columns with a rule, show the due date with a short state ("Due Oct 6, 2026 · 4 days late") the way deadline columns already do (`CellDisplay.tsx:216-227`), or offer a per-column choice. Add a one-line color key under the toolbar or in the column header menu, built from the rule's threshold labels ("Red = Due today · Flashing = Overdue"). Put the due text in `aria-label`, not only `title`.
- **Effort:** M

### G-10 · Color is the only signal for most deadline states · Severity: Medium · Type: accessibility
- **Where:** `gridConstants.tsx:56-71`. Shapes are drawn only for the old class names (`alert-red` and so on). New rules use hex colors (`#dc2626`, `#facc15`), and those get no shape.
- **What the user experiences:** In the human-services list, "Due today" (solid red), orange and yellow cells have no icon. Only overdue gets the warning triangle. Color-blind users can't tell red from orange or green.
- **Fix:** Pick the shape by position in the rule's threshold order (overdue, today, soon, upcoming), not by class name, or show the threshold label text (G-09).
- **Effort:** S

### G-11 · Sorting a deadline column sorts by "last done", not by when it's due · Severity: Medium · Type: logic
- **Where:** `DataGrid.tsx:440-449`. The default sort compares the stored value. For `deadline` columns that is the last-done date, and for date columns with a rule it's the base date. Rules that depend on other columns, meters or quotas don't follow it at all, and never-done records sort last even when they are the most overdue.
- **What the user experiences:** They click "Next service" to see who's due first and get an order that doesn't match the colors.
- **Fix:** Give deadline-bearing columns a sort function that uses `evaluateRuleForRow(...).daysUntil`: overdue first, then nulls, then done.
- **Effort:** S

### G-12 · No way to filter to "overdue" or "due this week" · Severity: High · Type: usability
- **Where:** `FilterBar.tsx:38-53`. There are no operators for `deadline` columns, so they fall back to text operators that compare the hidden stored date. Date presets are only "In the past" and "Is empty" (`:84-87`).
- **What the user experiences:** The most natural question in this app, "show me who's overdue", can't be asked from the list. The filter offers "Annual review contains …".
- **Fix:** For any column with a rule, add a "Due status" filter (Overdue · Due today · Due in the next 7/30 days · Done · Paused) built on the deadline engine. Add a one-click "Overdue" chip to the toolbar when the list has deadline columns. Power users keep the raw date operators.
- **Effort:** M

### G-13 · Deadline colors that depend on meter, quota, step or extension data go stale · Severity: High · Type: bug (traced, not run)
- **Where:** `gridStore.ts:201-210`. The deadline context arrives after the rows render. `deadlineCalc.ts:61` reads it with `getState()`, but no grid or board component subscribes to `deadlineContext`; only `profile/DeadlinePanel.tsx:128` does. `SortableRow`'s memo (`:436-468`) and `BoardView`'s `prepared` memo (`:187-191`) don't depend on it.
- **What the user experiences:** After opening a list, rules like "every 5,000 miles", "2 contacts a month", step sequences and granted extensions are worked out with empty data. That can mean "unmet" or "late" colors until something else redraws the row. `refreshDeadlineContext` after marking something done doesn't redraw either.
- **Fix:** Subscribe `DataGrid` and `BoardView` to `deadlineContext`, pass a version number into `SortableRow`, and include it in the memo comparison.
- **Effort:** S

### G-14 · Pasted dates aren't converted, so their deadlines quietly stop working · Severity: High · Type: bug
- **Where:** `gridHelpers.ts:30-35` accepts anything `new Date()` can parse and stores the text unchanged. The main process doesn't normalize either (`ipc-cell.ts:78-151`). The deadline engine only reads `YYYY-MM-DD` (`shared/ymd.ts:7-13`).
- **What the user experiences:** They paste "10/6/2026" from Excel into "Last visit". The cell shows it, but the deadline color disappears, sorting puts it in the wrong place and the date filter misbehaves. "March 3" is accepted and becomes year 2001 for filters.
- **Why it matters:** Copying from the old spreadsheet is exactly how this audience moves in.
- **Fix:** Convert pasted dates to `YYYY-MM-DD` with the same parser the importer uses, and refuse ambiguous ones with a clear message. Also validate status and stage pastes against the options, as dropdowns already are.
- **Effort:** S

### G-15 · Delete, Backspace, Paste or "Clear cell" on a deadline column wipes its "done" date · Severity: Medium · Type: bug
- **Where:** `gridKeyboardNav.ts:121-142` and `:162-168`, and `GridContextMenu.tsx:149-181`. The `deadline` type isn't read-only (`shared/types.ts:36`), so `updateCell` writes. Deadline cells can't be typed into, but they do accept keys.
- **What the user experiences:** A user tabs to a deadline cell and presses Delete, or pastes into it. The record's "last done" date is erased and the deadline jumps back to due or overdue. The only feedback is the color change. Undo works if they notice.
- **Fix:** Treat `deadline` like auto-number for typing and paste, and only change it through "Mark done" and "Undo done". Hide "Paste" and "Clear cell" in the menu for columns that can't be typed into.
- **Effort:** S

### G-16 · Clearing a date writes "… completed" into the case notes · Severity: Medium · Type: logic
- **Where:** `src/main/ipc/ipc-cell.ts:127-135`. When a date column logs changes and the new value is empty, the note reads "`<column> completed (was Oct 6, 2026)`".
- **What the user experiences:** They delete a date entered by mistake, and the record's timeline now says the review was completed.
- **Why it matters:** For social workers the case log is an official record.
- **Fix:** Write "`<column>` cleared (was …)". Only "Mark done" should write "completed".
- **Effort:** S

### G-17 · "Undo" after deleting a column brings back an empty column · Severity: High · Type: logic
- **Where:** `gridColumnSlice.ts:149-203` (the comment says "cells not recovered", yet it uses `pushWithToast`, which shows an Undo button). `ipc-grid.ts:296-324` (cells are cascade-deleted).
- **What the user experiences:** After the typed confirmation, a toast says "Deleted column 'Phone' · Undo". Clicking Undo brings back an empty Phone column. Every phone number is gone.
- **Fix:** Either soft-delete columns (`deleted_at`, hidden, purged later) so Undo can restore the cells, or remove the Undo button and say "This can't be undone; your last backup has the data". The soft delete is better, and it also protects stage, link, sort and filter settings that point at the column.
- **Effort:** M

### G-18 · Moving a record to another list deletes columns that don't match, and Undo can't get them back · Severity: High · Type: logic
- **Where:** `src/main/ipc/ipc-row.ts:185-215` (`remapCellsForMove` deletes unmatched cells and their history). `MoveToGridModal.tsx:73-91` (offers Undo). The bulk version only says "Columns with matching names will carry over" (`:327`).
- **What the user experiences:** They move 15 records from "Waitlist" to "Active caseload", then click Undo. The records come back without their waitlist-only fields and history.
- **Fix:** Keep unmatched cells parked (not shown) instead of deleting them, so moving back restores them. Show the bulk dialog the same count the single dialog shows ("Data in 3 columns won't carry over: Referral date, …").
- **Effort:** M

### G-19 · You can't change a column's type, and some types can't be added at all · Severity: Medium · Type: usability
- **Where:** `GridToolbar.tsx:56-71` lacks Notes (long text), Age and Days-until, which exist (`shared/types.ts:30-33`) and appear in starters. Nothing in the UI calls `updateColumn({column_type})`. The confirmation dialog in `GridView.tsx:132-145` is dead code, and it would show raw type names ("auto_number").
- **What the user experiences:** They make "Date of birth" a Text column by mistake. The only fix is to delete it (losing the data, G-17) and add it again. They can't add a multi-line notes column even though their example lists have one.
- **Fix:** Add "Change type…" to the column menu, with a preview of how many values convert cleanly. Add the missing types to Add Column with a one-line description each ("Notes: a longer note shown in italics"). Use plain names: "Web link", not "URL".
- **Effort:** M

### G-20 · A new "Deadline" column says "Choose a rule", but the place to choose is called "Alert Rule" · Severity: Medium · Type: usability / wording
- **Where:** `GridToolbar.tsx:70` (no rule picker when adding). `CellDisplay.tsx:219` ("Choose a rule"). `ColumnHeader.tsx:399-480` ("Alert Rule", "Create alert rule…", "Remove alert"). `ColumnHeader.tsx:229` (header tooltip "Alert: …"). CLAUDE.md says "Deadlines" not "alerts".
- **What the user experiences:** Every cell of the new column reads "Choose a rule" in grey, and nothing in the cell is clickable. They need to know to right-click the header and open "Alert Rule".
- **Fix:** When the type is Deadline (or Date), show "How is it worked out?" with the rule picker right in the Add Column form. Make the "Choose a rule" text a button that opens the picker. Rename the menu to "Deadline rule".
- **Effort:** S

### G-21 · The column menu is long, hidden and mixes everyday and expert options · Severity: Medium · Type: usability
- **Where:** `ColumnHeader.tsx:246-260` (the "⋯" button is `opacity-0` until hover, about 20px, no `hit-44`). `:283-499` (for a date column: sort ×2, rename, hide, pin, log changes, required, format rules, edit options, stage, deadline rule plus a nested picker, "Update from notes", "When marked done, add checklist", delete). The menu is 208px wide, so values get cut off.
- **What the user experiences:** Users who never right-click don't find the menu. Those who do get 14 options, most of them technical.
- **Fix:** Keep Sort, Rename, Hide, Pin, Deadline rule and Delete in the menu. Put the rest in a "Column settings…" dialog with sections (Required, Choices, Deadline, Record changes in notes, Colors) that power users can still open in one click. Make "⋯" always visible at low contrast with a 44px target, and let double-clicking the header rename it.
- **Effort:** M

### G-22 · The toolbar wraps onto two rows and hides reports under "Export" · Severity: Medium · Type: usability
- **Where:** `GridToolbar.tsx:219-697`. Screens: `audit-tour/07-grid-customers.png`, `website/screenshots/*/01-list.png`.
- **What the user experiences:** At 1366px there are 10–14 buttons (Add, Use a form, Add Column, Columns hidden, Export▾, Import, ☆, Filter, Saved, Views, Group, Priority, Archived, List settings) on two rows, with "List settings" alone on the second row. It sits left in one list and right in another because of the spacer. The ☆ button has no text. Reports (Summary, Requirements summary, Missing information, Audit trail, Totals) sit inside **Export**, where nobody looks for them.
- **Fix:** Up front: **Add**, **Filter**, a **View ▾** menu (saved views, group, show archived, starred only, Table/Board) and **More ▾** (Import, Export, Print documents, Add column, Show/hide columns). Give reports their own **Reports ▾** button or link them to the Reports page. Make List settings a gear icon with a label tooltip. Nothing is removed, just grouped.
- **Effort:** M

### G-23 · "Saved" (filters) and "Views" are two overlapping ideas, and Views change the list for good · Severity: Medium · Type: consistency
- **Where:** `FilterBar.tsx:555-569` (Saved = filter presets), `SavedViewsDropdown.tsx`, `gridFilterSlice.ts:164-238` (a view stores filters, sort, group, hidden columns and mode). Applying a view writes column visibility to the database (`:217-234`), and there is no "back to all columns".
- **What the user experiences:** Two bookmark-style buttons next to each other that mostly do the same thing. Picking a view hides columns permanently, so next week the list is still missing columns, and the view can't say which one is "current".
- **Fix:** Merge them into one **Views** menu ("Save what I see now…"). Show the active view's name on the button. Add "Standard view" to reset. Store hidden columns in the view instead of on the columns, or warn first. Move existing filter presets into views.
- **Effort:** M

### G-24 · Counts show every record, not the ones on screen · Severity: Medium · Type: bug
- **Where:** `GridStatusFooter.tsx:12-13` and `:49-51`, `StatusBar.tsx:20-25`, `TopBar.tsx:26-30` (the screen-reader count). All use `rows.length`.
- **What the user experiences:** A search for "smith" shows 1 record while the footer says "8 results" and the status bar says "8 matching". Filters don't change the count either. With records selected, "Sum" adds up every number and money column together (age + dollars).
- **Fix:** Count the rows actually shown ("1 of 8 customers"). Sum per column, or only when one column is focused. Merge the two footer bars (the grid footer and the app status bar repeat each other and cost about 30px of height at 768px).
- **Effort:** S

### G-25 · Search skips phone, email, address, notes, status and tags · Severity: Medium · Type: usability
- **Where:** `DataGrid.tsx:460-472` and `board/boardLanes.ts:39-46`. Only name, text, dropdown, auto-number and link columns are searched.
- **What the user experiences:** "Search customers…" finds nothing for "555-0113", "@gmail", "Maple Ave" or "Gate code". Find & Replace does find these (`FindReplaceBar.tsx:6-8`), so the two tools disagree.
- **Fix:** Search every column that holds text (phone with digits only, tags, status, notes, address, email), sharing one list of searchable types with Find & Replace.
- **Effort:** S

### G-26 · Bulk Edit, Replace All and bulk stage moves flood the undo history · Severity: Medium · Type: logic
- **Where:** `BulkEditDialog.tsx:96-140`. Each `updateCell` pushes its own undo item (`gridStore.ts:577-588`) and then a combined one is pushed. Replace All loops `updateCell` (`GridView.tsx:64-68`). Stage moves push a toast each (`utils/stageMove.ts:34`). The stack holds 100 (`undoStore.ts:113-119`). `failures` never fills because `updateCell` catches its own errors.
- **What the user experiences:** After "Replace all" on 40 cells, Ctrl+Z puts back one cell. After a bulk edit of 120 records, all earlier undo history is gone and the undo list shows 100 lines saying "Changed Status [12]". A bulk stage move shows a stack of toasts.
- **Fix:** Add a `batch` mode to `updateCell` and `moveToStage` that skips the per-cell push, then push one item per bulk action ("Replaced 'Dr.' with 'Doctor' in 40 cells"). Have `updateCell` return success or failure so the failure count is real. Remove the `[columnId]` from undo text (`gridStore.ts:545`). It shows in the Undo tooltip (`TopBar.tsx:155`).
- **Effort:** M

### G-27 · Find & Replace works on hidden records, doesn't scroll and doesn't confirm · Severity: Medium · Type: usability
- **Where:** `FindReplaceBar.tsx:68-82` (matches across all `rows`, ignoring filters and search, in database order). `:120-130` (Replace All has no confirmation). `useGridVirtualizer.ts:50-55` (`scrollToRow` exists but `DataGrid` never calls it).
- **What the user experiences:** "3 / 27" goes to a match that isn't on screen and nothing moves. Replace All changes records hidden by the filter. Replacing "1" with "2" in a money column turns 1,150 into 2,250. On the stage column it errors once per row.
- **Fix:** Limit matches to the visible rows in visible order and scroll to the active match. Confirm Replace All with "Replace in 27 cells across 19 customers?". Match whole values for number, money, status and stage columns.
- **Effort:** S

### G-28 · Adding a record on a long or filtered list seems to do nothing · Severity: High · Type: usability
- **Where:** `gridStore.ts:274-293` (the new row goes at the end). `DataGrid.tsx:589-602` (it focuses and edits the new row but never scrolls; rows outside the virtual window aren't in the page). Filters hide an empty new row straight away (`DataGrid.tsx:207-219`).
- **What the user experiences:** With 200 clients, or a filter on, they click **Add Client** and see no change. Many will click again and end up with several blank records.
- **Fix:** Scroll to the new row (`scrollToRow`) before editing it. If a filter or search would hide it, keep it pinned on screen until it's edited, or open the record's profile or form for entry, with a toast: "Added — it's hidden by your filter. Show it".
- **Effort:** S

### G-29 · Pasting a block from Excel lands in a single cell · Severity: Medium · Type: usability
- **Where:** `gridKeyboardNav.ts:121-141` and `GridContextMenu.tsx:149-170`. Single-cell paste only, with `CELL_BULK_UPDATE` removed (`ipc-cell.ts:153`). Text columns accept anything (`gridHelpers.ts:56`).
- **What the user experiences:** They copy 3 rows × 4 columns from their old spreadsheet and press Ctrl+V on a cell. The whole tab-separated block is stuffed into one Name cell.
- **Fix:** Detect tab or newline in pasted text and either fill the rectangle (one transaction, one undo step, with dates and options checked as in G-14) or refuse with "To bring in many records, use Import". Today the second option is the safe minimum.
- **Effort:** M (fill) / S (refuse)

### G-30 · Starred records look the same as all the others · Severity: Medium · Type: usability
- **Where:** `SortableRow.tsx` never reads `is_starred`. Stars are only set through the right-click menu (`GridContextMenu.tsx:203-210`) and filtered by an unlabeled ☆ button (`FilterBar.tsx:529-537`, tooltip "Show starred only / Show all rows").
- **What the user experiences:** They star a record and nothing visible changes in the list. The ☆ toolbar button seems unrelated to anything.
- **Fix:** Show a clickable star next to the profile button on every row (filled when starred, faint outline on hover), and label the toolbar toggle "Starred".
- **Effort:** S

### G-31 · Opening a record from the list depends on a tiny icon, and there's no keyboard way · Severity: Medium · Type: accessibility
- **Where:** `SortableRow.tsx:182-201` (a 28px icon with `tabIndex=-1`). There is no key to open a record (`gridKeyboardNav.ts`, `KeyboardShortcutsModal.tsx:39-56`). `LinkCell.tsx:29-31`: a single click on a link chip leaves the list, while a single click on any other cell only selects it.
- **What the user experiences:** Spreadsheet users click the name and expect it to open, but it doesn't. Keyboard users can't open a record at all except through the command palette. Clicking a link cell to select it unexpectedly jumps to another record.
- **Fix:** Add "Open" as the first item of the right-click menu, Ctrl+Enter (or Shift+Enter) to open the focused record, and an "Open" link that appears on hover in the name cell. Make link chips open on Ctrl+click or from the picker; a single click just selects the cell.
- **Effort:** S

### G-32 · Keyboard: hundreds of tab stops, Tab never leaves, and columns can't be reordered without a mouse · Severity: Medium · Type: accessibility
- **Where:** `SortableRow.tsx:326` (`tabIndex={0}` on every cell). `gridKeyboardNav.ts:68-72` (Tab is always captured, including at the last cell). `ColumnHeader.tsx:181-192` (drag handle `tabIndex=-1`, no "Move left/right"). `GridContextMenu.tsx:116-131` and `useGridContextMenu.ts` (`role="menu"` without arrow keys, Escape or focus on open).
- **What the user experiences:** With a keyboard they can get into the list but not out of it with Tab. Reordering columns and moving through menus need a mouse.
- **Fix:** Use a roving tabindex (one tab stop for the grid, arrows inside). Let Tab on the last cell, or Ctrl+Tab, leave the grid. Add "Move left / Move right" to the column menu. Give menus arrow and Escape handling (one shared `Menu` component).
- **Effort:** M

### G-33 · Board: moving a card without dragging is a secret, and some toolbar controls do nothing there · Severity: Medium · Type: usability / accessibility
- **Where:** `BoardView.tsx:242-252` and `:282` (Ctrl+Shift+←/→ is described only in screen-reader text). There is no "Move to…" on cards. The `GridToolbar` stays the same in board mode (Group, sort, Add Column, Priority sort have no effect). `:318-322` ("12 older jobs hidden" with no way to show them). `:130-153` (card-fields popover has no click-away or Escape).
- **What the user experiences:** On a touchpad, or with shaky hands, dragging is hard and there's no visible alternative. Clicking **Group** on the board seems to do nothing. Done cards vanish with a count but no "Show".
- **Fix:** Add a small "Move to ▾" on each card (or on right-click) listing the stages. Show the key hint as visible text in the board header. Hide or disable table-only controls in board mode. Make "12 older hidden" a button that shows them. Close the popover on click-away and Escape.
- **Effort:** S–M

### G-34 · Delete friction is backwards: recoverable bulk delete needs typing, and its undo is missing · Severity: Medium · Type: consistency
- **Where:** `GridDialogs.tsx:157-175` (bulk "Move to trash" needs typing "TRASH 12", and pushes no undo). `:85-103` (single delete is a plain confirm with an Undo toast). `ColumnHeader.tsx:573-585` (column delete, which really is permanent, needs the column name typed). `BulkActionBar.tsx:54-205` (seven differently colored buttons, "Delete" here vs "Move to trash" elsewhere, "✕" with only a `title`).
- **What the user experiences:** Moving 12 records to the recoverable trash takes more effort than destroying a column, and then has no Undo.
- **Fix:** Bulk move to trash: a plain confirm plus an Undo toast (one undo step through `ROW_BULK_ACTION 'restore'`). Keep typed confirmation only for permanent actions. One neutral button style, with red only for "Move to trash". Give "✕" an `aria-label`.
- **Effort:** S

### G-35 · The trash tells people to restore a deleted list from Settings, which isn't possible · Severity: Medium · Type: logic / wording
- **Where:** `TrashView.tsx:219-227`. There is no `GRID_RESTORE` channel (`shared/ipc-channels.ts:3-9`). `ipc-grid.ts:173-183` is a soft delete, while the delete dialog says "permanently… cannot be undone" (`Sidebar.tsx:57-60`).
- **What the user experiences:** A record from a deleted list is stuck in Trash, with instructions that lead nowhere.
- **Fix:** Add "Deleted lists" under Settings → Data with Restore, since the data is still there, or change the message to "This record's list was deleted. You can only remove it permanently." The first is kinder.
- **Effort:** M (restore) / S (message)

### G-36 · "Edit options…" may open where it can't be seen, and renaming an option orphans existing values · Severity: Medium · Type: bug (suspected) / logic
- **Where:** `ColumnHeader.tsx:521-567`. The panel is `absolute … top-full` inside the header, and the header wrapper is `overflow-x-hidden` (`DataGrid.tsx:687`), which forces vertical overflow to `auto`, so the panel should be clipped to the header's height. **Suspected:** none of the available screenshots show this panel. `:151-169` saves new labels without touching existing cells.
- **What the user experiences:** Possibly a sliver of a panel or a small scroll area in the header. After renaming "Pending" to "Waiting", old records still say "Pending" in grey, and the dropdown shows "— Select —" for them.
- **Fix:** Render the editor in a portal or a small modal, like the column menu. When an option is renamed, offer to update the N records that use it, and when one is removed, say how many records still use it.
- **Effort:** S

### G-37 · Two separate tag systems · Severity: Medium · Type: consistency
- **Where:** The "Tags" column type (`CellDisplay.tsx:179-193`) versus profile tags, which are edited only in `profile/ProfileHeader.tsx`, never shown in the list, and offered in filters as "🏷 Row Tags", the first option (`FilterBar.tsx:326`, `:649`).
- **What the user experiences:** Tags added on a profile can't be seen in the list but can be filtered on under a name ("Row Tags") that matches nothing they've seen.
- **Fix:** Pick one. Simplest: show profile tags as a built-in "Tags" column (hideable), rename the filter entry "Tags (from profile)", or move profile tags into a real tag column.
- **Effort:** M

### G-38 · Jargon and vocabulary leaks in the list · Severity: Low · Type: wording
- **Where:**
  - "rows": `FilterBar.tsx:533`, `GridGroupHeader`/`GroupingBar.tsx:108,117`, `GridContextMenu.tsx:240,430`, `GridHeaderRow.tsx:158`.
  - "grid": `GridDialogs.tsx:38`, `FindReplaceBar` placeholder "Find in grid…", `DataGrid.tsx:666`.
  - "Operator", "AND/OR": `FilterBar.tsx:219,372`.
  - Raw type names in the Group menu ("dropdown", "status"): `GroupingBar.tsx:212`.
  - The priority header hard-codes "Ac": `GridHeaderRow.tsx:198`.
  - "Conditional format…", "Format rules", "Alert Rule": `GridContextMenu.tsx:389`, `ColumnHeader.tsx:363,408`.
  - "Saved Filter Presets": `FilterBar.tsx:762`.
  - ISO dates in filter chips ("before 2026-10-10").
- **Fix:** Use the vocabulary words (customers, list) and plain labels: "Match all / any", "Condition", "Color rules…", "Deadline rule". Show the priority abbreviation through `t('priority')`. Format dates the way cells do.
- **Effort:** S

### G-39 · Small text and small targets in the list chrome · Severity: Low · Type: accessibility
- **Where:**
  - 12px text: the tip banner (`DataGrid.tsx:672` `text-xs`), the empty-state kbd, the Find bar title and counter (`FindReplaceBar` `text-xs`), "Grouped by" (`GroupingBar.tsx:156`).
  - 14px text: the footer (`GridStatusFooter.tsx:43` `text-sm`, 28px tall), filter chips (`FilterBar.tsx:228`), archive dialog body (`GridDialogs.tsx:37`).
  - Toolbar buttons are 36px with no `hit-44` (`GridToolbar.tsx:241` and others).
  - The grouping "×" is a `span role=button` inside a button (`GroupingBar.tsx:124-145`).
  - Many buttons have both a custom Tooltip and a native `title`, so two tooltips appear.
- **Fix:** Bring all of these to 15px and 44px (`btn-compact` already gives a 44px hit area). Replace the nested button. Drop the duplicate `title`s.
- **Effort:** S

### G-40 · "In the past" date filter freezes on the day the app started · Severity: Low · Type: bug
- **Where:** `FilterBar.tsx:84-86`. `localDateString()` runs once at module load, and saved filters and views store the fixed date.
- **What the user experiences:** A saved "Last visit in the past" view keeps using the date it was saved on. If the app is left open overnight, today's records are treated as being in the future.
- **Fix:** Store a relative token (`before: "today"`) and resolve it when matching. Show the chip as "in the past".
- **Effort:** S

### G-41 · List settings throws away edits when you jump to Monthly requirements · Severity: Low · Type: usability
- **Where:** `GridToolbar.tsx:650-651` (`onOpenRequirements` closes the dialog). `ListSettingsDialog.tsx:89-93` (Escape or a backdrop click also discard changes silently).
- **What the user experiences:** They rename the list and change its words, click "Monthly requirements…", and the changes are gone.
- **Fix:** Save first, or ask "Save changes first?". Also consider making List settings the one home for list structure: columns (show/hide/order), stage, and default sort.
- **Effort:** S

### G-42 · "Pin column" pins every column to its left as well · Severity: Low · Type: usability
- **Where:** `ColumnHeader.tsx:317-332` (sets the frozen count to `colIndex + 1`). It's also `text-sm` without `hit-44`, unlike its neighbors.
- **What the user experiences:** They pin "Phone" (the 4th column) and the first four columns stick, which takes up most of a laptop screen.
- **Fix:** Label it "Keep columns up to here in view", or move the pinned column to the front and pin just it.
- **Effort:** S

### G-43 · Number and money columns sort as text in some cases · Severity: Low · Type: bug
- **Where:** `DataGrid.tsx:440-449` uses `localeCompare(..., {numeric:true})` for every type. Decimals sort wrong (1.5 comes before 1.25), as do negatives (-10 after -5).
- **Fix:** Add a numeric sort function for `number` and `currency`, and use the ISO date for `date`.
- **Effort:** S

### G-44 · The page title and status bar keep showing the last list on Dashboard and Settings · Severity: Low · Type: consistency
- **Where:** `TopBar.tsx:115-121` and `StatusBar.tsx` are shown on every page. Screens: `audit-tour/09-…`, `12-…`, `28-settings-alerts.png` all read "Customers" and "8 customers" while showing the Dashboard or Settings.
- **What the user experiences:** With several lists, "Customers" over the Dashboard suggests the dashboard only covers customers.
- **Fix:** Show the page name (Dashboard, Settings), and show list counts only on the list page.
- **Effort:** S

---

## 3. Things that work well (keep them)

- **Undo for single actions** (cell edits merged per cell, archive, move to trash, duplicate, column add and rename, stage moves bundled with their on-enter actions) with a toast and history list. `stageMove.ts` is a good model for G-26.
- **Optimistic cell edits with rollback** and a human error message (`gridStore.ts:591-599`).
- **Typed confirmation for permanent column delete**, and a plain-language warning when deleting a list that has links (`Sidebar.tsx:62-66`).
- **New list dialog** (`NewListDialog.tsx`): name, kind, words guessed from the name, suggested columns with checkboxes. Clear and friendly.
- **List settings' display-name builder** with clickable column chips and a live "Example:" preview (`audit-tour/11-list-settings.png`).
- **Board basics:** lanes in stage order, nearest deadline first, "N days here", accessible card buttons with an `aria-live` announcement after moves, and done cards hidden after a set number of days.
- **Filter quick presets** ("Is empty", "Is checked", "Contains…") and a link-aware "links to" filter.
- **Link picker** (`LinkPicker.tsx`): keyboard combobox, create-new-from-search, Escape to close.
- **Frozen name column and virtual scrolling.** 200+ records stay smooth, and the frozen divider is easy to see.
- **Vocabulary is used almost everywhere** in the toolbar and dialogs ("Add Customer", "Search customers…", "Caseload settings").
- **Pasting into a dropdown checks it against the options,** and pasting into a number column strips `$` and `,`. Extend this to dates and status columns (G-14).
- **Dark mode** colors are set throughout these components.
