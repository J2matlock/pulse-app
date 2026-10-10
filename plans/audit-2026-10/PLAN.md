# Audit 2026-10: the plan

Built from the eight reviewer reports in this folder (first-run, grid, record, deadlines, scheduling, settings-data, navigation, logic), following `BRIEF.md`. Every finding ID appears below; the appendix maps each one to where it went.

## 1. Summary

- **State:** Pulse is feature-complete and most of it is built well. The reviewers praise the deadline engine, appointment undo, the pivot-query grid, note integrity, the restore safety net and the vocabulary layer. The problems sit at the edges: older screens that skip the engine, deletes and undos that promise more than they do, and a lot of surface (11 toolbar buttons, 11 Settings tabs, 24-step tour, five kinds of "to-do") in front of a non-technical user.
- **Counts:** 296 findings (3 Blocker, 58 High, 146 Medium, 89 Low), merged into **90 plan items**: Phase 1 = 37, Phase 2 = 15, Phase 3 = 22, Phase 4 = 7, Phase 5 = 9, plus 8 owner decisions. 4 findings are deferred.
- **Biggest themes:**
  1. **Work gets lost without warning.** Escape on the record page, drafts that carry over to the next record, "Remove sample data", Undo that reports success when it failed, deleted columns that "undo" empty, and records that lose data when moved between lists.
  2. **Deadlines are wrong on some screens.** Focus Mode, the Monthly summary PDF, the profile PDF and handoff packet, and a deleted rule all show different answers from the dashboard. Notes and "Done" can only be dated "now".
  3. **Safety features are broken.** You can't change your password, "Run now" backup always fails, there is no "Back up now" button, and backups over 200 MB can't be restored.
  4. **Too much at once.** Overlapping concepts (tasks, checklists, follow-ups; Saved filters and Views; three template systems), jargon ("Alert rule", "grid", "thresholds"), and text below 15px nearly everywhere.

## Owner decisions (2026-10-10)

| Decision | Chosen | What it means for this round |
|-|-|-|
| A. To-dos | **A3: keep tasks, checklist items and follow-ups separate; fix bugs only** | 5.1 and the interim S-06 are dropped. 1.26: make checklist "Repeat" actually work (it's a bug), not merge anything |
| B. Note dates | **B1: separate `occurred_at`** | 1.22 as written; `created_at` stays the audit time |
| C. Sample data | **C3 + (i)** | Keep anything the user touched, remove to Trash, "Sample" pill, one-time "keep as a real entry?"; "Just looking?" opens the gallery with sample data ticked (5.9) |
| D. Delete | **D1: lists and columns go to Trash for 30 days** | 5.2 in this round |
| E. Done on one-off dates | **E1: ask Renewed / Finished**, plus the Deadline-column conversion; D-04 approved | 5.3 in this round |
| F. Rule ownership | **F1: shared rules, "Used by", "Change for all / Make a copy"** | 5.4 D-11 part in this round; contact rules (L-32) later |
| G. Layout | **G2 now, G1 in a later round** | 2.12 now; 5.5–5.7 deferred |
| H. Duplicates | **H2: merge only the broken two** | 5.8 in this round |

## 2. Decisions needed from the owner

Each of these changes how the app works, not just how it looks. Phase 1 can mostly go ahead without them: where a Phase 1 item depends on one, it says so and gives a safe interim step.

### A. One kind of "to-do", or keep five?
Tasks (no record), checklist items (on a record, "Repeat" does nothing), follow-ups (a date on a note), appointments and deadlines overlap. "Call Mrs. Lee's pharmacy Friday" can go in three places, and each shows up somewhere different.
- **A1. Merge** tasks, checklist items and follow-ups into one **To-do** (optional record, optional note, due date, repeat, priority, snooze). A record's checklist = its to-dos; the Tasks page = all to-dos. Appointments and deadlines stay separate. (L)
- **A2. Interim only:** keep the storage, but add a "For (record)" picker to tasks, show due checklist items on the Tasks page and the calendar, rename record items "checklist items", and add a Help topic "Task, checklist, follow-up or appointment?". (M)
- **A3. Keep as is** and just fix the bugs.
- **Recommendation:** A2 now (it fits inside A1), then A1 as the next big release. Either way, hide checklist "Repeat" until it works.
- **Depends on it:** S-04, L-31, S-24, R-18, N-12, S-01, L-03, S-06.

### B. Can a note (and "Done") be dated when it actually happened?
Today every note is stamped "now", so monthly requirements, quota rules, "Last visit" dates and reports count by when someone typed. "Done" always means today.
- **B1. Add `occurred_at`** to notes (default today, editable on edit with history), and keep `created_at` as the audit time. Count requirements, quotas, note-driven dates and reports by `occurred_at`. Show "(written Nov 2)" on backdated notes. Add "Done on another day…" to Mark done and the meter dialog. (L)
- **B2. Overwrite `created_at`** with the chosen date. Cheaper, but the audit trail loses the real write time. (M)
- **B3. No backdating.** Users keep scheduling an appointment first as a workaround.
- **Recommendation:** B1. Late documentation is normal for this audience, and the audit trail must stay honest.
- **Depends on it:** R-03, S-02, L-04, D-12, L-25.

### C. What does "Remove sample data" remove, and what does "Just looking?" do?
Today removal hard-deletes the whole sample list (including real records the user added to it) and every starter-sample row by id (including ones the user edited into real records), while the dialog says "Anything you created yourself is not affected". "Just looking?" gives every workspace a social-work caseload and all features on.
- **C1. Keep anything the user touched:** remove only untouched generated rows, notes and files; keep edited rows and added rows (rename the list "My list" if any remain); send removed rows to Trash so it can be undone; report "We kept 3 entries you changed".
- **C2. Remove everything, honestly:** count the user's own items first, say "This also deletes 3 entries you added", and route it through Trash.
- **C3.** C1, plus a visible "Sample" pill on sample rows and a one-time "Keep this as a real entry?" question when one is edited.
- **"Just looking?":** (i) open the example gallery with "Add sample data" ticked, or (ii) keep it but label it "Try a sample social-work caseload" and set words on that list only.
- **Recommendation:** C3 and (i). Also tick "Add sample data" by default in setup mode.
- **Depends on it:** F-01, X-12, L-06, F-13, F-10, F-14, F-37.

### D. What does "delete" mean for lists and columns?
Deleting a list says "permanently… cannot be undone" but only hides it. Its records stay searchable, keep getting appointment reminders and sit in Trash as "can't restore", and Trash sends the user to a Settings screen that doesn't exist. Deleting a column really does delete the data, then offers an Undo that brings back an empty column. Moving a record between lists deletes unmatched cells behind an Undo.
- **D1. Everything goes to Trash.** Deleted lists and deleted columns are soft-deleted, restorable for 30 days, then purged. Typed confirmation only for "Delete forever". Unmatched cells on a list move are parked, not deleted.
- **D2. Delete for real.** Purge immediately after a typed confirmation, remove the Undo offers, and fix the wording.
- **Recommendation:** D1. It matches how records already work, and it fixes the privacy surprise (data that is "deleted" but still there) by giving it an end date. Phase 1 makes the wording honest and hides deleted lists everywhere, whichever option you pick.
- **Depends on it:** X-11, N-06, L-13, G-35, G-17, L-09, G-18, L-11.

### E. What does "Done" mean for a date that doesn't repeat?
"Done" on an "Expires" or "Scheduled date" rule clears the date, so renewals stop being tracked and the job's date disappears from the calendar and reports. Relative rules on plain Date columns treat a typed *planned* date as "done".
- **E1. Ask:** "Done" on a no-interval rule opens a small dialog: **Renewed** (new expiry date, the default) or **Finished** (keep the date, store a done flag).
- **E2. Keep the date and add a done flag**, with no question. Renewals still need typing.
- **E3. Keep clearing**, with a clearer button label ("Done – clear date").
- **Related:** turn columns with relative, calendar or sequence rules into Deadline columns that show "Due Oct 17 / Done Oct 12", instead of Date columns where a typed date silently means "done".
- **Recommendation:** E1, plus the Deadline-column conversion. Also confirm one small engine change: a calendar rule done *before* its due date with no lead time should count for that date (D-04). A test currently pins the opposite.
- **Depends on it:** D-06, D-23, D-04, L-25.

### F. Who owns a deadline rule?
Rules are global, but many refer to one list's columns. The column menu offers every rule from every list, the editor opened from Settings uses whichever list was last open, and changing "Every year" for Crew silently changes it for Equipment. Separately, there are three ways to say "see them every month": requirements, note-updated dates with an interval rule, and quota rules. They count differently.
- **F1. Keep rules global**, work out each rule's list from the columns that use it, show "Used by: …" everywhere, and offer "Change for all / Make a copy for this column" when a rule is shared.
- **F2. Make rules belong to a list** (`grid_id`), with plain interval and calendar rules allowed to be shared.
- **F3. Make rules per column**, edited inline, with "copy from another column".
- **Later, contact rules:** fold requirements into one "Contact rule" kind on the deadline engine (per calendar month or rolling), and make the Monthly card a view of it.
- **Recommendation:** F1 now (Phase 1 already fixes the wrong-list editor). Treat contact rules as a separate, later project.
- **Depends on it:** D-09, D-10, D-11, L-32, D-16.

### G. How should Settings, the sidebar and "templates" be organized?
Settings has 11 tabs (two duplicate other screens; "Alerts" holds tray mode and requirements), and the last tabs are off-screen at 1366×768. The sidebar mixes daily work with setup. "Template" means four things, and there are two incompatible `.pulse` formats. "Reports" lives in five places.
- **G1. Full regroup.**
  - Settings becomes 7 tabs: Workspace, Appearance, Security & backup, Deadlines, Reminders, Notes, Data. Features get their own tab or section. Shortcuts and About move to Help.
  - The sidebar becomes three groups: My work, {Lists}, and Set up (collapsible).
  - One "Templates & text" page with tabs for Checklists, Letters & documents and Snippets.
  - One `.pulse` format and gallery.
  - The Reports page becomes the home for every printout.
- **G2. Light touch:** make the tab list scroll, remove the duplicate tabs, rename "Alerts" to "Deadlines & reminders", and gate the Templates link on its features.
- **Recommendation:** G2 in Phase 2 (it's cheap and removes the dead ends), then G1 in Phase 5. Turn Snippets off by default in a blank workspace.
- **Depends on it:** X-25, N-10, N-11, N-26, N-27, X-28, L-35, D-38, G-23.

### H. How much of the overlapping data model should be merged?
Per-cell "highlight all rows" copies vs column highlight rules. Two tag systems (a Tags column vs profile tags). Four places for note structure (types, formats, measures, forms). Six ways to label records (tags, acuity, status, stage, star, custom groups).
- **H1. Merge all of them** over time. (L each)
- **H2. Merge only where one copy is broken or invisible:**
  - "Highlight all rows" saves a column rule (L-19).
  - Profile tags show as a built-in, hideable Tags column (G-37).
  - Leave note structure (L-33) and labels (L-34) alone.
- **H3. Leave as is.**
- **Recommendation:** H2.
- **Depends on it:** L-19, G-37, L-33, L-34.

---

## 3. Phases

Effort: S under 2h, M half a day, L a day or more. "(no decision needed)" = pure fix with no design choice.

### Phase 1: Data safety and wrong results

**1.1 Escape on the record page throws away work** · R-01, N-01 · S · (no decision needed)
- **Problem:** Escape anywhere on the record page leaves the page. That includes closing the snippet menu, cancelling a note edit, and closing Fill form, Handoff, Extend, Audit, appointment, palette and shortcut dialogs.
- **Fix:** In the ProfileView handler, return early if `e.defaultPrevented`, if focus is in an input, textarea, select or contenteditable, or if any `[aria-modal="true"]` is open. Have the dialogs call `preventDefault`/`stopPropagation` the way ConfirmDialog does. Escape-to-list still works when nothing is focused.
- **Files:** `ProfileView.tsx:320-337`, `CaseLog.tsx`, `CaseLogEntry.tsx`, `DeadlinePanel.tsx`, `FillFormDialog.tsx`, `HandoffDialog.tsx`, `AppointmentDialog.tsx`, `GlobalTaskDialog.tsx`, `CommandPalette.tsx`, `KeyboardShortcutsModal.tsx`.

**1.2 Drafts stay with their own record** · R-02, L-18, R-37, N-30 (Ctrl+L part) · S · (no decision needed)
- **Problem:** Prev/Next carries an unsaved note over to the next record, where Ctrl+Enter saves it on the wrong person. The last 2 seconds of scratch-pad typing are lost (and may land on the next record). Ctrl+L locks and drops a half-typed note.
- **Fix:**
  - Key the profile body by `rowId`. This also resets the scroll position (R-37) and makes the ScratchPad unmount flush save to the right row.
  - Before Prev/Next or Ctrl+L, prompt "You have an unsaved note", or keep per-record drafts in `sessionStorage`.
- **Files:** `App.tsx:211-217`, `ScratchPad.tsx`, `CaseLog.tsx`, `Checklist.tsx`, `DeadlinePanel.tsx`, `useAutoLock.ts`.

**1.3 "Remove sample data" keeps the user's own work** · F-01, X-12, L-06 · M · depends on Decision C (the interim steps need none)
- **Interim (works under any option):**
  - Count non-sample rows in the sample list, plus user-added notes, files and appointments on sample rows, and edited sample rows. Show that count in the confirmation.
  - Send removals to Trash instead of hard-deleting them.
  - Never remove a sample row that has moved to another list.
  - Settings → Data uses the same confirmation as the banner (today it asks nothing).
- **Files:** `sample-data.ts:67-80, 162-179`, `SampleDataBanner.tsx`, `DataSection.tsx:156`.

**1.4 Broken safety buttons in Settings** · X-01, X-03, X-04, X-10 · S · (no decision needed)
- **Change password (X-01):** drop `isChangingPassword ||` from `disabled`, use a separate `saving` flag, and add a renderer test.
- **"Back up now…" (X-03):** add an always-visible primary button at the top of Backup that saves a `.pulse-backup` wherever the user picks.
- **"Run now" (X-04):** add a main-side `BACKUP_SCHEDULED_RUN_NOW` instead of sending `intervalDays: 0`.
- **Backup settings (X-10):** save checkboxes and selects immediately, or flush the pending save on unmount.
- **Files:** `SecuritySection.tsx:142,174`, `BackupSection.tsx`, `ipc-export.ts:70`, `backup.ts`.

**1.5 Backups you can restore, and know about** · X-05, X-06, X-07 · M–L · (no decision needed)
- **Size limit (X-05):** tie the restore size limit to the file allowance plus headroom, or keep only the 2 GB uncompressed check. `createPulseBackup` must refuse to write anything restore would reject.
- **Silent failures (X-06):**
  - Record `lastError` and `lastAttemptISO`.
  - Show a red "hasn't worked since …" line in Backup.
  - Fail the security checkup item.
  - Show a status-bar notice after about two missed runs.
- **No copy off this computer (X-07):**
  - Track "last backup to another place".
  - Show it in the status bar or on the dashboard.
  - Turn the reminder on by default, based on that date.
  - Also auto-back up on lock or sleep.
- **Files:** `backup.ts:156, 366-399, 673-717`, `BackupSection.tsx`, `SecurityCheckup.tsx:344`, `useBackupReminder.ts`, `backupStatusStore.ts`, `StatusBar.tsx`.

**1.6 Restore tells the truth** · X-08, X-09, X-24 · M · (no decision needed)
- **Backup from another computer (X-08):** when verify fails but the archive has `key-envelope.json`, offer "This backup is from another Pulse. Enter its password or recovery key", reusing `RestoreFromBackupForm`.
- **Preview (X-09):** read the "Backup made" date from `backup-meta.json`, drop "Schema version", and make "Restart now" the only choice after a restore.
- **Factory reset (X-24):** relaunch to setup afterwards, and offer "Make a backup first".
- **Files:** `BackupSection.tsx`, `backup.ts:586`, `ipc-export.ts:252`, `DataSection.tsx:413`, `ipc-app.ts:96-139`.

**1.7 Deleting a deadline rule floods every reminder with false "overdue"** · D-05, L-02, X-13 · S–M · (no decision needed)
- **Problem:** The rule is deleted in one click. Columns keep the dead id, and the loader's `LEFT JOIN … ar.id IS NULL` turns every date into a deadline due on the date itself (checked at `deadlines.ts:88-90`). The X-13 claim that columns "disappear from the dashboard" is wrong: they flood it. The grid shows no color, so the two screens disagree.
- **Fix:**
  - Confirm with usage ("Used by 4 columns in 2 lists").
  - Clear `alert_rule_id` from every column in the same transaction, and make it undoable.
  - Switch the loader to an INNER JOIN.
  - Make the column-menu message match what happens.
  - Update `tests/deadlines-parity.test.ts:68`.
- **Files:** `AlertsSection.tsx:73-81`, `ipc-alerts.ts:95-104`, `deadlines.ts:88-90`, `ColumnHeader.tsx:588-596`.

**1.8 Show what depends on a thing before deleting it** · D-25, L-10, L-15, R-29, X-23 · M · (no decision needed)
- **Columns (D-25, L-10):**
  - Before deleting a column, list the rules, conditions, stage stamps, series ends, calculated sources, sorts, views and reports that use it, and ask.
  - Call `refreshDisplayNames` when the name column changes, and add "Use as name" to the column menu.
  - In the rule editor, flag references to missing columns in red.
- **Note types (L-15):** the "in use" check also counts quota rules, forms, stage notes and appointment types.
- **Tags (R-29):** confirm with "Delete tag 'X' from all N records?" and make it undoable.
- **Edit history (X-23):** "Delete all history" gets a confirmation and plain wording.
- **Files:** `ipc-grid.ts:296-324`, `display-names.ts`, `activity-types.ts:104-131`, `ProfileHeader.tsx:223-231`, `DataSection.tsx:276-311`, `AlertRuleEditor.tsx`.

**1.9 Undo that reports success when it failed** · L-01, L-08, L-24, G-17, L-09, G-34 · M · (no decision needed for this step; see Decision D)
- **Deleted checklist items (L-01):** drop `updated_at` from the restore INSERT and flip the test at `tests/ipc-checklists.test.ts:337`.
- **Failures shown as success (L-08):**
  - Add a `mustInvoke()` helper that throws on `!ok`, and use it in all 52 undo/redo callbacks.
  - Show the real reason when an undo fails.
  - Lint for `safeInvoke` inside `undo:` and `redo:`.
- **Edits during an undo (L-24):** pass an explicit "from undo" flag instead of the global `isUndoing` switch.
- **Deleted columns (G-17, L-09):** stop offering Undo on column delete until Decision D lands. Say "This can't be undone; your last backup has the data".
- **Bulk move to trash (G-34):** use a plain confirmation plus a single Undo, instead of typing "TRASH 12" with no undo.
- **Files:** `ipc-checklists.ts:165-187`, `undoStore.ts`, `safeInvoke.ts`, `gridColumnSlice.ts:149-203`, `GridDialogs.tsx:157-175`, `BulkActionBar.tsx`.

**1.10 The undo stack behaves predictably** · G-26, L-17, L-16, R-20 (undo part) · M · (no decision needed)
- **Bulk actions (G-26):** add a batch mode to `updateCell` and `moveToStage`, so Bulk Edit, Replace All and bulk stage moves push one undo item each. `updateCell` returns success, so the failure count is real. Drop `[columnId]` from undo labels.
- **Merging (L-17):** merge cell edits only when the entry is on top of the stack and less than about 3 seconds old.
- **Switching lists (L-16, R-20):** keep the stack across list switches, and clear it only on lock, restore and sample removal.
- **Files:** `gridStore.ts:144-148, 545-588`, `BulkEditDialog.tsx`, `GridView.tsx:64-68`, `stageMove.ts`, `undoStore.ts`.

**1.11 Moving a record to another list loses data** · G-18, L-11 · M · (no decision needed)
- **Fix:**
  - Park cells for unmatched columns instead of deleting them, so a move back (or Undo) restores them.
  - Keep the record's auto-number on the way back.
  - Show the bulk dialog the same "Data in 3 columns won't carry over: …" list the single dialog shows.
- **Files:** `ipc-row.ts:185-219, 467-476`, `MoveToGridModal.tsx`, `auto-number.ts`.

**1.12 Deleted lists: honest wording, and hidden everywhere** · X-11, N-06, L-13, G-35 · S now (restore is item 5.2, Decision D)
- **Do now, whichever option is chosen:**
  - Fix the "permanently… cannot be undone" text in `Sidebar.tsx:54-60`.
  - Fix the Trash message that points to a Settings restore that doesn't exist.
  - Add `g.is_active = 1` to cross-list search, the palette, the appointment picker, the calendar, reminders and dashboard archived/completed queries.
  - Fix "Total active records" in Settings → Data.
- **Files:** `Sidebar.tsx`, `TrashView.tsx:219-227`, `ipc-row.ts:569-583`, `appointments.ts:42-58`, `reminders.ts:139-147`, `ipc-dashboard.ts`, `ipc-export.ts:56`.

**1.13 Archived means archived** · L-12, S-07, L-14 · M · (no decision needed)
- **Restore from Trash (L-12):** restore an archived record as archived: `is_active = CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END`.
- **Appointments (S-07, L-14):**
  - When archiving, offer "Also cancel its N upcoming appointments?" (default yes), ending the series, with undo.
  - Filter `r.is_active` and `g.is_active` wherever upcoming appointments are read: the list, Today, reminders, `.ics` and the briefing.
- **Files:** `ipc-row.ts:331-341, 240-247, 366-381`, `appointments.ts:42-60, 425-434`, `reminders.ts`, `export-ics.ts`.

**1.14 The list acts on what you see** · G-03, G-05, G-07, G-27, G-24 · S–M · (no decision needed)
- **Filters follow you (G-03):** keep filter, search, group and starred state per list (or reset it in `loadGrid`), and drop filters on columns the list doesn't have.
- **Select all (G-05):** select from the rows actually shown, trim the selection when the filter changes, and say "(1 hidden by your search)".
- **Export (G-07):**
  - Send visible row ids in visible order.
  - Offer "The 6 shown / The 3 selected / All 200", defaulting to the shown rows when a filter is on.
  - Allow hidden columns in the column choice.
- **Find & Replace (G-27):**
  - Match only visible rows, in visible order.
  - Scroll to the active match.
  - Confirm Replace All with counts.
  - Match whole values in number, money, status and stage columns.
- **Counts (G-24):** show "1 of 8", and sum per column.
- **Files:** `gridStore.ts:144-215`, `GridHeaderRow.tsx`, `gridKeyboardNav.ts`, `GridToolbar.tsx:154-175`, `export-csv.ts`, `export-pdf.ts`, `export-shared.ts`, `FindReplaceBar.tsx`, `GridStatusFooter.tsx`, `StatusBar.tsx`, `TopBar.tsx`.

**1.15 Bulk Edit crash and a stuck board** · G-01, G-02, G-36, S-25 · M · (no decision needed)
- **Bulk Edit crash (G-01):** use `columnOptionLabels()` for status options, and add a test with a status column.
- **Stage options (G-02):** saving options on a stage column merges them into `config.stage.options`. Better still, make the stage dialog the options editor.
- **Renaming options (G-36):** render "Edit options" in a portal; clipping is suspected, not seen. On rename, offer "Change 12 records from Scheduled to Booked?", and say how many still use a removed option.
- **Hidden stage column (S-25):** `updateCell` looks the column up in `columns` plus `hiddenColumns`, so stage actions run from the profile.
- **Files:** `BulkEditDialog.tsx:324-343`, `ColumnHeader.tsx:151-169, 521-567`, `stages.ts:48-53`, `StageSettingsDialog.tsx`, `gridStore.ts:507-515`.

**1.16 Grid edits that quietly corrupt data** · G-14, G-15, G-16, L-22, G-29 · S · (no decision needed)
- **Pasted dates (G-14):** convert them to `YYYY-MM-DD` with the importer's parser, refuse ambiguous ones, and check status and stage pastes against the options.
- **Deadline cells (G-15):** treat them as not-typeable (no Delete, Paste or Clear cell).
- **"Completed" when a date is cleared (G-16, L-22):** log "cleared (was …)" instead. Mark done writes a `source_action_id`, and the dashboard counts completions by that, not by matching note text.
- **Pasting a block (G-29):** a tab or newline block pasted into one cell is refused with "To bring in many records, use Import". Filling the rectangle can come later.
- **Files:** `gridHelpers.ts`, `ipc-cell.ts:78-151`, `gridKeyboardNav.ts`, `GridContextMenu.tsx`, `shared/types.ts:36`, `ipc-dashboard.ts:128-136`.

**1.17 Focus Mode uses the deadline engine** · D-01, R-05, D-02 · S · (no decision needed)
- **Problem:** Focus Mode's "Done ✓" writes `null`, which erases repeating deadlines. Its own math drops most rule kinds, shows calendar rules as long overdue, and ignores extensions.
- **Fix:** call `completeDeadlines()` the way `DeadlineRow` does (ask for a reading on meter rules; send quotas to Renew), and use `r.due` and `r.daysUntil` from `loadDeadlines`.
- **Files:** `FocusModeView.tsx:93-225`, `completeDeadline.ts`.

**1.18 The remaining deadline screens go through the engine** · D-03, G-13 · M · (no decision needed)
- **Monthly summary PDF (D-03):** run the real rule as of the cutoff, using `engineRuleFrom`, a full `RecordContext`, extensions and the work calendar. Include Deadline columns.
- **Stale colors (G-13):** subscribe `DataGrid` and `BoardView` to `deadlineContext`, and pass a version into the `SortableRow` memo, so meter, quota, step and extension colors stop going stale.
- **Files:** `compliance.ts:76-105`, `gridStore.ts:201-210`, `DataGrid.tsx`, `SortableRow.tsx:436-468`, `BoardView.tsx:187-191`.

**1.19 Profile PDF and handoff packet are right and private** · R-08, R-09 · S–M · (no decision needed)
- **Deadlines (R-08):** build them from the engine, printing "Next due … · state" and extensions with their reason. Today it uses its own math, plus a `Math.round` bug that makes "due today" read as overdue after noon.
- **Contents (R-09):**
  - "Include scrap notes" is off by default.
  - Print manual contact info.
  - Leave system entries out of "Recent notes".
  - Add a small sections step to Export PDF.
- **Files:** `export-pdf.ts:305-321, 380-385, 456-468`, `export-handoff.ts:139`, `ProfileView.tsx:292`, `HandoffDialog.tsx`.

**1.20 Deadline engine bugs** · D-07, D-13, D-04, D-14, D-24, D-34 · M · D-04 needs a quick owner OK (Decision E)
- **Working days (D-07):** "Count working days only" keeps the original result and overrides only the due date and state. This fixes stuck sequence steps and vanishing quota warnings. Hide the checkbox for quota rules, and add a test for a Saturday step.
- **Used-up quota (D-13):** show "All 12 used" instead of "Due today", and count it as overdue.
- **Calendar rules done early (D-04):** with no lead time, use a default grace of half the gap. `tests/deadline-calendar.test.ts:15-16` deliberately pins today's behavior, so update it.
- **Late completion (D-14):** a late calendar completion counts for the unpaid date, not the next one.
- **Relative "before" rules (D-24):** decide the done window and make the code and comment agree.
- **Bulk Mark done (D-34):** toast which items couldn't be marked done.
- **Files:** `deadlineEngine.ts:257-276, 316-340, 446-449, 568-574`, `completeDeadline.ts`, `DashboardView.tsx:388-391`, `AlertRuleEditor.tsx:430`.

**1.21 The rule editor and picker use the right list** · D-09, D-10, D-26 · M · (no decision needed; Decision F covers the bigger model)
- **Editor (D-09):** work out the rule's list from the columns that use it and load that list's columns, hidden ones included. Show a picker when a rule is used in more than one list. Preview on a column that uses the rule.
- **Column menu (D-10):** offer only rules that fit this list, and put others under "Rules from other lists (won't work here)".
- **Conditions (D-26):** include hidden columns, marked "(hidden)". Checkbox conditions become "is checked / is not checked".
- **Files:** `AlertRuleEditor.tsx:230-233`, `RuleKindFields.tsx`, `ColumnHeader.tsx:430-470`.

**1.22 Date a note, and "Done", by when it happened** · R-03, S-02, L-04, D-12 · L · depends on Decision B
- **Fix (per B1):**
  - Add an optional "When" field next to the note type chips, and store it as `occurred_at`.
  - Pass it to `applyNoteDateUpdates`, which already accepts a date.
  - Count requirements, quotas and reports by it.
  - Allow correcting it on edit, with history.
  - Add "Done on another day…" to Mark done and the meter dialog.
- **Files:** a migration, `ipc-caselog.ts:45-69`, `note-date-updates.ts`, `contact-requirements.ts:90-99`, `deadlines.ts:182-195`, `report-builder.ts:223`, `CaseLog.tsx`, `CaseLogEntry.tsx`, `completeDeadline.ts`, `deadline-actions.ts`.

**1.23 Voiding or undoing a note puts its dates back** · L-05, L-23, S-19 (dates part) · M · (no decision needed)
- **Fix:**
  - Record which cells each note moved (a small table, or a `cell_history` source).
  - On void or delete, recompute from the latest remaining note, but never past a value someone later typed by hand. Tell the user what changed.
  - Form undo restores dates, and moves records it created to Trash instead of hard-deleting them.
  - An appointment's "Back to scheduled" reverts the dates its note moved.
- **Files:** `note-date-updates.ts`, `ipc-caselog.ts:97-148`, `forms.ts:192-213`, `appointments.ts:393-397`.

**1.24 A record opens from anywhere** · R-07, N-02, L-07 · S–M · (no decision needed)
- **Problem:** Opening a record from Recent, Contacts, Focus Mode, the palette or "Recently archived" says "not found — may have been archived or deleted".
- **Fix:**
  - ProfileView fetches the row by id (archived rows allowed), switches to its list, and shows "Loading…" while it loads.
  - Archived records show with an "Archived — Unarchive" banner.
  - Pass `gridId` in every caller anyway.
  - Reword the fallback message.
- **Files:** `ProfileView.tsx:213-240, 350-362`, `TopBar.tsx:258-263`, `CommandPalette.tsx:148-151, 332-336`, `FocusModeView.tsx:227-230`, `ContactLinkedClients.tsx:92-94`, `RecentlyArchivedTab.tsx`.

**1.25 Repeating appointments behave** · S-03, S-10, S-11, S-17, S-31 · M · (no decision needed)
- **"This and following" (S-03, S-10):**
  - Keep the remaining count, so a "10 sessions" series doesn't become two years of appointments.
  - Shift `byDay` when the weekday changes, so the moved appointment doesn't vanish.
- **Dragging to another day (S-11):** don't offer "All" when the date changes, or make "All" shift every future occurrence.
- **Two-year stop (S-17):**
  - Make the materialization horizon rolling, so series don't stop after two years.
  - Show the rule with `describeRule` ("Every week on Tue · until Mar 3, 2027").
- **Undoing a new series (S-31, suspected):** delete occurrences by `series_id`, and avoid `INSERT OR REPLACE` on series rows.
- **Files:** `main/appointments.ts:89-111, 160, 197-309`, `shared/appointments.ts:91-144`, `CalendarView.tsx:158-161`, `ScopeDialog.tsx`, `AppointmentPanel.tsx`.

**1.26 Checklist "Repeat" stops pretending** · S-01, L-03 · S now (hide), M proper fix · the proper fix depends on Decision A
- **Now:** hide the item "Repeat" picker, the template "Repeating template" toggle and the "Recurring" column.
- **Proper fix:** reopen with the next due date on completion, using a recurrence helper shared with tasks.
- **Files:** `ChecklistAddDialog.tsx`, `ChecklistItem.tsx`, `Checklist.tsx:1136-1160`, `ChecklistTemplateEditor.tsx`, `ChecklistTemplateRow.tsx`, `ipc-checklists.ts`, `checklist-apply.ts`.

**1.27 Tasks keep their data and their schedule** · S-05, S-12, S-13, S-14, L-26, L-27 · S–M · (no decision needed)
- **Editing (S-05):** use one task dialog, and send only changed fields on edit, so edits stop wiping the list, the category and snooze.
- **Repeats (S-12):**
  - A repeating task requires a due date.
  - The next date rolls forward until it's on or after today.
- **Snooze (S-13):** `isSnoozed` uses `> today`, and dates are shown as "Tomorrow (Sun, Oct 11)".
- **Missing tasks (S-14):** use `ORDER BY is_completed, position`, and limit completed tasks separately.
- **End date (L-26):** use `>` instead of `>=` when checking the end date.
- **Double clicks (L-27, suspected):** ignore a double complete with an in-flight guard and a due-date check.
- **Files:** `GlobalTaskDialog.tsx`, `TaskFormDialog.tsx`, `TasksView.tsx:190-193`, `ipc-tasks.ts:22-152`, `taskHelpers.ts:26-29`, `taskStore.ts:124-133`, `SnoozeDialog.tsx`.

**1.28 Import brings in the right data** · X-16, L-21, F-24, X-17, X-42 · M · (no decision needed)
- **Duplicates (X-16):**
  - Make "Name + Date of Birth" really compare both values.
  - Leave Trash rows out of the comparison.
  - Catch duplicates within the same file.
  - List the skipped names.
- **Two-digit years (L-21):** the cutoff is the current year. Birth-date-like columns go to 19xx with a warning.
- **Notes columns (F-24, X-17):** notes, comments and remarks columns default to a text column (or "add as first note"), with a one-line explanation.
- **Sheets (X-42, suspected):** include the sheet name in the preview cache key, and pass `sheetName` to the preview.
- **Files:** `import.ts:126-130, 513-517, 632-641, 849-913`, `ImportWizard.tsx:341-349, 850`, `ipc-export.ts:487`.

**1.29 Import paths that always fail** · X-14, X-15, X-18 · S (hide/patch), M (proper paste) · (no decision needed)
- **Paste from clipboard (X-14):** it is denied by the permission handler (checked at `index.ts:325-330`), and the pasted rows never reach main. Hide it now. Later, read the clipboard in main and import from a temporary CSV.
- **Drag and drop (X-15):** use `window.api.pathForFile`.
- **.xls and .ods (X-18):** drop them from the picker and say "Save As .xlsx".
- **Files:** `ImportWizard.tsx:230, 255-311, 387, 529`, `import.ts:552-622`.

**1.30 Never fail silently** · R-26, X-34, F-15, L-28 (rollback part) · S · (no decision needed)
- **Fix:**
  - Check `res.ok` and roll back optimistic state in ScratchPad, manual contacts, tags, note edit, pin, follow-up done and file rename.
  - The snippet editor stays open and checks for duplicate triggers.
  - Setup shows `result.warnings` from adding an example.
  - A checklist tick rolls back when it fails.
- **Files:** `ScratchPad.tsx:114-131`, `ProfileHeader.tsx:144-231`, `CaseLog.tsx:321-401`, `RecordFiles.tsx`, `SnippetsView.tsx:64-69, 218-232`, `ApplyStarterDialog.tsx:108`, `SetupView.tsx`, `Checklist.tsx:186-191`.

**1.31 Note search covers every note** · R-12 · S–M · (no decision needed)
- **Fix:**
  - Search and sort in SQL (`CASE_LOG_GET` with `query` and `order`).
  - Show "Showing 50 of 312".
  - Page the timeline from the server, instead of stopping at 200.
- **Files:** `CaseLog.tsx:424-444, 723`, `ActivityTimeline.tsx:37`, `ipc-caselog.ts:35`.

**1.32 Stage history isn't overwritten** · S-15, S-16 · M · (no decision needed)
- **Re-entering a stage (S-15):**
  - Don't add a stage's checklist again if its items are still open.
  - "Only fill in the date if it's empty" is the default for stage stamps.
- **Undo (S-16):** add a `STAGE_UNDO` that deletes the history rows and notes the move created, so Undo doesn't reset "time in stage".
- **Files:** `stages.ts:118-125, 161-177`, `stageMove.ts:43-47`, `StageSettingsDialog.tsx`, `ipc-cell.ts`.

**1.33 Exports say what the screen says** · G-08, X-21, X-20 · M · (no decision needed)
- **Display text (G-08):** use one display-text function for cells, the clipboard and exports. Deadlines export as due date plus state. Copied link cells contain no separator characters.
- **CSV files (X-21):**
  - Write a UTF-8 BOM.
  - Don't put a tab before negative numbers.
  - Export All includes hidden columns and gives duplicate list names unique file names.
  - Export All either adds `notes.csv`, tasks and contacts, or says plainly what it leaves out.
- **Date format (X-20):** pass the date-format setting to every export, or remove the setting.
- **Files:** `export-shared.ts:187-219`, `gridHelpers.ts:5-21`, `export-csv.ts`, `ipc-export.ts:266-297`, `GridToolbar.tsx:159`, `AppearanceSection.tsx:235-248`.

**1.34 Dates, sorting and timestamps** · L-29, X-38, G-40, G-11, G-43 · S · (no decision needed)
- **UTC timestamps (L-29, X-38):** use `parseDbTimestamp` in CellHistoryPopover, ContactLinkedClients, AvailabilityBadge and the Trash countdown. Add `ROW_PURGE_ALL` for Empty Trash.
- **"In the past" filter (G-40):** store a relative "today" token instead of a fixed date.
- **Sorting (G-11, G-43):** deadline columns sort by `daysUntil`; number and money columns sort numerically; dates sort by ISO value.
- **Files:** `CellHistoryPopover.tsx`, `ContactLinkedClients.tsx`, `AvailabilityBadge.tsx`, `TrashView.tsx`, `FilterBar.tsx:84-86`, `DataGrid.tsx:440-449`.

**1.35 Dashboard numbers agree** · D-19, D-20 · S · small naming choice (recommendation given)
- **Fix:**
  - Rename the rolling tiles "Next 7 days" and "Next 30 days". Keep calendar meanings for the This Week and This Month tabs, and show overdue at the top of This Week.
  - Split the tiles into "deadlines" and "tasks & follow-ups", or count both everywhere. The briefing, desktop reminder and tiles must match.
  - "Items Due Today" stops counting last week's items.
- **Files:** `DashboardView.tsx:291-303, 405-414, 490-497`, `WeekViewTab.tsx:34`, `MonthViewTab.tsx`, `deadlines.ts:167-176`, `MorningBriefing.tsx`, `reminders.ts`.

**1.36 The calendar file is complete and valid** · S-30, D-33 · S–M · (no decision needed)
- **Escaping (S-30):** escape `;` as `\\;`.
- **Cancelled appointments (S-30):** send `STATUS:CANCELLED` for appointments cancelled or deleted in the window.
- **Placement and name (S-30):** add "Add to my calendar…" on the Calendar toolbar, and name the calendar "Pulse".
- **Lead-time rules (D-33):** keep calendar rules with a lead time in exports (`includeUpcoming`).
- **Files:** `export-ics.ts:44, 81, 100-129`, `deadlineEngine.ts:340`, `deadlines.ts`, `CalendarView.tsx`.

**1.37 Don't lose typed work in dialogs** · R-25, X-30, X-41, G-41 · S · (no decision needed)
- **Forms (R-25):** a filled form asks "Discard your answers?" on Escape or a backdrop click, and "Print filled" saves first.
- **Words (X-30):** ask before leaving the Words tab with unsaved changes, or autosave.
- **Report builder (X-41):** use `useBlocker` for sidebar and palette navigation.
- **List settings (G-41):** save (or ask) before jumping to Monthly requirements, and on Escape.
- **Files:** `FillFormDialog.tsx:105-196`, `WordsEditor.tsx`, `ReportsView.tsx:83-87`, `GridToolbar.tsx:650`, `ListSettingsDialog.tsx:89-93`.

### Phase 2: Dead ends and confusion for new users

**2.1 Empty screens give a real next step** · F-08, F-09, F-11, G-04, N-07 · S · (no decision needed)
- **Wrong shortcut (F-08, N-07):** the empty list says Ctrl+N, not Ctrl+Shift+R.
  - Ctrl+Shift+R has no handler. Confirmed: no app menu is set on Windows/Linux (`index.ts:347` sets a menu for mac only), so Electron's default menu, with Force Reload on Ctrl+Shift+R, is probably live.
  - Call `Menu.setApplicationMenu(null)` on non-mac.
  - Either add Ctrl+Shift+D or remove its labels.
  - Put Ctrl+Shift+T on "Add New Task".
- **Empty list (F-08):** add buttons for Add {record}, Bring in a spreadsheet and Add sample entries, and remove the right-click tip.
- **Filters hide everything (G-04):** show "No {records} match your filters" with Clear filters.
- **No lists (F-09):** show the three setup cards.
- **Empty dashboard (F-11):** say "Your dashboard fills up as you add {records} with dates", not "All clear!".
- **Files:** `DataGrid.tsx:771-791`, `GridView.tsx:94-110`, `DashboardView.tsx:605-684`, `main/index.ts`, `Sidebar.tsx:436`, `CommandPalette.tsx:166-176`, `useGlobalKeyboard.ts`.

**2.2 Adding a record shows where it went** · G-28 · S · (no decision needed)
- **Problem:** On a long or filtered list, clicking Add seems to do nothing, so people click again and get blank duplicates.
- **Fix:** Scroll to the new row before editing it. If a filter would hide it, keep it pinned until it's edited, and toast "Added — hidden by your filter. Show it".
- **Files:** `gridStore.ts:274-293`, `DataGrid.tsx:589-602`, `useGridVirtualizer.ts`.

**2.3 Setup survives an interruption and keeps what was chosen** · F-02, F-20, F-21, F-23, F-33 · M · (no decision needed)
- **Interruptions (F-02):** store `setup_step` and a pending grid id, and resume on unlock. Save words and features at each step.
- **Skip (F-20):** "Skip" means "continue with what's on screen".
- **Guessed words (F-21):** re-guess the words only if they were guessed, not typed.
- **Spreadsheet path (F-23):** guess the words from the list name, add a Back button, and store `vocab.record` on the list.
- **Auto-lock during setup (F-33):** reset auto-lock during password setup, and ignore Ctrl+L before the password exists.
- **Files:** `ipc-onboarding.ts:21-31, 119`, `SetupView.tsx`, `GuidedBlankStart.tsx`, `useAutoLock.ts`, `main/index.ts:104-108, 267-270`, `PasswordSetupView.tsx`.

**2.4 First run shows the payoff** · F-14, F-22, F-19 · S · (no decision needed for F-22 and F-19; F-14 follows Decision C)
- **Samples (F-14):** in setup mode, tick "Add sample data" by default and say "You can remove it in one click". Drop the badge that every card has. Show column names on the review step.
- **Date reminders (F-22):** pre-select from the column name ("due", "expires" → "This is when it's due"; "last", "service", "review" → every year). Reword the options and show a sample colored chip.
- **Default variant (F-19):** put "Social Worker Caseload" first, or add `isDefault`.
- **Files:** `ApplyStarterDialog.tsx:50, 89, 167`, `DateRepeatPicker.tsx`, `GuidedBlankStart.tsx:140`, `SetupView.tsx:159`, `starters/human-services.json`.

**2.5 From "a date" to "a deadline"** · D-15, G-20, D-17 · M · (no decision needed)
- **Adding a column (D-15, G-20):** for a Date or Deadline column, Add Column asks "Does this date come due again? No / Every __ months / It's the due date / More options…".
- **"Choose a rule" cells (G-20):** the cell text becomes a button that opens the picker.
- **Header badge:** show a clearer badge on columns that have a rule.
- **Rule editor (D-17):** asks "How is it worked out?" first and fills in the name automatically; the description sits under "More".
- **Files:** `GridToolbar.tsx:56-75, 189-215`, `CellDisplay.tsx:219`, `ColumnHeader.tsx:229, 399-480`, `AlertRuleEditor.tsx:284-364`.

**2.6 Sample entries you can tell apart** · F-13, F-10, F-37 · M · depends on Decision C
- **Sample marker (F-13):** return sample row ids with the grid load and show a "Sample" pill on rows and profiles. Change the banner to "Add your own any time". When a sample row is edited, ask once whether to keep it.
- **"Just looking?" (F-10):** per Decision C (i), open the gallery with samples ticked.
- **Sample wording (F-37):** sample names go through `word()`, or the sample is offered only under human-services words.
- **Files:** `sample-data.ts:14, 53-113`, `SampleDataBanner.tsx`, `SetupView.tsx:112-122`, `SortableRow.tsx`.

**2.7 No social-work leftovers in other workspaces** · R-16, R-17, X-32 · S–M · (no decision needed; follows the 2026-10-01 Decision Log rule)
- **Note formats (R-16):** seed DAP/SOAP/BIRP only under human-services words. Hide the Format control unless a format exists.
- **Note types (R-17):** an example applied to a fresh workspace replaces the default note types, so there are no duplicates like Phone vs Call.
- **Hard-coded wording (X-32):**
  - Use `{{my_*}}` in Profile and `{{name}}` in examples.
  - Put the hard-coded agency and "scrap note" words through vocab.
  - Say "Most organizations" and "Security summary to share".
- **Files:** `CaseLog.tsx:511-518`, `noteFormats.ts`, `activity-types.ts:137-153`, `ProfileSection.tsx`, `EditTemplateModal.tsx:176`, `NotesSection.tsx`, `SecurityCheckup.tsx:341, 370`, `WordsEditor.tsx:160`, `SnippetsView.tsx`.

**2.8 A short tour that matches the app** · F-03, F-04, F-05, F-06, F-07, N-21 · M · (no decision needed)
- **Shorter tour (F-05):** about 7 steps: lists, add a record, a deadline color, profile, dashboard, calendar or reports (whichever is on), and Help. The rest become Help "Show me" mini-tours, and "Retake full tour" stays in Help.
- **Feature switches (F-04):** steps carry `feature?`, so switched-off screens are skipped. Apply the same to MiniTour and FAQ "Show me".
- **Dead targets (F-03, N-21):**
  - Remove the theme-toggle and archived-toggle targets.
  - Add a test that every target exists.
  - Fix the FAQ theme answer and the Focus Mode answer.
- **Wording (F-06):** use neutral examples, and the real menu label instead of "Deadline Alert".
- **Clicks and screen readers (F-07):**
  - Only Next advances the tour.
  - The card gets `role="dialog"`, `aria-modal` and initial focus.
  - Show the step counter once, not twice.
- **Files:** `TourOverlay.tsx`, `MiniTour`, `faqData.tsx:57-62`, `SetupView.tsx:340`.

**2.9 What to do next** · F-12, F-32, N-20 · M · (no decision needed)
- **Getting started (F-12):** add a dismissible "Getting started" card with self-ticking steps: first record, first date with a reminder, first note, backup location confirmed, recovery key saved.
- **Recovery key (F-32):** a skipped key is re-offered there and in the backup reminder, snoozed for 7 days on dismiss.
- **What's New (N-20):** it can't be opened today. Show it once after a version change (`last_seen_version`), and link it from Help and About.
- **Files:** `DashboardView.tsx` or a new card, `SetupView.tsx:334-349`, `PasswordSetupView.tsx:134-150`, `App.tsx:294`, `useModalManager.ts`, `WhatsNewModal.tsx`.

**2.10 Lock and password screens explain themselves** · F-25, F-27, F-29, F-30, F-31 · S–M · (no decision needed)
- **Greyed-out button (F-25):** "Create password" stays enabled and says what's missing inline (the terms box).
- **Wrong password (F-27):** show an inline `role="alert"` message, a live lockout countdown with Unlock disabled, and a Caps Lock warning.
- **Forgot password (F-29):** give an honest explanation, and show the restore button only when it can work.
- **Recovery key typo (F-30):** a wrong key keeps the text instead of clearing it.
- **Length rule (F-31):** "At least ${MIN_PASSWORD_LENGTH} characters", not 8.
- **Files:** `PasswordSetupView.tsx:30, 306-312`, `LockScreenView.tsx:69-95, 253-286`, `auth.ts:202-208`, `ResetPasswordAfterRecoveryDialog.tsx:85`.

**2.11 "Where am I?" (the hidden current list)** · N-03, G-44, D-35, N-15 · M · (no decision needed)
- **Page titles (N-03, G-44):**
  - The top bar shows the page name, and the list name only on a list or profile.
  - The sidebar highlights a list only on `/grid` and `/profile`, with `aria-current`.
  - The status bar hides counts off list screens.
- **List-dependent actions (D-35, N-03):**
  - Dashboard "Print reminder letters" gets a list picker.
  - The palette says which list it adds to.
- **"Saved" indicator (N-15):** show it only for a few seconds after a real save. Remove the duplicate count bar.
- **Files:** `TopBar.tsx:111-122`, `StatusBar.tsx`, `Sidebar.tsx:495`, `DashboardView.tsx:446-452`, `BatchDocumentsDialog.tsx`, `CommandPalette.tsx:160-187`, `GridStatusFooter.tsx`.

**2.12 Settings you can reach and trust** · X-02, X-22, X-29, X-31, X-33, X-27 · S · (no decision needed; this is the G2 step of Decision G)
- **Cut-off tabs (X-02):** add `overflow-y-auto` to the nav, and validate `?tab=`.
- **Data tab (X-22):** add an "Import a spreadsheet…" button, and say "list" instead of "grid".
- **Words editor (X-29):** list each list's own words and link to them, and fix the toast.
- **Requirements summary (X-31):** gate it on the requirements feature.
- **Auto-lock default (X-33):** default to 15 minutes, labelled "(recommended)", so it agrees with the checkup.
- **Template export (X-27):** add a saved-template export channel, so it stops failing with "Invalid grid ID".
- **Files:** `SettingsView.tsx:62, 132-134, 217`, `DataSection.tsx:228-235`, `WordsEditor.tsx`, `GridToolbar.tsx:538-544`, `settingsStore.ts:49`, `SecuritySection.tsx:116`, `TemplateManagerView.tsx:333-340`, `ipc-export.ts:513`.

**2.13 The example gallery** · F-16, F-17, F-18 · S · (no decision needed)
- **Search (F-16):** add a `keywords` array per starter, match on word starts, and include the group name. "No match" offers Start blank and Bring in a spreadsheet.
- **Keyboard focus (F-17):** autofocus the search box, and move focus on each step change.
- **Stray clicks (F-18):** in setup mode, a backdrop click doesn't close the dialog.
- **Files:** `ApplyStarterDialog.tsx:38, 68-74, 130, 155`, `starters/*.json`.

**2.14 Help, the palette and the shortcut list are true** · N-08, N-09, N-22 · M · (no decision needed)
- **Shortcut list (N-08):**
  - Keep one shortcut list in `src/shared` that feeds the modal, Settings, Help and the palette, with a test that every listed key has a handler.
  - Add Undo, Redo, Ctrl+F, Alt+←/→ and Ctrl+Enter.
  - Show ⌘ on a Mac.
- **Palette (N-09):**
  - Add "Go to {list}" for every list, plus Calendar, Help, Trash and Letters, each feature-gated.
  - Rename "Go to Grid".
  - Let the palette search Help.
- **Help (N-22):**
  - Regroup it by job.
  - Merge the duplicate entries.
  - Add a "?" link in each page header.
- **Files:** `KeyboardShortcutsModal.tsx`, `ShortcutsSection.tsx`, `TopBar.tsx:280`, `CommandPalette.tsx:172-204`, `views/help/*`.

**2.15 Human error messages** · L-20, N-28 · S–M · (no decision needed)
- **Problem:** `humanizeError` matches `SQLITE_CONSTRAINT` in the message, but better-sqlite3 keeps that in `err.code` (checked: `SqliteError(message, code)`), so raw SQLite text reaches the screen.
- **Fix:**
  - Map on `err.code` and the table name.
  - Turn anything unmatched into a generic sentence, and log the details.
  - Add a `friendlyError(res.error, fallback)` helper, and lint for `toast.error(res.error)`.
  - Sweep the user-visible `fail()` strings ("Invalid ID", "Row not found", and so on).
- **Files:** `ipc-utils.ts:69-94`, `tests/humanize-error.test.ts`, `safeInvoke.ts`, about 54 call sites.

### Phase 3: Everyday friction

**3.1 Deadline cells say what they mean** · N-04, G-10, G-09, D-29, D-23 (cheap version) · M · (no decision needed)
- **Color isn't enough (N-04, G-10):** pick the shape by the threshold's position, not by class name. Built-in and sample rules use hex colors and get no shape today. Put the threshold label in `aria-label`.
- **No words in the cell (G-09):**
  - Date columns with a rule show "Due Oct 6, 2026 · 4 days late", like Deadline cells do, or offer that per column.
  - Add a one-line color key.
- **Legend (D-29):** build the dashboard legend from the rules in use. The odd yellow tint was not traced to code.
- **"Done" badge (D-23):** show a small "✓ done" badge when the state is done. The full fix is Decision E.
- **Files:** `gridConstants.tsx:50-71`, `alertColors.ts`, `SortableRow.tsx:243-263`, `CellDisplay.tsx`, `DashboardView.tsx:518-544`.

**3.2 Ticking boxes, opening records, starring** · G-06, G-31, G-30 · S · (no decision needed)
- **Checkboxes (G-06):** a plain click on a row checkbox toggles that row; Shift+click selects a range.
- **Opening a record (G-31):**
  - Add "Open" as the first right-click item, Ctrl+Enter to open, and an "Open" link on hover in the name cell.
  - Link chips open on Ctrl+click; a single click just selects the cell.
- **Stars (G-30):** show a clickable star on every row, and label the toolbar toggle "Starred".
- **Files:** `useGridSelection.ts:49-55`, `SortableRow.tsx:182-201`, `gridKeyboardNav.ts`, `GridContextMenu.tsx`, `LinkCell.tsx`, `FilterBar.tsx:529-537`.

**3.3 "Done" on the record page and Week/Month tabs** · R-04, D-22, R-23, D-36 · S–M · (no decision needed)
- **Done buttons (R-04, D-22):** every deadline card gets Done / Extend / Renew, reusing `DeadlineRow`'s `completeDeadlines`, and so do Week and Month rows.
- **Repeated text (R-23):** label the stored date ("Last done …"), and drop the repeated urgency line.
- **Extend dialog (R-23, D-36):** pass the engine's due date as `currentDue`, and require a later date (`min`).
- **Files:** `DeadlinePanel.tsx:271-400`, `ExtendDeadlineDialog.tsx`, `WeekViewTab.tsx`, `MonthViewTab.tsx`, `DeadlineRow.tsx`.

**3.4 Record page: the note box first** · R-10, R-11, R-18, R-32, R-34 · M · (no decision needed)
- **Layout (R-10):**
  - Header, then the composer (a one-line "Add a note…" box), then Deadlines, then Details.
  - Files, Appointments, Stage history and Linked go below, collapsed when empty and showing counts.
  - Show normal scrollbars.
  - "+ Note" is the primary header button.
- **One timeline (R-11):**
  - Merge the Activity log and Timeline into one timeline with a "Show: All kinds ▾" menu.
  - "Show voided notes" replaces "Audit".
  - Earlier versions show on the note itself.
- **Checklist naming (R-18):** call record items "checklist items", with one Add button.
- **Section state (R-32):** key collapse state by list, and show counts in titles.
- **Hover tooltips (R-34):** remove the whole-panel `title=` tooltips.
- **Files:** `ProfileView.tsx:428-551`, `ProfileHeader.tsx:79, 644-653`, `CaseLog.tsx`, `ActivityTimeline.tsx`, `ChecklistToolbar.tsx`, `CollapsibleSection.tsx`, `RecordFiles.tsx`.

**3.5 Edit details on the record page** · R-06, R-22, R-21, R-36 · M · (no decision needed)
- **Editing (R-06):** each detail card is click-to-edit with the grid's `CellEditor`, through `updateCell` with undo. Read-only types stay read-only.
- **Display (R-22):**
  - Values render with `CellDisplay`.
  - Store hidden columns instead of visible ones, so new columns show up.
  - Use plain type labels.
  - Take the badge state from the engine.
- **Status colors (R-21):** status badges use `options[].color`.
- **Number history (R-36):**
  - Record history for number columns regardless of the log setting.
  - Label only the first, last, min and max points.
  - Use one neutral color.
- **Files:** `GridDataSummary.tsx`, `ProfileHeader.tsx:291-298`, `NumberHistory.tsx`, `ipc-cell.ts`.

**3.6 Act on a record from its own page** · R-19, R-33, R-24, R-35 · S–M · (no decision needed)
- **More menu (R-19, R-33):** add a "More ▾" menu with Archive… (with a reason), Duplicate, Move to another list…, Move to trash, and "Print / PDF…" with section checkboxes. Delete whichever print layout is unused.
- **Letters (R-24):** "Generate Letter" reuses the Letters dialog (editable, Copy, Save as PDF), with "Log on timeline".
- **Phone and email links (R-35):** they do nothing today; confirmed that `will-navigate` blocks `mailto:` and `tel:`. Route them through a whitelisted `shell.openExternal`, or show plain text.
- **Files:** `ProfileHeader.tsx:56-85`, `ProfileView.tsx:43-152, 572-579`, `ProfilePrintLayout.tsx`, `GenerateLetterModal.tsx`, `main/index.ts:205-227`.

**3.7 Note composer fixes** · R-15, R-13, R-14 · S · (no decision needed)
- **Snippet menu (R-15):**
  - Trigger only on "/" at the start or after a space.
  - Enter accepts only after an arrow key.
  - Hide the hint when snippets are off, and show it at 15px.
- **Blank notes (R-13):** refuse to save an empty edit ("use Void").
- **Voided notes (R-14):** add "Restore" in the voided view, and one line explaining the 15-minute rule.
- **Files:** `snippetExpander.ts:53-58`, `CaseLog.tsx:216-221, 583`, `ScratchPad.tsx:203-207`, `CaseLogEntry.tsx:111, 217-225`, `ipc-caselog.ts:71-74`, `ActivityTimeline.tsx`.

**3.8 People can select and copy text** · N-05 · S · (no decision needed)
- **Problem:** `user-select: none` on body, and `data-selectable` is used nowhere (checked).
- **Fix:** Allow selection by default, and add `select-none` only to chrome. Add "Copy" to each note's menu.
- **Files:** `globals.css:131-137`, chrome components, `CaseLogEntry.tsx`.

**3.9 "Who's overdue?" and search that finds things** · G-12, G-25 · M · (no decision needed)
- **Due status filter (G-12):** filter on Overdue / Due today / Next 7 or 30 days / Done / Paused, built on the engine. Add a one-click "Overdue" chip.
- **Search (G-25):** search phone (digits only), email, address, notes, status and tags, sharing one list of searchable types with Find & Replace and the board.
- **Files:** `FilterBar.tsx:38-87`, `filterMatch.ts`, `DataGrid.tsx:460-472`, `boardLanes.ts:39-46`, `FindReplaceBar.tsx`.

**3.10 Dashboard: what's due comes first** · D-21, D-08, S-09, S-27, N-24 · M · (no decision needed)
- **Order (D-21):**
  - "What's due" becomes a Customize card, second by default.
  - Drop the duplicate Overdue sub-filter.
  - Move Recently Archived behind a link.
  - Pinned reports go in Customize.
- **Row details (D-08):** rows show the step, count or meter left ("IFSP meeting (step 1 of 4)"), and the button says "Mark IFSP meeting done".
- **Past appointments (S-09):** add a "Needs an outcome" strip for past scheduled appointments, on Today and in the briefing.
- **Requirements (S-27):** say "0 of 1 · 1 scheduled Oct 28 · 18 days left".
- **Tasks badge (N-24):** load the count at startup.
- **Files:** `DashboardView.tsx:357-500`, `DashboardCards.tsx`, `DeadlineRow.tsx:107-121`, `TodayCard.tsx`, `MorningBriefing.tsx`, `ContactStatusLine.tsx`, `periods.ts`, `Sidebar.tsx:293-300`.

**3.11 A calmer toolbar and column menu** · G-22, G-21, G-42 · M · (no decision needed for the grouping; merging Views is item 5.7)
- **Toolbar (G-22):**
  - Up front: Add, Filter, View ▾ and More ▾. Reports ▾ links to the Reports page.
  - List settings becomes a labelled gear.
  - It no longer wraps at 1366px.
- **Column menu (G-21):**
  - Sort, Rename, Hide, Pin, Deadline rule and Delete stay in the menu. Everything else moves to a "Column settings…" dialog.
  - "⋯" is always visible, with a 44px target.
  - Double-click a header to rename it.
- **Pin (G-42):** relabel it "Keep columns up to here in view", or pin just that column.
- **Files:** `GridToolbar.tsx:219-697`, `ColumnHeader.tsx:246-499`.

**3.12 Change a column's type; add every type** · G-19 · M · (no decision needed)
- **Change type:** add "Change type…" to the column menu, with a preview of how many values convert cleanly. Revive the dead dialog in `GridView.tsx:132-145` with plain names.
- **Missing types:** add Notes, Age and Days-until to Add Column, each with a one-line description.
- **Files:** `GridToolbar.tsx:56-75`, `ColumnHeader.tsx`, `GridView.tsx`, `ipc-grid.ts`.

**3.13 Board** · G-33, S-26 · S–M · (no decision needed)
- **Moving cards (G-33):**
  - Add "Move to ▾" on each card.
  - Show the keyboard hint as visible text.
  - Hide table-only toolbar controls in board mode.
  - Close the popover on click-away and Escape.
- **Hidden cards (S-26, G-33):**
  - "N older hidden" becomes a button that shows them.
  - "Hide finished after [14] days" becomes a checkbox.
- **Files:** `BoardView.tsx:130-322`, `StageSettingsDialog.tsx:150-154`, `boardLanes.ts:83`.

**3.14 Calendar look and filters** · S-08, S-29, S-32, S-28 · S · (no decision needed)
- **Month view overlap (S-08):** use `grid-rows-[auto_repeat(6,minmax(7rem,1fr))]`, so the third item and "+N more" aren't covered by the next week.
- **Week view (S-29):** show the record's name on a second line.
- **List filter (S-32):** add a "List: All ▾" picker.
- **Wording and look (S-28):**
  - Say "Usual: {first note type}".
  - Rename "Cancel it" to "Mark cancelled".
  - Show done with a check; strikethrough only for cancelled and no-show.
  - Add a visible "Show:" label.
  - Show the first words of a follow-up.
  - Clicking a task opens the task.
- **Files:** `CalendarView.tsx`, `TimeGrid.tsx:174`, `AppointmentDialog.tsx:194`, `AppointmentPanel.tsx`, `appointments.ts:49-59`, `calendar.ts`.

**3.15 Appointment edits and actions are the same everywhere** · S-18, S-19 · M · (no decision needed)
- **Series (S-18):** editing an occurrence shows the Repeats section; changing it implies "This and following". Add "End this series on…".
- **Actions (S-19):**
  - One shared action set (Done…, No-show, Cancelled, Edit, Delete) on the calendar panel, the Today card and the profile.
  - Ask before marking a future appointment done.
  - The date-reverting part is in 1.23.
- **Files:** `AppointmentDialog.tsx:203`, `AppointmentPanel.tsx`, `TodayCard.tsx`, `RecordAppointments.tsx`.

**3.16 Tasks page** · S-06, S-20, S-21, N-23, S-22 · M · (S-06 is the interim step of Decision A)
- **Checklist items (S-06):** show due checklist items in a section on the Tasks page and as a calendar layer.
- **Sorting (S-20):** add a Sort menu (My order / Due date / Priority) or an Overdue section, and fix the help text.
- **Empty state (S-21, N-23):** delete the duplicate "No tasks yet" block.
- **Clearing completed (S-22):** "Delete completed" is one undo step, and says "You can undo this".
- **Files:** `TasksView.tsx:337-340, 505-534, 798-806`, `ipc-checklists.ts:115-134`, `calendar.ts`, `taskStore.ts`, `faqData.tsx:375`.

**3.17 Checklist ticks don't clutter the log** · S-23, L-28 · S · (no decision needed)
- **Fix:** Undo of a tick or a "Reset cycle" restores the state silently (a `{ silent: true }` flag), and voids the original note instead of adding an opposite one.
- **Files:** `ipc-checklists.ts:69-82`, `Checklist.tsx:203-210, 345-350`.

**3.18 Back goes back** · N-14, R-20 (navigation part), N-29, N-31, N-30 · M · (no decision needed)
- **Back (N-14, R-20):**
  - Back uses `navigate(-1)`, falling back to the list, and is labelled with where it goes.
  - Mouse back and forward work everywhere.
  - "Home" breadcrumbs go to the Dashboard.
  - One `PageHeader` component.
  - A followed link no longer changes "‹ Grid".
- **Loading (N-29):** put `<Suspense>` inside `MainLayout` around the page only (confirmed it wraps the whole app at `App.tsx:176`).
- **Collapsed sidebar (N-31):** collapsed list icons show initials.
- **Shortcuts (N-30):** Ctrl+F opens the palette on screens without search, and zoom works from text fields.
- **Files:** `ProfileView.tsx:298-300`, `SettingsView.tsx:129`, `TasksView.tsx:438`, `ContactsView.tsx:188`, `App.tsx:176`, `Sidebar.tsx:189`, `TopBar.tsx:65-75`, `useZoom.ts`.

**3.19 Contact details on the record** · R-27, R-28 · M · (no decision needed)
- **Manual contact info (R-27):**
  - "Add contact info" offers to create a phone or email column.
  - Otherwise, manual contacts are included in search, exports and the audit log.
  - Hide it on lists that don't hold people.
- **Linked contacts (R-28):** show phone, email and the link note inline with copy buttons, open details in a popover, and use 44px targets.
- **Files:** `ProfileHeader.tsx`, `ipc-row.ts:540-565`, `LinkedProviders.tsx`.

**3.20 Rule options say what they do** · D-18, D-37, D-31, D-32 · M · (no decision needed)
- **Working days (D-18):** relabel "Count working days only" as "If it lands on a day off, move it to the working day before", add "…the next working day", and add "working days" as a unit for interval rules.
- **Sequence start date (D-37):** changing it asks "Correction or new referral?".
- **Meter dialog (D-31):** pre-fill the reading, show the unit, and warn on implausible values.
- **Meter forecast (D-32):** use the first history row's `old_value` as a point.
- **Files:** `AlertRuleEditor.tsx:430-433`, `RuleKindFields.tsx`, `deadlineEngine.ts:367-386, 568-574`, `deadlines.ts:154-156, 219-231`, `MeterReadingDialog.tsx`.

**3.21 Letters and batch documents** · X-35, X-36, X-37 · M · (no decision needed)
- **Letter editor (X-35):**
  - Confirm before discarding changes.
  - Pick the list for "Insert field", and remember each template's list.
  - Use a record search box instead of a long select.
- **Templates (X-36):** show a filled preview with tags as chips, and add "Make letters for many…".
- **Batch documents (X-37):** show "This makes 14 letters" live, and check tags before saving.
- **Files:** `EditTemplateModal.tsx`, `GenerateLetterModal.tsx`, `LetterTemplateView.tsx`, `BatchDocumentsDialog.tsx`.

**3.22 Undo an import** · X-19 · M · (no decision needed)
- **Fix:** Return `newRowIds`, and offer "Undo this import" (move them to Trash) on the results step. Keep a Back button after an error.
- **Files:** `import.ts`, `ImportWizard.tsx:1023`.

### Phase 4: Consistency and accessibility polish

**4.1 15px for real** · N-16, F-34, G-39, R-30, X-39 · M · (no decision needed)
- **Fix:**
  - Set `--text-sm: 15px` and `--text-xs: 14px` (keep smaller only for `kbd`).
  - Remove `text-[10px]` and `text-[11px]`.
  - Check the tight layouts visually: toolbar chips, calendar and grid header.
  - Settings checkboxes become 20px and rows 44px.
- **Correction:** G-39 and F-08 say `text-xs` is 12px. It is 13px (`globals.css:23`).
- **Files:** `globals.css:23-26`, `AcuityBadge.tsx`, and visual checks.

**4.2 Focus rings and real dialogs** · N-17, N-19, F-28, F-35 · M · (no decision needed)
- **Focus rings (N-17):** add a base `:focus-visible { outline: 3px solid … }`, and remove the 25 bare `outline-hidden` classes.
- **Dialogs and tabs (N-19, F-35):**
  - Add a shared `<Modal>` with `role="dialog"`, `aria-modal` and `aria-labelledby`, used by the 7 dialogs that lack them.
  - Give the recovery-key checkbox a 20px size.
  - Tablists get arrow keys.
  - The active list gets `aria-current`.
  - List reordering works from the keyboard.
- **Lock screen (F-28):** add labels to the password and recovery-key inputs and the back arrows, and remove `tabIndex={-1}` from show-password.
- **Files:** `globals.css`, `TaskFormDialog.tsx`, `GlobalTaskDialog.tsx`, `SnoozeDialog.tsx`, `RecoveryKeyDisplayModal.tsx`, `ChecklistAddDialog.tsx`, letter modals, `LockScreenView.tsx`, `Sidebar.tsx`.

**4.3 Keyboard in the grid and rule editor; target sizes** · G-32, D-27, D-28 · M · (no decision needed)
- **Grid (G-32):**
  - Use a roving tabindex, so the grid is one tab stop.
  - Tab can leave the grid.
  - Add "Move left / right" for columns.
  - One shared `Menu` component with arrow keys and Escape.
- **Rule editor (D-27):** threshold swatches become buttons, inputs are 44px, and delete buttons get labels.
- **Dashboard rows (D-28):** buttons are 44px, text is `text-base`, and "Mark done" labels name the record.
- **Files:** `SortableRow.tsx:326`, `gridKeyboardNav.ts:68-72`, `ColumnHeader.tsx:181-192`, `GridContextMenu.tsx`, `AlertRuleEditor.tsx:170-524`, `DeadlineRow.tsx`, `DashboardView.tsx:510, 598`.

**4.4 Contrast** · N-18 · S · (no decision needed)
- **Fix:** No text lighter than slate-500 in light mode or slate-400 in dark mode; slate-300 only for decorative dashes.
- **Follow-up:** re-run the ui-tour (`test-results/ui-tour/current/` is missing on disk, so no reviewer saw dark mode) and check light/dark pairs.
- **Files:** `CaseLogEntry.tsx:142`, `ActivityTimeline.tsx:173`, `LinkedProviders.tsx:298`, `CalendarView.tsx:260`, `Checklist.tsx`, `ChecklistItem.tsx`.

**4.5 One name for deadline rules (and friends)** · D-16, X-26, N-12 · S–M · (no decision needed)
- **Names:**
  - "Deadline rule" everywhere: menu, Settings, editor, Help, tooltip and grid tip.
  - "Colors as it gets close" instead of "thresholds"; Settings rows show the rule's plain summary and swatches.
  - "Scratch notes", one name.
  - "Letters & documents".
  - "Written by you / Automatic" instead of Manual and System.
- **Guards:** use the vocab placeholder in the editor, and add a word-list lint.
- **Files:** `ColumnHeader.tsx:363-478`, `AlertRuleEditor.tsx:334-440`, `AlertsSection.tsx`, `SettingsView.tsx:115`, `faqData.tsx`, `ScratchPad.tsx:235`, `ActivityTimeline.tsx`, `DataGrid.tsx` tip.

**4.6 No "grid", no jargon** · N-13, G-38, R-31 · S · (no decision needed)
- **"Grid":** replace it with the list's name or `t('list')` in about 20 places, and extend the eslint vocab rule to "grid".
- **"Rows":** say {records} instead.
- **Filter wording:** "Match all / any" and "Condition" instead of AND/OR and "Operator".
- **Names and labels:**
  - Plain type names.
  - The priority header goes through `t('priority')`.
  - "Color rules…".
  - Filter chips show dates the way cells do.
  - Back buttons say "‹ Customers".
  - The audit-trail toast says "42 entries", not "records".
- **Files:** `ProfileView.tsx:355-382`, `CommandPalette.tsx:174`, `TemplateManagerView.tsx`, `ImportPreviewModal.tsx`, `ApplyTemplateDialog.tsx`, `FindReplaceBar.tsx`, `KeyboardShortcutsModal.tsx`, `FilterBar.tsx`, `GroupingBar.tsx`, `GridHeaderRow.tsx`, `GridContextMenu.tsx`, `AuditReportDialog.tsx:65`, `GridDataSummary.tsx:301`.

**4.7 Platform-aware, grammatical text** · F-36, X-40, N-25, D-30, D-38 · S · (no decision needed)
- **Platform:**
  - Plain keyring wording and "computer account" instead of "Windows account" (F-36).
  - The cloud warning becomes an inline card.
  - Update instructions and the update banner per platform and build (X-40, N-25).
- **Grammar (D-30):** store morning-briefing plurals as [one, many] pairs.
- **Reminders (D-38):** "Summary when I first unlock Pulse" vs "Desktop notification at a set time", under one heading.
- **Files:** `auth.ts:121-160`, `LockScreenView.tsx:125`, `PasswordSetupView.tsx:51-55`, `AboutSection.tsx:91-102`, `UpdateBanner.tsx:25-27`, `MorningBriefing.tsx:74-109`, `AlertsSection.tsx:116-134`, `RemindersSection.tsx`.

### Phase 5: Bigger restructuring (after the owner's decisions)

**5.1 One kind of to-do** · S-04, L-31, S-24, R-18 (long-term part), N-12 (task naming) · L · Decision A
- **Model:** a To-do has an optional record, an optional note (which replaces follow-ups), a due date, repeat, priority and snooze, with one recurrence helper. A record's checklist is its to-dos; the Tasks page becomes "To-dos". Templates apply to a record or to nobody.
- **Templates (S-24):** one template editor.
- **Help:** add the topic "Task, checklist, follow-up or appointment?".
- **Files:** a migration, `ipc-tasks.ts`, `ipc-checklists.ts`, `checklist-apply.ts`, `TasksView.tsx`, `Checklist.tsx`, `ChecklistTemplateEditor.tsx`, `calendar.ts`, dashboard cards.

**5.2 Deleted lists and columns go to Trash** · X-11, N-06, L-13, G-35, G-17, L-09 · M–L · Decision D (D1)
- **Lists:**
  - Soft-deleted lists show in Trash with Restore and "Delete forever", and are purged after 30 days.
  - Keep a snapshot of their links.
  - Restore re-enables the list's records.
- **Columns:**
  - Columns get `deleted_at`, and a "Deleted columns" section in list settings.
  - A real Undo for column delete returns.
- **Files:** a migration, `ipc-grid.ts:173-183, 296-324`, `TrashView.tsx`, `Sidebar.tsx`, `gridColumnSlice.ts`, purge job.

**5.3 "Done" for one-off dates** · D-06, D-23, L-25 · M · Decisions E and B
- **One-off rules (D-06):** a no-interval rule's Done asks Renewed (new date) or Finished (keep the date and add a done flag).
- **Relative, calendar and sequence columns (D-23):** become Deadline columns showing "Due … / Done …".
- **One transaction (L-25):** add a main-side `DEADLINE_MARK_DONE` that does the cell, note and checklist in one transaction with one undo snapshot, like `STAGE_MOVE`. Put the note insert and its date updates in one transaction.
- **Files:** `completeDeadline.ts`, `DeadlineRow.tsx`, a new IPC in `deadline-actions.ts`, `ipc-caselog.ts:57-66`, `MoveToGridModal.tsx:255-285` (bulk loop), the column conversion.

**5.4 Who a rule belongs to; contact rules** · D-11, L-32 · M (D-11), L (L-32) · Decision F
- **Shared rules (D-11):** show "Used by: …" in the editor and the Settings list, and offer "Change for all / Make a copy for this column".
- **Contact rules (L-32), later:** a "Contact rule" kind on the engine replaces requirements. The Monthly card becomes a view of it, and requirements are migrated.
- **Files:** `AlertRuleEditor.tsx`, `AlertsSection.tsx`, `ColumnHeader.tsx:451-456`, `rule-columns.ts`, `contact-requirements.ts`, the engine.

**5.5 Settings in about 7 tabs** · X-25, N-27, D-38 (placement) · M · Decision G
- **Tabs:** Workspace, Appearance, Security & backup, Deadlines, Reminders, Notes, Data (with an "Advanced" disclosure for reset and integrity checks).
- **Features:** get their own tab or section.
- **Moved elsewhere:** Shortcuts and About move to Help; the Snippets tab is removed.
- **Defaults:** Snippets are off by default in a blank workspace, and offered in context.
- **Opening:** Settings opens on the first tab.
- **Files:** `SettingsView.tsx:108-120`, `AlertsSection.tsx`, `features.ts`, `WorkspaceSection.tsx`.

**5.6 Sidebar groups, one templates library, one home for printouts** · N-10, N-11, X-28, L-35, N-26 · M–L · Decision G
- **Sidebar (N-10):** My work / {Lists} / Set up (collapsible), with Trash at the bottom.
- **Templates (N-11, X-28, L-35):**
  - One "Templates & text" page: Checklists · Letters & documents · Snippets, with feature-gated tabs.
  - One `.pulse` format on the starter schema, opened through `ApplyStarterDialog`, with "My templates" in the same gallery.
- **Printouts (N-26):**
  - The Reports page gets a "Ready-made printouts" row.
  - "Add to calendar" becomes "Send to Outlook/Google…".
  - Focus Mode becomes a Dashboard button.
- **Files:** `Sidebar.tsx:414-754`, `TemplateManagerView.tsx`, `WorkspaceSection.tsx`, `starters.ts`, `templates.ts`, `ipc-starters.ts`, `ReportsView.tsx`, `DashboardView.tsx:434-441`.

**5.7 One "Views" menu** · G-23, N-27 (Saved vs Views part) · M · Decision G
- **Fix:**
  - Merge Saved filters into Views ("Save what I see now…").
  - The button shows the active view's name, with a "Standard view" reset.
  - A view stores its hidden columns instead of rewriting the columns.
  - Migrate existing filter presets into views.
- **Files:** `FilterBar.tsx:555-569, 762`, `SavedViewsDropdown.tsx`, `gridFilterSlice.ts:164-238`, a migration.

**5.8 Merge the two broken duplicates in the data model** · L-19, G-37 · M · Decision H (H2)
- **Highlights (L-19):** "Highlight → all rows" saves a column rule. Migrate the stamped copies, and delete the stamping code in `ipc-row.ts:54-183`.
- **Tags (G-37):** profile tags show as a built-in, hideable Tags column, and the filter says "Tags".
- **Files:** `CellConditionalFormatPanel.tsx:259-264`, `ipc-row.ts`, `FilterBar.tsx:326, 649`, `ProfileHeader.tsx`.

**5.9 The "try it" path** · F-10, F-14 · S–M · Decision C
- **Fix:** "Just looking?" opens the gallery with samples ticked, so every starter can be a demo. When the last sample list is removed and no lists remain, setup is offered again (this ties to 2.1, F-09).
- **Files:** `SetupView.tsx:112-122`, `ApplyStarterDialog.tsx`, `sample-data.ts`.

---

## 4. Deferred / won't do

| ID | Reason |
|-|-|
| L-30 | Every date edit re-reads all appointment series. There's no visible effect at today's volumes. Revisit if series counts reach the hundreds. |
| F-26 | Terms acceptance isn't recorded. It has no user-visible effect and isn't a current legal requirement. Add `terms_accepted_at` only if the terms gain legal weight. |
| L-33 | Note structure in four places. This is an L-effort data-model change with low severity, and per Decision H2 the current set is workable. Revisit with Decision A or contact rules. |
| L-34 | Six ways to label records. This is an L-effort change; each label works on its own terms, so per Decision H2 leave it. G-37 (5.8) covers the one that's actually invisible. |

**Claims checked against the code:**
- **Deleted rules (X-13 vs D-05 and L-02):** X-13 says the affected columns "disappear from the dashboard". The loader keeps orphaned rule ids (`deadlines.ts:88-90`), so they *flood* the dashboard as overdue. D-05 and L-02 are right; the fix is the same.
- **Text sizes (G-39 and F-08 vs R-30 and N-16):** G-39 and F-08 say `text-xs` is 12px. It is 13px (`globals.css:23`). The fix is unchanged.
- **Ctrl+Shift+R reload (G-04, suspected):** no menu is set on Windows/Linux (`index.ts:347` is mac-only), so Electron's default menu with Force Reload is probably active. The fix stays in 2.1.
- **Phone and email links (R-35, suspected):** confirmed. `will-navigate` cancels any non-app origin, including `mailto:` and `tel:`.
- **Paste from clipboard (X-14):** confirmed. `setPermissionCheckHandler(() => false)` denies the renderer's clipboard read.
- **Password change (X-01):** confirmed. The button is disabled by the same flag that renders the form.
- **"Run now" backup (X-04):** confirmed. The renderer sends `intervalDays: 0`, and main throws on values below 1.
- **Checklist undo (L-01):** confirmed. No migration adds `updated_at` to `checklist_items`.
- **What's New (N-20):** confirmed. `setWhatsNewOpen(true)` is never called.
- **Text selection (N-05):** confirmed. `data-selectable` is used nowhere.
- **Snooze (S-13):** confirmed. `>=` vs `<=` disagree by one day.
- **Error messages (L-20):** confirmed. `SqliteError` keeps the code in `.code`, not the message.
- **Calendar rules done early (D-04):** the current behavior is deliberate and pinned by `tests/deadline-calendar.test.ts:15-16`. It's kept in 1.20, but flagged for the owner under Decision E.
- **Still unverified (kept, marked suspected):** G-36 (edit-options panel clipping), S-31, X-42, L-24, L-27, D-29 (yellow tint). Each fix is cheap and safe either way.
- **Lock-screen screenshot (`17-profile-job.png`):** reviewers disagreed on whether it was mislabeled. It's the R-07, N-02 and L-07 bug, not a missed click.

## 5. Keep as is

- **Deadline engine:** pure and shared, with a zod schema per kind. Its dates are DST-safe, month maths stays in the month, and leap days are clamped. `engineRuleFrom` falls back safely. Most screens already go through `loadDeadlines` or `evaluateRuleForRow`.
- **"Done" and extensions:** "Done" is one undo step, voids its note and removes its checklist; the meter "Done" restores both readings. Extensions need a reason, are tied to their date and step, and can be undone.
- **Rule editor:** plain-language kind cards, a live preview on a real record, and validation by the engine's own schema. Starter rules refer to columns by name, with a safe fallback.
- **Undo for single actions** comes with a toast and history. `STAGE_MOVE` (one transaction, one snapshot) and appointment snapshot undo are the models to copy.
- **Grid performance:** one pivot query, cached statements, a `_loadVersion` guard, smooth virtual scrolling at 200+ records, a frozen name column, and optimistic edits with rollback.
- **Note integrity:** a 15-minute delete window and then void-with-reason, full edit history, the last-used note type remembered, validated time and mileage, and Ctrl+Enter to save.
- **Files:** encrypted, with a duplicate check, a clear "copies aren't encrypted" notice, and undoable delete.
- **Appointments:** wall-time storage, real occurrence rows with exdates, the clear "Only this one / This and following / All" wording, calendar keyboard shortcuts, 44px events, and lanes for overlaps.
- **Privacy:** reminders and `.ics` use initials by default and leave out note text, nothing is kept while locked, exports are marked unencrypted, and CSV formula injection is guarded.
- **Security and restore:** the password policy and strength meter, the recovery-key design and printable card, the security checkup, the Move-to-new-computer wizard (it verifies the backup), the key envelope, restore safety copies with rollback, and factory reset needing both a phrase and the password.
- **Setup:** the clear three-way start screen, the gallery's review step ("nothing you already have is changed"), the short guided blank start with per-list words, cleanup of an abandoned import, and no morning briefing on setup day.
- **Starter sample data** is tracked by row id, comes with a realistic year of history, and is clearly bannered.
- **Feature switches** only hide things (nothing is deleted). Help offers "Turn on" for switched-off topics, and Dashboard Customize remembers hidden cards.
- **Vocabulary layer:** applied almost everywhere. Keep the eslint rule and extend it to "grid".
- **New list dialog**, the List settings display-name builder, the link picker, filter quick presets, and the board basics (lanes, nearest deadline first, "N days here", and `aria-live` after moves).
- **Linked records:** both directions, with deadline rollups in plain sentences. Stage history reads "now, for 12 days".
- **Reports home:** a one-sentence answer per card, with an in-page unsaved-changes guard. Keep it as the plain-language standard.
- **Accessibility basics already in place:** sidebar items are 44px with 3px focus rings, there's a skip link, reduced motion is respected, there's a high-contrast mode, and ConfirmDialog's Escape and Enter handling is the model for 1.1.
- **Import wizard core:** header-row detection, day/month order detection, "Smith, Jane" flipping, and link matching by name.

---

## Appendix: where every finding went

| ID | Severity | Where it went | Decision |
|-|-|-|-|
| F-01 | High | 1.3 "Remove sample data" keeps the user's own work | C |
| F-02 | Medium | 2.3 Setup survives an interruption and keeps what was chosen | — |
| F-03 | Medium | 2.8 A short tour that matches the app | — |
| F-04 | Medium | 2.8 A short tour that matches the app | — |
| F-05 | Medium | 2.8 A short tour that matches the app | — |
| F-06 | Low | 2.8 A short tour that matches the app | — |
| F-07 | Low | 2.8 A short tour that matches the app | — |
| F-08 | Medium | 2.1 Empty screens give a real next step | — |
| F-09 | Medium | 2.1 Empty screens give a real next step | — |
| F-10 | Medium | 2.6 Sample entries you can tell apart; 5.9 The "try it" path | C |
| F-11 | Low | 2.1 Empty screens give a real next step | — |
| F-12 | Medium | 2.9 What to do next | — |
| F-13 | Medium | 2.6 Sample entries you can tell apart | C |
| F-14 | Medium | 2.4 First run shows the payoff; 5.9 The "try it" path | C |
| F-15 | Medium | 1.30 Never fail silently | — |
| F-16 | Low | 2.13 The example gallery | — |
| F-17 | Low | 2.13 The example gallery | — |
| F-18 | Low | 2.13 The example gallery | — |
| F-19 | Low | 2.4 First run shows the payoff | — |
| F-20 | Medium | 2.3 Setup survives an interruption and keeps what was chosen | — |
| F-21 | Low | 2.3 Setup survives an interruption and keeps what was chosen | — |
| F-22 | Medium | 2.4 First run shows the payoff | — |
| F-23 | Low | 2.3 Setup survives an interruption and keeps what was chosen | — |
| F-24 | Medium | 1.28 Import brings in the right data | — |
| F-25 | Medium | 2.10 Lock and password screens explain themselves | — |
| F-26 | Low | Deferred | — |
| F-27 | Medium | 2.10 Lock and password screens explain themselves | — |
| F-28 | Medium | 4.2 Focus rings and real dialogs | — |
| F-29 | Medium | 2.10 Lock and password screens explain themselves | — |
| F-30 | Low | 2.10 Lock and password screens explain themselves | — |
| F-31 | Low | 2.10 Lock and password screens explain themselves | — |
| F-32 | Medium | 2.9 What to do next | — |
| F-33 | Low | 2.3 Setup survives an interruption and keeps what was chosen | — |
| F-34 | Low | 4.1 15px for real | — |
| F-35 | Low | 4.2 Focus rings and real dialogs | — |
| F-36 | Low | 4.7 Platform-aware, grammatical text | — |
| F-37 | Low | 2.6 Sample entries you can tell apart | C |
| G-01 | Blocker | 1.15 Bulk Edit crash and a stuck board | — |
| G-02 | High | 1.15 Bulk Edit crash and a stuck board | — |
| G-03 | High | 1.14 The list acts on what you see | — |
| G-04 | Medium | 2.1 Empty screens give a real next step | — |
| G-05 | High | 1.14 The list acts on what you see | — |
| G-06 | High | 3.2 Ticking boxes, opening records, starring | — |
| G-07 | High | 1.14 The list acts on what you see | — |
| G-08 | Medium | 1.33 Exports say what the screen says | — |
| G-09 | High | 3.1 Deadline cells say what they mean | — |
| G-10 | Medium | 3.1 Deadline cells say what they mean | — |
| G-11 | Medium | 1.34 Dates, sorting and timestamps | — |
| G-12 | High | 3.9 "Who's overdue?" and search that finds things | — |
| G-13 | High | 1.18 The remaining deadline screens go through the engine | — |
| G-14 | High | 1.16 Grid edits that quietly corrupt data | — |
| G-15 | Medium | 1.16 Grid edits that quietly corrupt data | — |
| G-16 | Medium | 1.16 Grid edits that quietly corrupt data | — |
| G-17 | High | 1.9 Undo that reports success when it failed; 5.2 Deleted lists and columns go to Trash | D |
| G-18 | High | 1.11 Moving a record to another list loses data | D |
| G-19 | Medium | 3.12 Change a column's type; add every type | — |
| G-20 | Medium | 2.5 From "a date" to "a deadline" | — |
| G-21 | Medium | 3.11 A calmer toolbar and column menu | — |
| G-22 | Medium | 3.11 A calmer toolbar and column menu | — |
| G-23 | Medium | 5.7 One "Views" menu | G |
| G-24 | Medium | 1.14 The list acts on what you see | — |
| G-25 | Medium | 3.9 "Who's overdue?" and search that finds things | — |
| G-26 | Medium | 1.10 The undo stack behaves predictably | — |
| G-27 | Medium | 1.14 The list acts on what you see | — |
| G-28 | High | 2.2 Adding a record shows where it went | — |
| G-29 | Medium | 1.16 Grid edits that quietly corrupt data | — |
| G-30 | Medium | 3.2 Ticking boxes, opening records, starring | — |
| G-31 | Medium | 3.2 Ticking boxes, opening records, starring | — |
| G-32 | Medium | 4.3 Keyboard in the grid and rule editor; target sizes | — |
| G-33 | Medium | 3.13 Board | — |
| G-34 | Medium | 1.9 Undo that reports success when it failed | — |
| G-35 | Medium | 1.12 Deleted lists: honest wording, and hidden everywhere; 5.2 Deleted lists and columns go to Trash | D |
| G-36 | Medium | 1.15 Bulk Edit crash and a stuck board | — |
| G-37 | Medium | 5.8 Merge the two broken duplicates in the data model | H |
| G-38 | Low | 4.6 No "grid", no jargon | — |
| G-39 | Low | 4.1 15px for real | — |
| G-40 | Low | 1.34 Dates, sorting and timestamps | — |
| G-41 | Low | 1.37 Don't lose typed work in dialogs | — |
| G-42 | Low | 3.11 A calmer toolbar and column menu | — |
| G-43 | Low | 1.34 Dates, sorting and timestamps | — |
| G-44 | Low | 2.11 "Where am I?" (the hidden current list) | — |
| R-01 | Blocker | 1.1 Escape on the record page throws away work | — |
| R-02 | High | 1.2 Drafts stay with their own record | — |
| R-03 | High | 1.22 Date a note, and "Done", by when it happened | B |
| R-04 | High | 3.3 "Done" on the record page and Week/Month tabs | — |
| R-05 | High | 1.17 Focus Mode uses the deadline engine | — |
| R-06 | High | 3.5 Edit details on the record page | — |
| R-07 | High | 1.24 A record opens from anywhere | — |
| R-08 | High | 1.19 Profile PDF and handoff packet are right and private | — |
| R-09 | Medium | 1.19 Profile PDF and handoff packet are right and private | — |
| R-10 | High | 3.4 Record page: the note box first | — |
| R-11 | Medium | 3.4 Record page: the note box first | — |
| R-12 | Medium | 1.31 Note search covers every note | — |
| R-13 | Medium | 3.7 Note composer fixes | — |
| R-14 | Medium | 3.7 Note composer fixes | — |
| R-15 | Medium | 3.7 Note composer fixes | — |
| R-16 | Medium | 2.7 No social-work leftovers in other workspaces | — |
| R-17 | Medium | 2.7 No social-work leftovers in other workspaces | — |
| R-18 | Medium | 3.4 Record page: the note box first; 5.1 One kind of to-do | A |
| R-19 | Medium | 3.6 Act on a record from its own page | — |
| R-20 | Medium | 1.10 The undo stack behaves predictably; 3.18 Back goes back | — |
| R-21 | Medium | 3.5 Edit details on the record page | — |
| R-22 | Medium | 3.5 Edit details on the record page | — |
| R-23 | Medium | 3.3 "Done" on the record page and Week/Month tabs | — |
| R-24 | Medium | 3.6 Act on a record from its own page | — |
| R-25 | Medium | 1.37 Don't lose typed work in dialogs | — |
| R-26 | Medium | 1.30 Never fail silently | — |
| R-27 | Medium | 3.19 Contact details on the record | — |
| R-28 | Low | 3.19 Contact details on the record | — |
| R-29 | Low | 1.8 Show what depends on a thing before deleting it | — |
| R-30 | Low | 4.1 15px for real | — |
| R-31 | Low | 4.6 No "grid", no jargon | — |
| R-32 | Low | 3.4 Record page: the note box first | — |
| R-33 | Low | 3.6 Act on a record from its own page | — |
| R-34 | Low | 3.4 Record page: the note box first | — |
| R-35 | Low | 3.6 Act on a record from its own page | — |
| R-36 | Low | 3.5 Edit details on the record page | — |
| R-37 | Low | 1.2 Drafts stay with their own record | — |
| D-01 | High | 1.17 Focus Mode uses the deadline engine | — |
| D-02 | High | 1.17 Focus Mode uses the deadline engine | — |
| D-03 | High | 1.18 The remaining deadline screens go through the engine | — |
| D-04 | High | 1.20 Deadline engine bugs | E |
| D-05 | High | 1.7 Deleting a deadline rule floods every reminder with false "overdue" | — |
| D-06 | High | 5.3 "Done" for one-off dates | E |
| D-07 | High | 1.20 Deadline engine bugs | — |
| D-08 | Medium | 3.10 Dashboard: what's due comes first | — |
| D-09 | High | 1.21 The rule editor and picker use the right list | F |
| D-10 | Medium | 1.21 The rule editor and picker use the right list | F |
| D-11 | Medium | 5.4 Who a rule belongs to; contact rules | F |
| D-12 | Medium | 1.22 Date a note, and "Done", by when it happened | B |
| D-13 | Medium | 1.20 Deadline engine bugs | — |
| D-14 | Medium | 1.20 Deadline engine bugs | — |
| D-15 | Medium | 2.5 From "a date" to "a deadline" | — |
| D-16 | Medium | 4.5 One name for deadline rules (and friends) | F |
| D-17 | Low | 2.5 From "a date" to "a deadline" | — |
| D-18 | Medium | 3.20 Rule options say what they do | — |
| D-19 | Medium | 1.35 Dashboard numbers agree | — |
| D-20 | Medium | 1.35 Dashboard numbers agree | — |
| D-21 | Medium | 3.10 Dashboard: what's due comes first | — |
| D-22 | Medium | 3.3 "Done" on the record page and Week/Month tabs | — |
| D-23 | Medium | 3.1 Deadline cells say what they mean; 5.3 "Done" for one-off dates | E |
| D-24 | Low | 1.20 Deadline engine bugs | — |
| D-25 | Medium | 1.8 Show what depends on a thing before deleting it | — |
| D-26 | Low | 1.21 The rule editor and picker use the right list | — |
| D-27 | Medium | 4.3 Keyboard in the grid and rule editor; target sizes | — |
| D-28 | Low | 4.3 Keyboard in the grid and rule editor; target sizes | — |
| D-29 | Low | 3.1 Deadline cells say what they mean | — |
| D-30 | Low | 4.7 Platform-aware, grammatical text | — |
| D-31 | Low | 3.20 Rule options say what they do | — |
| D-32 | Low | 3.20 Rule options say what they do | — |
| D-33 | Low | 1.36 The calendar file is complete and valid | — |
| D-34 | Low | 1.20 Deadline engine bugs | — |
| D-35 | Low | 2.11 "Where am I?" (the hidden current list) | — |
| D-36 | Low | 3.3 "Done" on the record page and Week/Month tabs | — |
| D-37 | Low | 3.20 Rule options say what they do | — |
| D-38 | Low | 4.7 Platform-aware, grammatical text; 5.5 Settings in about 7 tabs | G |
| S-01 | High | 1.26 Checklist "Repeat" stops pretending | A |
| S-02 | High | 1.22 Date a note, and "Done", by when it happened | B |
| S-03 | High | 1.25 Repeating appointments behave | — |
| S-04 | High | 5.1 One kind of to-do | A |
| S-05 | Medium | 1.27 Tasks keep their data and their schedule | — |
| S-06 | Medium | 3.16 Tasks page | A |
| S-07 | Medium | 1.13 Archived means archived | — |
| S-08 | Medium | 3.14 Calendar look and filters | — |
| S-09 | Medium | 3.10 Dashboard: what's due comes first | — |
| S-10 | Medium | 1.25 Repeating appointments behave | — |
| S-11 | Medium | 1.25 Repeating appointments behave | — |
| S-12 | Medium | 1.27 Tasks keep their data and their schedule | — |
| S-13 | Medium | 1.27 Tasks keep their data and their schedule | — |
| S-14 | Medium | 1.27 Tasks keep their data and their schedule | — |
| S-15 | Medium | 1.32 Stage history isn't overwritten | — |
| S-16 | Medium | 1.32 Stage history isn't overwritten | — |
| S-17 | Medium | 1.25 Repeating appointments behave | — |
| S-18 | Medium | 3.15 Appointment edits and actions are the same everywhere | — |
| S-19 | Medium | 1.23 Voiding or undoing a note puts its dates back; 3.15 Appointment edits and actions are the same everywhere | — |
| S-20 | Low | 3.16 Tasks page | — |
| S-21 | Low | 3.16 Tasks page | — |
| S-22 | Low | 3.16 Tasks page | — |
| S-23 | Low | 3.17 Checklist ticks don't clutter the log | — |
| S-24 | Low | 5.1 One kind of to-do | A |
| S-25 | Low | 1.15 Bulk Edit crash and a stuck board | — |
| S-26 | Low | 3.13 Board | — |
| S-27 | Low | 3.10 Dashboard: what's due comes first | — |
| S-28 | Low | 3.14 Calendar look and filters | — |
| S-29 | Low | 3.14 Calendar look and filters | — |
| S-30 | Low | 1.36 The calendar file is complete and valid | — |
| S-31 | Low | 1.25 Repeating appointments behave | — |
| S-32 | Low | 3.14 Calendar look and filters | — |
| X-01 | Blocker | 1.4 Broken safety buttons in Settings | — |
| X-02 | High | 2.12 Settings you can reach and trust | — |
| X-03 | High | 1.4 Broken safety buttons in Settings | — |
| X-04 | High | 1.4 Broken safety buttons in Settings | — |
| X-05 | High | 1.5 Backups you can restore, and know about | — |
| X-06 | High | 1.5 Backups you can restore, and know about | — |
| X-07 | High | 1.5 Backups you can restore, and know about | — |
| X-08 | Medium | 1.6 Restore tells the truth | — |
| X-09 | Medium | 1.6 Restore tells the truth | — |
| X-10 | Low | 1.4 Broken safety buttons in Settings | — |
| X-11 | High | 1.12 Deleted lists: honest wording, and hidden everywhere; 5.2 Deleted lists and columns go to Trash | D |
| X-12 | High | 1.3 "Remove sample data" keeps the user's own work | C |
| X-13 | High | 1.7 Deleting a deadline rule floods every reminder with false "overdue" | — |
| X-14 | High | 1.29 Import paths that always fail | — |
| X-15 | Medium | 1.29 Import paths that always fail | — |
| X-16 | High | 1.28 Import brings in the right data | — |
| X-17 | Medium | 1.28 Import brings in the right data | — |
| X-18 | Medium | 1.29 Import paths that always fail | — |
| X-19 | Low | 3.22 Undo an import | — |
| X-20 | Medium | 1.33 Exports say what the screen says | — |
| X-21 | Medium | 1.33 Exports say what the screen says | — |
| X-22 | Medium | 2.12 Settings you can reach and trust | — |
| X-23 | Medium | 1.8 Show what depends on a thing before deleting it | — |
| X-24 | Medium | 1.6 Restore tells the truth | — |
| X-25 | Medium | 5.5 Settings in about 7 tabs | G |
| X-26 | Medium | 4.5 One name for deadline rules (and friends) | — |
| X-27 | Medium | 2.12 Settings you can reach and trust | — |
| X-28 | Medium | 5.6 Sidebar groups, one templates library, one home for printouts | G |
| X-29 | Medium | 2.12 Settings you can reach and trust | — |
| X-30 | Low | 1.37 Don't lose typed work in dialogs | — |
| X-31 | Medium | 2.12 Settings you can reach and trust | — |
| X-32 | Low | 2.7 No social-work leftovers in other workspaces | — |
| X-33 | Medium | 2.12 Settings you can reach and trust | — |
| X-34 | Medium | 1.30 Never fail silently | — |
| X-35 | Medium | 3.21 Letters and batch documents | — |
| X-36 | Low | 3.21 Letters and batch documents | — |
| X-37 | Low | 3.21 Letters and batch documents | — |
| X-38 | Low | 1.34 Dates, sorting and timestamps | — |
| X-39 | Low | 4.1 15px for real | — |
| X-40 | Low | 4.7 Platform-aware, grammatical text | — |
| X-41 | Low | 1.37 Don't lose typed work in dialogs | — |
| X-42 | Low | 1.28 Import brings in the right data | — |
| N-01 | High | 1.1 Escape on the record page throws away work | — |
| N-02 | High | 1.24 A record opens from anywhere | — |
| N-03 | High | 2.11 "Where am I?" (the hidden current list) | — |
| N-04 | High | 3.1 Deadline cells say what they mean | — |
| N-05 | High | 3.8 People can select and copy text | — |
| N-06 | High | 1.12 Deleted lists: honest wording, and hidden everywhere; 5.2 Deleted lists and columns go to Trash | D |
| N-07 | Medium | 2.1 Empty screens give a real next step | — |
| N-08 | Medium | 2.14 Help, the palette and the shortcut list are true | — |
| N-09 | Medium | 2.14 Help, the palette and the shortcut list are true | — |
| N-10 | Medium | 5.6 Sidebar groups, one templates library, one home for printouts | G |
| N-11 | Medium | 5.6 Sidebar groups, one templates library, one home for printouts | G |
| N-12 | Medium | 4.5 One name for deadline rules (and friends); 5.1 One kind of to-do | A |
| N-13 | Medium | 4.6 No "grid", no jargon | — |
| N-14 | Medium | 3.18 Back goes back | — |
| N-15 | Medium | 2.11 "Where am I?" (the hidden current list) | — |
| N-16 | Medium | 4.1 15px for real | — |
| N-17 | Medium | 4.2 Focus rings and real dialogs | — |
| N-18 | Low | 4.4 Contrast | — |
| N-19 | Medium | 4.2 Focus rings and real dialogs | — |
| N-20 | Medium | 2.9 What to do next | — |
| N-21 | Medium | 2.8 A short tour that matches the app | — |
| N-22 | Medium | 2.14 Help, the palette and the shortcut list are true | — |
| N-23 | Low | 3.16 Tasks page | — |
| N-24 | Low | 3.10 Dashboard: what's due comes first | — |
| N-25 | Low | 4.7 Platform-aware, grammatical text | — |
| N-26 | Medium | 5.6 Sidebar groups, one templates library, one home for printouts | G |
| N-27 | Medium | 5.5 Settings in about 7 tabs; 5.7 One "Views" menu | G |
| N-28 | Low | 2.15 Human error messages | — |
| N-29 | Low | 3.18 Back goes back | — |
| N-30 | Low | 1.2 Drafts stay with their own record; 3.18 Back goes back | — |
| N-31 | Low | 3.18 Back goes back | — |
| L-01 | High | 1.9 Undo that reports success when it failed | — |
| L-02 | High | 1.7 Deleting a deadline rule floods every reminder with false "overdue" | — |
| L-03 | High | 1.26 Checklist "Repeat" stops pretending | A |
| L-04 | High | 1.22 Date a note, and "Done", by when it happened | B |
| L-05 | High | 1.23 Voiding or undoing a note puts its dates back | — |
| L-06 | High | 1.3 "Remove sample data" keeps the user's own work | C |
| L-07 | High | 1.24 A record opens from anywhere | — |
| L-08 | High | 1.9 Undo that reports success when it failed | — |
| L-09 | Medium | 1.9 Undo that reports success when it failed; 5.2 Deleted lists and columns go to Trash | D |
| L-10 | Medium | 1.8 Show what depends on a thing before deleting it | — |
| L-11 | Medium | 1.11 Moving a record to another list loses data | D |
| L-12 | Medium | 1.13 Archived means archived | — |
| L-13 | Medium | 1.12 Deleted lists: honest wording, and hidden everywhere; 5.2 Deleted lists and columns go to Trash | D |
| L-14 | Medium | 1.13 Archived means archived | — |
| L-15 | Medium | 1.8 Show what depends on a thing before deleting it | — |
| L-16 | Medium | 1.10 The undo stack behaves predictably | — |
| L-17 | Medium | 1.10 The undo stack behaves predictably | — |
| L-18 | Medium | 1.2 Drafts stay with their own record | — |
| L-19 | Medium | 5.8 Merge the two broken duplicates in the data model | H |
| L-20 | Medium | 2.15 Human error messages | — |
| L-21 | Medium | 1.28 Import brings in the right data | — |
| L-22 | Medium | 1.16 Grid edits that quietly corrupt data | — |
| L-23 | Medium | 1.23 Voiding or undoing a note puts its dates back | — |
| L-24 | Medium | 1.9 Undo that reports success when it failed | — |
| L-25 | Low | 5.3 "Done" for one-off dates | B, E |
| L-26 | Low | 1.27 Tasks keep their data and their schedule | — |
| L-27 | Low | 1.27 Tasks keep their data and their schedule | — |
| L-28 | Low | 1.30 Never fail silently; 3.17 Checklist ticks don't clutter the log | — |
| L-29 | Low | 1.34 Dates, sorting and timestamps | — |
| L-30 | Low | Deferred | — |
| L-31 | Medium | 5.1 One kind of to-do | A |
| L-32 | Medium | 5.4 Who a rule belongs to; contact rules | F |
| L-33 | Low | Deferred | H |
| L-34 | Low | Deferred | H |
| L-35 | Low | 5.6 Sidebar groups, one templates library, one home for printouts | G |
