# Logic and data model audit (area L)

Reviewer: core code logic and the data model. Every finding was traced through the code; anything not fully confirmed says **suspected**. Line numbers are as of commit 16fe662.

## Top 5

1. **Make Undo honest.** Restoring a deleted checklist item always fails (L-01). About 50 undo steps ignore errors and say "undone" anyway (L-08). Undoing "Delete column" brings back an empty column (L-09).
2. **Give notes and "Mark done" a "when it happened" date**, and when a note is voided or deleted, put back the dates it moved (L-04, L-05). Today, compliance counts and next-due dates follow the moment someone typed, and voiding the note doesn't undo its date changes.
3. **Guard deletes that break logic somewhere else.** That means deadline rules (L-02), note types (L-15) and columns (L-10). Show where the thing is used, then block the delete or clean up in the same transaction. Right now a deleted rule turns plain dates into fake overdue deadlines on the dashboard.
4. **Make "Remove sample data" keep the person's own work** (L-06). Give archive, trash and deleted lists one clear status model (L-12, L-13, L-14).
5. **Load a record's page by its own id** (L-07). Archived records and records from other lists currently show "not found". Also make checklist "Repeat" actually repeat, or remove the option (L-03).

## Findings

### L-01 · Undo of a deleted checklist item silently fails, every time
Severity: **High** · Type: bug
- **Where:** `src/main/ipc/ipc-checklists.ts:165-187`. The INSERT includes `updated_at`, but `checklist_items` has no such column (`migrations/001_initial_schema.ts:108-124`, and no migration adds one). The existing test records the bug: `tests/ipc-checklists.test.ts:337-339` ("BUG: handler INSERT includes `updated_at`… expect(r.ok).toBe(false)"). Callers: `src/renderer/components/profile/Checklist.tsx:259-284` (delete one) and `:359-380` ("Clear completed").
- **What the user experiences:** They delete a checklist item, or clear all completed items, and press Undo. The toast says it was undone, but the items never come back. The delete has no confirmation because Undo is the safety net.
- **Why it matters:** Permanent data loss behind a promise that it can be undone.
- **Fix:** Drop `updated_at` from the INSERT, then flip the test to expect `ok: true`. Also covered by the systemic fix in L-08.
- **Effort:** S

### L-02 · Deleting a deadline rule makes plain dates show up as overdue deadlines
Severity: **High** · Type: bug
- **Where:**
  - `src/main/ipc/ipc-alerts.ts:95-104` deletes the rule without checking whether it is used.
  - `src/renderer/components/settings/AlertsSection.tsx:76-81`: one click, no confirmation.
  - `src/renderer/components/grid/ColumnHeader.tsx:588-596` says "This rule will be removed from all columns that use it", but it only clears the current column.
  - `src/main/deadlines.ts:88-90` LEFT JOINs the missing rule and keeps the cell. `src/shared/deadlineEngine.ts:280-287` then adds a zero interval, so the due date is the date itself.
  - In the grid, `CellDisplay.tsx:216-219` / `SortableRow.tsx:244-247` find no rule and show nothing.
  - Screenshot: `test-results/audit-tour/28-settings-alerts.png` (trash icon on every rule).
- **What the user experiences:** They delete the "Every year" rule in Settings, which is still attached to "Last Visit" in another list. The dashboard and morning briefing now list every client's last-visit date as overdue. The grid shows no color at all, so the two screens disagree and nothing explains why.
- **Why it matters:** Wrong deadlines on the main screen, caused by a cleanup action.
- **Fix:** When a rule is in use, list the columns and lists that use it. Either block the delete, or clear `alert_rule_id` from every one of those columns in the same transaction. Change the deadlines query to an INNER JOIN so a missing rule never produces a deadline. Add a confirmation in Settings → Alerts.
- **Effort:** S

### L-03 · Checklist "Repeat" and "Repeats every N days" do nothing
Severity: **High** · Type: logic
- **Where:**
  - The Repeat picker: `ChecklistAddDialog.tsx:137-145` and `ChecklistItem.tsx:151-159`.
  - `recurrence_rule` is saved (`ipc-checklists.ts:37-39`) but nothing in main reads it.
  - Completing an item (`Checklist.tsx:165-191`, `ipc-checklists.ts:44-90`) never makes the next one.
  - The template's `is_recurring` / `recurrence_days` are ignored by `src/main/checklist-apply.ts:7-30`.
- **What the user experiences:** They add "Monthly med review" with Repeat: monthly. They tick it off once, and it never comes back.
- **Why it matters:** A recurring duty silently stops being tracked after the first time. Caseload tasks do repeat (`ipc-tasks.ts:110-150`), so the two features behave differently.
- **Fix:** When an item with a rule is completed, move its due date forward and reopen it, the same way `TASK_COMPLETE` does. Share one recurrence helper (see L-31). Until that's built, hide the Repeat field.
- **Effort:** M

### L-04 · Notes and "Mark done" can only be dated "now"
Severity: **High** · Type: logic
- **Where:**
  - `src/main/ipc/ipc-caselog.ts:57-60`: `created_at` is always `datetime('now')`. The composer only has a follow-up date (`CaseLog.tsx:604-622`).
  - Everything else counts from that time:
    - Requirements: `contact-requirements.ts:95-99`.
    - Quota rules: `deadlines.ts:182-195`.
    - "Last visit" auto-dates: `note-date-updates.ts:17`, which defaults to today.
    - Reports: `report-builder.ts:223`.
  - "Mark done" also stamps today (`views/dashboard/completeDeadline.ts:84-86`), and so do stage stamps (`stages.ts:123`).
- **What the user experiences:** A worker visits on Friday, September 30 and writes the note Monday, October 3. September's "1 face-to-face" requirement shows as missed. "Last Face-to-Face" becomes October 3, so the next visit is due 3 days late. The same thing happens when an annual review done last week is marked done today.
- **Why it matters:** For the core audience, compliance is counted by when the contact happened. This produces wrong compliance results and wrong next-due dates.
- **Fix:** Add an optional "When" date to the note composer (default today; a time is optional) and store it in a new `occurred_at` column. Use it for requirements, quota, note-driven dates and reports, and keep `created_at` as the audit time. Give "Mark done" the same date picker (default today).
- **Effort:** L

### L-05 · Voiding or deleting a note leaves the dates it moved
Severity: **High** · Type: bug
- **Where:**
  - `note-date-updates.ts:17-55` moves dates when a note is logged.
  - `CASE_LOG_VOID` (`ipc-caselog.ts:136-148`) and `CASE_LOG_DELETE` (`:97-114`) never look at those dates.
  - Only the 10-minute Undo puts them back (`CaseLog.tsx:290-301`).
  - Form notes have the same gap (L-24).
- **What the user experiences:** A visit note is logged on the wrong client. The worker voids it the next day, which is the documented path for older notes. The wrong client's "Last Face-to-Face" stays at that day, so their real overdue visit disappears from the dashboard.
- **Why it matters:** It hides an overdue deadline, which is exactly what the app exists to show.
- **Fix:** Record which cells each note moved, either in a small `note_date_updates` table or via the `cell_history` source. On void or delete, recompute each affected column from the latest remaining note of the listed types. Never move a column back past a value someone later typed by hand. Tell the user: "Also set Last Visit back to Sep 2".
- **Effort:** M

### L-06 · "Remove sample data" deletes the person's own work despite saying it won't
Severity: **High** · Type: bug
- **Where:**
  - `src/main/sample-data.ts:162-178` hard-deletes the whole sample list. That includes records the person added to it, their notes, forms, reports, rules, and links to real records.
  - `:67-80` hard-deletes starter sample records by id. That takes any notes, files, appointments and links the person added to them, and any sample record they turned into a real customer. It even deletes records they moved into other lists.
  - The confirmation in `SampleDataBanner.tsx:63-65` says "Anything you created yourself is not affected." There is no Undo.
- **What the user experiences:** They try the example, rename "Sample customer" to a real one, and log three real visits on it. Later they click "Remove sample data" and those visits are gone for good.
- **Why it matters:** Silent loss of real records, with a dialog that promised the opposite.
- **Fix:**
  - Before removing, count anything that wasn't generated: records in the sample list that aren't sample ids, non-generated notes, files and appointments on sample records, and sample records edited after they were created. Show that count.
  - Default to keeping records with your own changes, and offer "remove those too" as a choice.
  - Move removed records to the trash instead of hard-deleting, so the trash provides the undo.
  - Never remove a sample record that now sits in a different list.
- **Effort:** M

### L-07 · A record's page shows "not found" for archived records and records in another list
Severity: **High** · Type: bug
- **Where:**
  - `src/renderer/views/ProfileView.tsx:240` looks for the record only among the rows the grid store has loaded.
  - `gridStore.ts:153-158` loads archived rows only while "show archived" is on.
  - Callers that don't pass `?gridId=`: `TopBar.tsx:260-263` (Recent menu) and `FocusModeView.tsx:227-230`.
  - Callers whose target is archived: `RecentlyArchivedTab.tsx:73,97`.
  - Message at `ProfileView.tsx:353`. Screenshot: `test-results/audit-tour/17-profile-job.png` ("Customer not found", under the Customers breadcrumb while opening a job).
- **What the user experiences:**
  - On the dashboard's "Recently archived" tab, clicking a person gives "not found — it may have been archived or deleted."
  - Picking a record from another list in the Recent menu gives the same message.
- **Why it matters:** The record page is the main place to read history, and it can't be reached from several paths that point to it.
- **Fix:** Have ProfileView fetch its record by id with the existing `ROW_GET`, allowing archived rows. Look up the record's list from the row, switch to that list if needed, and stop depending on what the grid happens to have loaded. Show "This record is archived" with an Unarchive button.
- **Effort:** M

### L-08 · Undo reports success when nothing changed
Severity: **High** · Type: bug
- **Where:**
  - `src/renderer/stores/undoStore.ts:164-171` only treats a thrown error as a failure.
  - `safeInvoke` never throws (`utils/safeInvoke.ts:31-40`).
  - That leaves 52 `safeInvoke` calls in undo/redo callbacks, across 22 files, that ignore `{ ok: false }`. Examples: `Checklist.tsx:274-277`, `CaseLog.tsx:292-301`, `completeDeadline.ts:116-133`, `stageMove.ts:47`.
  - `gridColumnSlice.ts:183-185` catches its own errors and returns normally.
- **What the user experiences:** They press Undo, the change stays, and the item still moves to Redo as if it worked. L-01 is one visible case. Others: a note past the delete window, a record created more than 60 seconds ago, a record deleted elsewhere.
- **Why it matters:** People rely on Undo instead of confirmation dialogs, so a silent failure is worse than no Undo at all.
- **Fix:**
  - Add a `mustInvoke()` helper that throws on `!ok` and use it in every undo/redo callback. A lint rule can flag `safeInvoke` inside `undo:`/`redo:`.
  - Show the specific reason, e.g. "This note is older than 10 minutes, so it was voided instead".
  - Don't swallow errors inside callbacks.
- **Effort:** M

### L-09 · Undoing "Delete column" brings back an empty column
Severity: Medium · Type: logic
- **Where:**
  - `src/renderer/stores/gridColumnSlice.ts:149-203` (the comment there says "cells not recovered").
  - The column comes back at the end with a new id. Every value is gone, along with change history, extensions and sequence progress (cascade), highlights, and anything else that pointed at the old id.
  - The typed confirmation in `ColumnHeader.tsx:573-585` correctly says the data goes, but the Undo toast afterwards suggests otherwise.
- **What the user experiences:** They type the column name to confirm, see "Deleted column 'Phone' · Undo", click Undo, and get an empty "Phone" column at the far right.
- **Why it matters:** It looks like a recovery but isn't one, and the person may not notice the values are gone.
- **Fix:** Short term, don't offer Undo for column deletes: the typed confirmation is the safeguard. Better, soft-delete columns (`deleted_at` plus hidden) for 30 days, with a "Deleted columns" section under list settings and a real undo.
- **Effort:** S (wording) / M (soft delete)

### L-10 · Deleting a column breaks what depends on it, and can leave stale names
Severity: Medium · Type: logic
- **Where:**
  - `src/main/ipc/ipc-grid.ts:296-324` checks nothing. Rules can refer to other columns: relative anchors, quota start/end, meter readings, sequence anchors, stage `stampColumnId`, appointment series `untilColumnId`, the source of a calculated or age column, sort, saved views and reports. All of them keep the dead id. Forms do handle this (`forms.ts:26-32`).
  - When the name column is deleted, the role passes to whatever column comes first, of any type (`:305-315`). Names are refreshed only if the list has a display format (`:318`). Otherwise `rows.display_name` keeps the old names: the triggers fire on cell writes, not on a change of name column (`display-names.ts:16-35`).
  - Nothing lets the user choose the name column.
- **What the user experiences:**
  - They delete "Start date" and a "within 30 days of start" rule quietly stops showing anything.
  - They delete "Client Name". The grid now names people by the next column (say, "Program"), while the dashboard, search, calendar and links still show the old names.
- **Why it matters:** Deadlines quietly stop working, and record names don't match from one screen to another.
- **Fix:**
  - Before deleting, list the dependents ("Used by: rule 'Within 30 days', form 'Intake'") and require handling them.
  - Always call `refreshDisplayNames(gridId)` when the name column changes.
  - Add "Use as name" to the column menu.
- **Effort:** M

### L-11 · Moving a record to another list, then undoing, loses data and changes its number
Severity: Medium · Type: bug
- **Where:**
  - `src/main/ipc/ipc-row.ts:186-219`: cells and history for columns with no same-named match in the target list are deleted.
  - `:467` clears the acuity level, and `:470` drops links.
  - `:476` re-issues auto-numbers with `overwrite: true`, so the record gets a new number in the target list and another new one when moved back. Numbers are never reused (`auto-number.ts:35-52`), so the original ID is gone for good.
  - Extensions and step progress stay keyed to the old list's column.
  - Undo (`MoveToGridModal.tsx:82-84`) just moves it back.
- **What the user experiences:** They move "J-0042" to the wrong list by mistake and press Undo. It's now "J-0057", and its "Gate code" and history are blank.
- **Why it matters:** Record numbers end up on invoices and paperwork. The data loss is behind an Undo.
- **Fix:**
  - Keep cells for unmatched columns: a cell pointing at a column outside the record's current list is simply not shown, so it comes back on the return move. Alternatively, stash them in a JSON field.
  - Keep the record's existing number on the way back, and put it back on undo.
  - Have the modal list the values that won't carry over.
- **Effort:** M

### L-12 · Restoring an archived record from the trash makes it active again
Severity: Medium · Type: bug
- **Where:** `src/main/ipc/ipc-row.ts:331-341` sets `is_active = 1` without checking `archived_at`. `rows.is_active` stands for both "archived" and "in the trash" (`:243`, `:261`, `:305`).
- **What the user experiences:** They delete a closed (archived) case from the archive view, then restore it. It comes back in the active caseload, with deadlines and monthly requirements counting it again.
- **Why it matters:** A closed case starts producing alerts and inflating active counts.
- **Fix:** Restore with `is_active = CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END`. Longer term, replace `is_active` with a derived status (`archived_at` / `deleted_at`) so the two states can't drift apart.
- **Effort:** S

### L-13 · Deleted lists stay half-alive
Severity: Medium · Type: logic
- **Where:**
  - `ipc-grid.ts:173-183` only marks the list inactive. Nothing restores it, and nothing ever purges it. Its links are hard-deleted at that moment.
  - The deleted list's records still show up in:
    - cross-list search and the command palette (`ipc-row.ts:569-583` has no `g.is_active`),
    - the appointment record picker,
    - the calendar and reminders (`appointments.ts:42-58`, `reminders.ts:139-147`),
    - the dashboard's archived and completed lists (`ipc-dashboard.ts:62-73`, `:81-157`).
  - In the trash they show as "can't restore" (`TrashView.tsx:46,157-179`).
- **What the user experiences:** They delete a test list. Its people still turn up in Ctrl+K and still get appointment reminders. Opening one leads to an empty page (see L-07).
- **Why it matters:** Deleted data that isn't gone is confusing, and it's a privacy surprise.
- **Fix:** Pick one model:
  - (a) A list trash with 30-day restore, keeping a snapshot of the links, then a real purge.
  - (b) Purge right away after the typed confirmation.

  Either way, add `g.is_active = 1` to the search, appointment, reminder and dashboard queries.
- **Effort:** M

### L-14 · Archived records keep their appointments and reminders
Severity: Medium · Type: logic
- **Where:**
  - The appointment queries filter out only `r.deleted_at`: `appointments.ts:42-58` and `:425-434`, `reminders.ts:139-147`.
  - Series keep creating future occurrences (`appointments.ts:146-178`).
  - Archiving doesn't touch appointments (`ipc-row.ts:366-381`).
- **What the user experiences:** They archive a client who left the program and still get "Appointment at 3:00 pm with M.G." every Tuesday.
- **Why it matters:** Closed cases keep producing work. Requirements and deadlines already leave archived records out, so the behavior is inconsistent.
- **Fix:** When archiving, ask "Cancel 6 upcoming appointments?" (default yes) and end the series. Filter `r.is_active = 1` in reminders and the briefing.
- **Effort:** S–M

### L-15 · The "in use" check for note types misses rules, forms and stages
Severity: Medium · Type: bug
- **Where:**
  - `src/main/activity-types.ts:104-131` counts only notes, requirements and `note_updates`.
  - It misses:
    - quota rules (`alert_rules.rule_config.activityTypes`),
    - forms (`forms.log_activity_type`), whose note is then silently skipped (`forms.ts:155`),
    - the stage on-enter note (`stages.ts:126`), which is skipped,
    - appointment types.
- **What the user experiences:** They delete an unused-looking "Authorization visit" type. A quota rule that counts it can never be satisfied, so it stays overdue forever. Their intake form stops logging its note without a word.
- **Why it matters:** Wrong deadlines, and silent loss of the record of a form being filled in.
- **Fix:** Include those uses in `activityTypeUsage` and name them in the message. In the form builder and stage settings, warn when the chosen type is archived.
- **Effort:** S

### L-16 · Undo history is wiped when switching lists
Severity: Medium · Type: usability
- **Where:** `gridStore.ts:144-148` clears the stack whenever a different list loads. Opening a record from the dashboard loads its list (`ProfileView.tsx:213-221`).
- **What the user experiences:** They mark a deadline done on the dashboard, click the client's name to check it, and Undo is now empty.
- **Why it matters:** Undo disappears exactly when someone goes to check their work.
- **Fix:** Undo callbacks already carry row and column ids. Make them independent of the active list (`updateCell` already sends ids to main) and keep the stack across lists. Clear it only on lock, restore and sample removal.
- **Effort:** M

### L-17 · Cell-edit undo merges edits made hours apart
Severity: Medium · Type: bug
- **Where:** `gridStore.ts:546-582` merges any later edit of the same cell into the earlier undo entry. `undoStore.ts:132-146` replaces that entry where it sits in the stack.
- **What the user experiences:** They change Jane's phone at 9:00, edit twenty other cells, then change Jane's phone again at 11:00. The first Ctrl+Z undoes an unrelated 10:59 edit. Later, one Ctrl+Z puts Jane's phone back to its pre-9:00 value, undoing both phone changes at once.
- **Why it matters:** Undo becomes unpredictable.
- **Fix:** Merge only when the matching entry is at the top of the stack and less than about 3 seconds old. Otherwise push a new entry.
- **Effort:** S

### L-18 · Scratch pad loses the last edits when going to the next record
Severity: Medium · Type: bug
- **Where:**
  - `ScratchPad.tsx:112-131` saves 2 seconds after typing to `rowIdRef.current`, read when the timer fires.
  - The page is reused when the route changes (Alt+→ / Next, `ProfileView.tsx:303-333`), so the save-on-unmount flush (`:159-172`) never runs.
  - The new record's content then overwrites the editor.
- **What the user experiences:** They type a reminder in Maria's scratch pad and press Alt+→ within 2 seconds. The reminder is gone. If the next record loads slowly, Maria's text could be saved into the next client's pad (**suspected**; it depends on timing).
- **Why it matters:** Lost notes, with a small chance of writing one client's notes into another's record.
- **Fix:** Render `<ScratchPad key={rowId} …>`, or flush the pending save to the old id inside an effect keyed on `rowId`.
- **Effort:** S

### L-19 · "Highlight → all rows" doesn't apply to records added later
Severity: Medium · Type: consistency
- **Where:**
  - `CellConditionalFormatPanel.tsx:259-264` copies the rule into `cell_formats` for each record loaded right now.
  - `ROW_CREATE` (`ipc-row.ts:283-295`) adds none.
  - About 130 lines of moving and stamping code exist to keep those copies in step (`ipc-row.ts:54-183`), and stamping stops above 2,000 records.
  - The "Auto-Highlight Column" mode (`columns.conditional_format`) does the same job properly.
- **What the user experiences:** They set "highlight in red when over 90" for all rows. The next new client isn't highlighted.
- **Why it matters:** There are two ways to do the same thing, and one of them quietly stops working.
- **Fix:** Make the "all rows" choice save a column rule. Migrate existing stamped copies (rules carrying `originRowId`) into the column rule, and delete the stamping code. Per-cell rules stay available for one-off highlights.
- **Effort:** M

### L-20 · Database errors reach the screen as raw text
Severity: Medium · Type: wording
- **Where:**
  - `src/main/ipc/ipc-utils.ts:69-94` matches patterns like `/SQLITE_CONSTRAINT.*UNIQUE/`. But better-sqlite3 keeps the code in `err.code`; the message itself is only e.g. "UNIQUE constraint failed: tags.grid_id, tags.name" (`node_modules/better-sqlite3-multiple-ciphers/lib/sqlite-error.js`). The tests pass only because they build fake messages (`tests/humanize-error.test.ts:24`). So every raw SQLite message passes straight through.
  - Many `fail()` strings are written for developers: "Invalid ID", `Grid ${id} not found` (`ipc-grid.ts:84`), "Hard delete only allowed for recently-created rows" (`ipc-row.ts:323`), "Invalid reorder payload".
  - A duplicate snippet trigger fails with no message at all (`SnippetsView.tsx:230-231`).
- **What the user experiences:** They see "UNIQUE constraint failed: tags.grid_id, tags.name", or nothing happens.
- **Why it matters:** This breaks the "human error messages" rule, and silent failures leave the person stuck.
- **Fix:**
  - Map on `err.code`, and on the constraint's table for specific wording ("There's already a tag called that").
  - Turn any unmatched error into a generic sentence and log the details.
  - Sweep the `fail()` strings that a person can actually see.
  - Show an error on snippet save.
- **Effort:** S–M

### L-21 · Two-digit-year birthdays import a century off
Severity: Medium · Type: bug
- **Where:** `src/main/import.ts:126-130`. The cutoff is the current year + 10, so in 2026 "30" becomes 2030.
- **What the user experiences:** They import a spreadsheet with "3/15/30" for a 96-year-old client. The birthday becomes 2030, the age column breaks, and annual reviews based on it are wrong.
- **Why it matters:** Aging-services caseloads have many people born 1927–1936, and Excel CSVs often use m/d/yy.
- **Fix:** Use the current year as the cutoff, with no +10. For columns that look like birth dates, or any value landing in the future, use the 1900s and warn: "12 birth dates were read as 19xx — check them".
- **Effort:** S

### L-22 · Clearing a date is logged and counted as "completed"
Severity: Medium · Type: logic
- **Where:**
  - `ipc-cell.ts:127-134` logs "<Column> completed (was …)" whenever a date is cleared.
  - `ipc-dashboard.ts:128-136` counts that text, matched with `LIKE '% completed (was %)'`, as a completion.
- **What the user experiences:** They delete a mistyped review date. The timeline says "Annual Review completed" and the dashboard's Completed list shows it.
- **Why it matters:** The timeline is a legal-ish record, and here it's wrong.
- **Fix:** Log a cleared date as "cleared (was …)". When something is marked done, write a dedicated `source_action_id` (e.g. `deadline_done:<col>`) and have the dashboard query on that, not on the note text.
- **Effort:** S

### L-23 · Form undo leaves its dates moved, and deletes anything added since
Severity: Medium · Type: bug
- **Where:**
  - `forms.ts:192` moves dates through the form's note. `undoFormSubmit` (`:199-213`) voids the note but doesn't put the dates back.
  - When undoing a form that created a record, it hard-deletes the row (`:206`), cascading away any notes, files or appointments added since.
- **What the user experiences:** "Last Visit" stays at today after undoing a visit form. An undone intake also takes the photo they attached right after.
- **Why it matters:** Same wrong-date problem as L-05, plus possible data loss.
- **Fix:** Return the date updates in `FormChange` and restore them. For records the form created, move them to the trash instead of hard-deleting.
- **Effort:** S

### L-24 · Edits made while an Undo is running get no undo entry
Severity: Medium · Type: bug
- **Where:** `undoStore.ts:114,123,133`. `push`, `pushWithToast` and `coalesce` simply return while `isUndoing` is true. Undo callbacks can take several IPC round trips (e.g. `completeDeadline.ts:116-133`, which runs a loop).
- **What the user experiences:** They press Ctrl+Z on a "marked 12 deadlines done" step and keep typing in a cell while it runs. That edit can never be undone.
- **Why it matters:** **Suspected** to be rare, but a silent gap.
- **Fix:** Pass an explicit "this came from undo" flag through `updateCell` instead of a global switch.
- **Effort:** S

### L-25 · Several multi-step actions aren't atomic
Severity: Low · Type: logic
- **Where:**
  - Marking deadlines done runs a cell update, a note and a checklist as separate calls from the screen (`completeDeadline.ts:66-100`).
  - A new note and its date updates are two transactions, and errors in the second are swallowed (`ipc-caselog.ts:57-66`).
  - Bulk move/copy loops over records one by one (`MoveToGridModal.tsx:255-285`).
- **What the user experiences:** Rarely, a half-done result: a deadline marked done with no timeline note, or a note with no "Last visit" update.
- **Why it matters:** The audit trail and deadlines can disagree.
- **Fix:** Add a main-side `DEADLINE_MARK_DONE` that does all the steps in one transaction and returns one undo snapshot, the way `STAGE_MOVE` already does. Put the note insert and its date updates in one transaction.
- **Effort:** M

### L-26 · A repeating task's end date drops its last occurrence
Severity: Low · Type: bug
- **Where:** `ipc-tasks.ts:138` uses `>= end_date`.
- **What the user experiences:** "Monthly report, until Dec 31" on the 31st never shows the Dec 31 one.
- **Why it matters:** Off-by-one on a deadline.
- **Fix:** Use `>`.
- **Effort:** S

### L-27 · Double-clicking a repeating task skips a cycle (suspected)
Severity: Low · Type: bug
- **Where:** `taskStore.ts:124-133` has no "already in progress" guard, and `TASK_COMPLETE` (`ipc-tasks.ts:93-161`) moves the date forward every time it's called. A repeating task stays in the list with its next date, so a second click lands on the same item.
- **What the user experiences:** The task jumps two months ahead and has two history entries.
- **Fix:** Track in-flight ids in the store, and have main ignore the call when the expected `due_date` doesn't match.
- **Effort:** S

### L-28 · Undoing a checklist tick leaves a "Reopened" note, and a failed tick isn't rolled back
Severity: Low · Type: consistency
- **Where:** `ipc-checklists.ts:72-76` logs "Reopened checklist item" when undo un-ticks an item. `Checklist.tsx:203-211` voids only the original "Completed" note. The tick has no rollback when `res.ok` is false (`:186-191`).
- **What the user experiences:** After a tick and Undo, the timeline shows "Reopened checklist item: …" for something that never happened.
- **Fix:** Pass a "silent" flag from undo, or include the reopen note in the undo's side effects. Roll back the tick on failure.
- **Effort:** S

### L-29 · A few UTC timestamps are read as local time
Severity: Low · Type: bug
- **Where:** `CellHistoryPopover.tsx:23-24` ("5 hours ago" for a just-made change east of UTC; west of UTC it shows "Just now" for everything), `ContactLinkedClients.tsx:96-99`, `AvailabilityBadge.tsx:17-20`. All of them call `new Date(dbTimestamp)`.
- **What the user experiences:** Wrong "x hours ago" text, and dates near midnight one day off.
- **Fix:** Use `parseDbTimestamp`. The three `toISOString().slice(0, 10)` uses (`import.ts:327`, `ipc-tasks.ts:138,145`) are UTC-in/UTC-out and correct, so leave them.
- **Effort:** S

### L-30 · Every date-cell edit re-reads every appointment series
Severity: Low · Type: performance
- **Where:** `ipc-cell.ts:149-152` calls `rematerializeForRecord` (`appointments.ts:189`), which loads and parses every row of `appointment_series` to find this record's.
- **What the user experiences:** Nothing today. With hundreds of series, typing dates may get slower.
- **Fix:** Add a `row_id` column (indexed) to `appointment_series`, and only rematerialize when that series' end column is the one that changed.
- **Effort:** S

### L-31 · Five kinds of "thing to do", each with its own rules (data model)
Severity: Medium · Type: logic / usability
- **Where:**
  - Deadline columns: the engine.
  - Checklist items: per record, with due date, priority, groups and a non-working Repeat.
  - Note follow-ups: `case_log.follow_up_date`.
  - Caseload tasks: list-level or global, with their own recurrence code, groups, snooze and history.
  - Appointments: series.

  Each has its own completion flow, undo, dashboard card and recurrence logic (or none).
- **What the user experiences:** "Call the landlord Friday" could go in any of four places. Each one appears on a different card and behaves slightly differently, for example whether it repeats or can be snoozed.
- **Why it matters:** That breaks "one obvious way". Each copy of the logic also has its own bugs (L-03, L-26, L-27).
- **Fix:** Merge into one **To-do** item with an optional record, optional due date, and optional repeat using the shared `ruleInterval` / deadline-engine helpers.
  - A follow-up becomes "a to-do made from a note".
  - A checklist becomes "to-dos grouped on a record".
  - Tasks become "to-dos with no record".
  - Appointments stay separate because they have times.

  Power users keep groups, priority and templates.
- **Effort:** L

### L-32 · Three ways to say "see them every month" (data model)
Severity: Medium · Type: logic
- **Where:**
  - (1) Requirements (`contact_requirements`): calendar periods, counted from notes, shown on the "Monthly contacts" card.
  - (2) A date column that notes update (`note_updates`), plus an interval rule: a rolling count from the last note, shown as a deadline.
  - (3) Quota rules: notes counted between the record's own start and end dates.

  They count differently and show on different screens, and only some respect voids or archives the same way.
- **What the user experiences:** A supervisor asks "who's behind on visits?" and the Monthly card and the deadline list give different answers.
- **Why it matters:** It's confusing to set up and gives inconsistent answers.
- **Fix:** Offer one "Contact rule" in the rule editor: what counts (note types), how often, and whether that's per calendar month or rolling, implemented on the deadline engine. Make the Monthly card a view of those rules. Quota and sequence stay as advanced kinds. Migrate requirements into rules.
- **Effort:** L

### L-33 · Note structure lives in four places (data model)
Severity: Low · Type: consistency
- **Where:**
  - Activity types: a table.
  - Note formats (DAP/SOAP): settings JSON, flattened to plain text (`noteFormats.ts:24-31`), so reports can't use the sections.
  - Measures: settings JSON for custom ones, plus built-in `minutes` and `miles` columns.
  - Forms: their note answers are also flattened to text (`forms.ts:186-191`).

  Definitions kept in settings JSON have no foreign keys, so orphaned keys collect.
- **What the user experiences:** For each visit they pick a type, then a format, then remember which numbers to fill in.
- **Fix:** Let each activity type carry a default format and default measures ("Visit" → DAP + minutes + miles), and store format sections as JSON next to the text so reports can use them. A form that logs a note can then just reference the type. Everything stays editable for power users.
- **Effort:** M

### L-34 · Several overlapping ways to label records (data model)
Severity: Low · Type: consistency
- **Where:** Tags (`row_tags`), acuity levels (`acuity_levels` + `rows.acuity_level_id`, no foreign key), status and dropdown columns, the stage, the star, custom groups (`settings.custom_groups_<grid>`).
- **What the user experiences:** "Mark high-risk clients" has four plausible answers, and each filters, groups and exports differently.
- **Fix:**
  - Tags become a multi-select column type.
  - Acuity becomes a "ranked dropdown" column with points.
  - Custom groups become saved views.

  Keep the existing UI entry points as shortcuts that create those columns.
- **Effort:** L

### L-35 · Two template systems (data model)
Severity: Low · Type: consistency
- **Where:**
  - Setup templates: `setup_templates`, `.pulse` files, `builtin-templates.ts`, `templates.ts:200-245`.
  - Starters: 53 JSON files in `src/shared/starters` with their own schema and sample data (`starters.ts`).

  Starters already reuse `exportGridAsPulse`. Checklist templates, letter templates, snippets and note formats are separate again.
- **What the user experiences:** Templates (sidebar) and examples (Settings → Workspace) look like two different things that both "set up a list".
- **Fix:** Make the `.pulse` file use the starter schema, with one gallery. "Export this list as a template" then writes a starter, and opening a `.pulse` file goes through the starter preview. Keep the old format readable.
- **Effort:** M

## Things that work well (keep them)

- Foreign keys are ON with cascades on almost every child table. Nearly every write handler calls `enforceWritable()` (the heuristic scan only found auth/restore handlers without it, which is correct) and wraps multi-row writes in transactions.
- The grid loads in one pivot query (`database.ts:570-590`). Statements are cached per column set, and a `_loadVersion` guard drops stale responses. With 200+ records and 20+ columns this is fast, and I found no N+1 pattern in the grid, dashboard or deadline loading. Rule columns cost one query per rule column, not per record.
- **Shared logic:**
  - The deadline engine is shared by main and renderer, and every deadline list goes through `loadDeadlines`.
  - `STAGE_MOVE` is a single main-side transaction that returns one undo snapshot, which is the model L-25 should copy.
  - Appointments are well built: local wall time, snapshot-based undo, and occurrences are cleaned up when their record is gone (`appointments.ts:153-159`).
- **Records and history:**
  - Case notes keep their full edit history. Older notes are voided instead of deleted.
  - Link history survives a purge.
  - Auto-numbers are handed out inside the transaction and never reused.
- `localDateString` / `parseDbTimestamp` are used almost everywhere, and the remaining `toISOString().slice(0, 10)` uses are correct.
- Every event-bus listener is unsubscribed on unmount. There is a single window, so there are no cross-window races.
- Backup restore and lock both clear the undo stack, and per-connection caches reset on close.
