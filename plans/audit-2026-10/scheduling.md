# Audit: scheduling and workflow (calendar, appointments, tasks, checklists, requirements, stages)

Reviewer area prefix: **S**. Read-only review of code plus screenshots in `test-results/audit-tour/` and `plans/website/screenshots/*/04-calendar.png`. (`test-results/ui-tour/current/` does not exist on disk, so the 13/17/32 screens weren't available. `audit-tour/09-board-jobs.png` is mislabeled: it shows the Dashboard (Today card and Stages card), not the board.)

## Top 5

1. **Make "Repeat" on checklists either work or go away** (S-01). Today a repeating checklist item or a "Recurring every N days" template stores the setting and never acts on it.
2. **Let people date a note when the contact really happened** (S-02). Requirements count notes by the day they were typed, so a visit written up two days late counts in the wrong month.
3. **Fix "This and following" so it keeps the series' end** (S-03). Editing session 4 of a "10 sessions" series quietly turns it into about two years of weekly appointments.
4. **Merge tasks, checklist items and follow-ups into one kind of to-do that can belong to a record** (S-04), with one place that lists everything due. This is the biggest clarity win. The detailed fixes are S-05, S-06, S-12 and S-13.
5. **Stop showing archived records' appointments, and list past appointments that still need an outcome** (S-07, S-09). Discharged people keep their weekly series and reminders. Past appointments nobody marked fall out of sight, and their notes never get written.

## Findings

### S-01 · Repeat settings on checklists do nothing · High · logic
- **Where:** `src/renderer/components/profile/ChecklistAddDialog.tsx:137-170` and `ChecklistItem.tsx:151` (the item "Repeat" dropdown). The rule is saved by `src/main/ipc/ipc-checklists.ts:37-39,53-56`, but nothing reads it when an item is completed (`ipc-checklists.ts:44-90`, `Checklist.tsx:165-215`). For templates, the "Repeating template (for recurring workflows)" toggle is at `Checklist.tsx:1136-1160` and `ChecklistTemplateEditor.tsx:375-393`. `is_recurring` and `recurrence_days` are only stored, shown (`ChecklistTemplateRow.tsx:38-41`) and exported. `applyChecklistTemplate` (`src/main/checklist-apply.ts`) ignores them. Screenshot: `audit-tour/39-checklist-templates.png`, which says "Optionally set them to recur on a schedule" and has a "Recurring" column.
- **What the user experiences:** They set "Monthly home safety check" to repeat monthly and tick it off. It never comes back and its due date never moves. A template marked "Every 30 days" never resets on its own. The only reset is the manual "Reset cycle" button.
- **Why it matters:** People trust the app to bring recurring work back, so a quiet no-op becomes a missed visit or review.
- **Fix:** Short term, hide both repeat controls (and the "Recurring" column) until they work. Proper fix: when a repeating item is completed, log the completion and reopen it with the next due date, the way `TASK_COMPLETE` does for tasks (`ipc-tasks.ts:110-152`). For templates, "every N days" should either reset the cycle when N days have passed since it was applied, or be dropped in favour of item-level repeats.
- **Effort:** M

### S-02 · Contacts count by the day the note was typed, not the day the contact happened · High · logic
- **Where:** `src/main/ipc/ipc-caselog.ts:56-60` (`created_at` is always `datetime('now')`; there is no date parameter). `src/main/contact-requirements.ts:90-97` counts by `date(cl.created_at,'localtime')`. Compare `src/main/appointments.ts:364-371,414-416`: appointment notes are backdated to the appointment time.
- **What the user experiences:** A visit on Oct 31 is written up Nov 2. October shows "0 of 1 ✓ missing" and November gets credit it doesn't need. They can't fix this, because no date field exists on a note. The same visit counts in the right month if they first schedule it as an appointment and mark it done.
- **Why it matters:** Monthly contact requirements are often billing or compliance rules, and late documentation is normal for social workers. The month-end report will be wrong.
- **Fix:** Add an optional "When did this happen?" date (defaulting to today) to the note form. Store it in `created_at` or a new `occurred_at`, and count requirements and note-driven dates (`applyNoteDateUpdates`) by it. Show "(written Nov 2)" on backdated notes for audit honesty.
- **Effort:** M

### S-03 · "This and following" turns a fixed-length series into an open-ended one · High · bug
- **Where:** `src/main/appointments.ts:299-309`, where `delete r.count` runs on the new series' rule while `until` stays. Also `endSeriesBefore` at lines 250-258.
- **What the user experiences:** They schedule "Every week, 10 times" (an authorization). At session 4 they change the time with "This and following". The new series has no end, so weekly appointments now fill the calendar for two years (`MAX_HORIZON_MONTHS`), each with reminders.
- **Why it matters:** This silently creates around 100 appointments the person never asked for.
- **Fix:** When splitting, set the new rule's `count` to what remains: the original count minus the occurrences before the split date (the count of `seriesDates` before `from`). If none remain, don't create a new series.
- **Effort:** S

### S-04 · Five overlapping "things to do" with no guidance on which to use · High · usability
- **Where:** Tasks (`TasksView.tsx`, `ipc-tasks.ts`) have priority, due date, repeat, snooze, groups and templates, but no record. Checklist items (`Checklist.tsx`) have priority, due date, a non-working repeat, groups and templates, and they live on a record. Follow-ups are a date on a note (`case_log.follow_up_date`). Appointments have a time and a record, and marking one done writes a note. Deadlines are date columns plus rules. On top of these, "Templates" on the Tasks page (`TasksView.tsx:463-469,808-841`) turns a checklist template into tasks with no record. The help (`faqData.tsx`) explains each one separately and never says when to pick which.
- **What the user experiences:** "Call Mrs. Lee's pharmacy Friday" could be a task (but then it isn't attached to Mrs. Lee), a checklist item on her record (but then it doesn't appear on the Tasks page or calendar unless it's Urgent; see S-06), or a follow-up on a note (which appears on the calendar but not on the Tasks page). Each lands somewhere different and has its own repeat, priority and grouping controls. Snooze exists only for tasks.
- **Why it matters:** "One obvious way to do each thing." People will put the same work in different places and miss some of it.
- **Fix (proposed model, no capability lost):**
  - **To-do**: one kind of item, optionally tied to a record (and optionally to a note, which replaces "follow-up"), with a due date, repeat, priority and snooze. A record's checklist is that record's to-dos. The Tasks page becomes "To-dos", with sections for "Not about anyone" and each record's items that are due. A checklist template becomes a to-do template, applied to a record or to nobody, with optional "due N days after applied".
  - **Appointment**: something at a time, usually with a record; when it's done, a note is written.
  - **Deadline**: a date Pulse works out from a column and rule. Never typed in by hand as a to-do.
  - **Requirement**: a count of notes per period. It doesn't create items, but it can show what's planned (S-27).
  - Power users keep groups, priorities, templates and stage on-enter actions; only the storage and lists merge.
  - Interim steps: add a "For (record)" picker to tasks, show due checklist items on the Tasks page and calendar (S-06), and add a Help topic, "Task, checklist, follow-up or appointment?".
- **Effort:** L (interim steps M)

### S-05 · The two task dialogs disagree, and editing wipes fields · Medium · bug
- **Where:** `src/renderer/components/shared/GlobalTaskDialog.tsx:56-72` (Ctrl+Shift+T from anywhere) sets `grid_id` and `category`. `src/renderer/views/tasks/TaskFormDialog.tsx:36-52` (Add/Edit on the Tasks page) has neither, and always sends `grid_id: null, category: null, snoozed_until: null, is_completed: 0`. Through `TasksView.tsx:190-193` that becomes `TASK_UPDATE` with all of those fields.
- **What the user experiences:** A quick-added task tied to a list, with a category, loses both the first time it's edited. Editing a snoozed task (from the Snoozed section) un-snoozes it without saying so. The two dialogs also look different ("Quick Add Task" vs "Add Task") and offer different fields (list and category vs group).
- **Why it matters:** Silent data loss, and the same thing behaves two ways.
- **Fix:** Use one dialog component for both. On edit, send only the fields the form changed (a diff against `initial`).
- **Effort:** S

### S-06 · Checklist items with due dates are invisible on the Tasks page and calendar · Medium · usability
- **Where:** `TasksView.tsx:527-534` shows only `priority = 'urgent'` checklist items (`ipc-checklists.ts:115-134`). `src/main/calendar.ts` has deadlines, follow-ups and tasks but no checklist items. The dashboard's "Items Due Today" (`DashboardView.tsx:490-497`) counts checklist items and tasks, then links to `/tasks`.
- **What the user experiences:** The dashboard says "Items Due Today: 3". They click through and see one task, because the two Normal-priority checklist items due today are only on two different profiles. The calendar never shows them.
- **Why it matters:** Due work has to be visible wherever "what's due" is shown.
- **Fix:** On the Tasks page, show a "{Record} checklists due" section (due today, overdue, this week) next to the urgent section. Add a "Checklist" layer, or fold it into "Tasks", in `calendarItems`.
- **Effort:** M

### S-07 · Archived (discharged) records keep their appointments, series and reminders · Medium · logic
- **Where:** `src/main/appointments.ts:42-60` (`listAppointments` filters only `r.deleted_at`, and doesn't check `r.is_active` or `g.is_active`), plus `appointmentsToday` (429-433), `reminders.ts:139-149` and `export-ics.ts:100-104`. Archiving (`ipc-row.ts:366-381`, and bulk archive at 240-247) doesn't touch appointments. Compare follow-ups in `calendar.ts:17-21`, which require `r.is_active = 1` and `g.is_active = 1`.
- **What the user experiences:** A client is discharged and archived. Their "every Tuesday 10am" series keeps appearing on the calendar and in the Today card, and keeps triggering notifications, for up to two years.
- **Why it matters:** Calendar clutter, wrong daily counts, and a reminder about someone they no longer serve.
- **Fix:** When a record is archived, offer "Also cancel its N upcoming {appointment:many}?" (ending the series the way "This and following" delete does), with undo. Also filter `is_active` and `g.is_active` everywhere upcoming appointments are read.
- **Effort:** M

### S-08 · Month view overlaps the next week, hiding the 3rd item and "+N more" · Medium · bug
- **Where:** `CalendarView.tsx:247-252`. The grid rows are `minmax(0,1fr)` while each row has `min-h-[7rem]`, so a row taller than its track spills over the next one. Screenshot `audit-tour/20-calendar-month.png`: Monday 5 and Monday 12 show a third item cut off under the next week's dates.
- **What the user experiences:** A day with three items shows two and a sliver. The "+2 more" link can be covered completely, so items look missing.
- **Why it matters:** Deadlines go unseen.
- **Fix:** Use `grid-rows-[auto_repeat(6,minmax(7rem,1fr))]`, so the grid scrolls instead of overlapping. Or calculate how many items fit and show "+N more" from that.
- **Effort:** S

### S-09 · Past appointments with no outcome fall out of sight · Medium · usability
- **Where:** Nothing queries `status='scheduled' AND start_at < today` (grep: `export-planner.ts`, `reminders.ts`, `export-ics.ts`, `placeholders.ts`, `appointments.ts` all look forward). The Today card (`dashboard/cards/TodayCard.tsx`) shows only today. The profile lists them under "Earlier" (`RecordAppointments.tsx:40-45`).
- **What the user experiences:** They forget to press Done on Tuesday's visit. By Wednesday nothing reminds them, no note exists, and the requirement shows it as missed.
- **Why it matters:** Marking an appointment done is what writes the note and counts the contact.
- **Fix:** Add a "Needs an outcome" strip to the Today card and the morning briefing, listing scheduled appointments from the last 14 days, each with Done, No-show and Cancelled.
- **Effort:** S

### S-10 · Moving a multi-day weekly series with "This and following" can make the moved appointment vanish · Medium · bug
- **Where:** `appointments.ts:299-309`. `endSeriesBefore` deletes the occurrence being edited. The new series copies the old `byDay` (for example Tue and Thu), so a new first date on a Wednesday isn't produced (`seriesDates` skips days not in `byDay`).
- **What the user experiences:** In a Tue/Thu series they drag Tuesday to Wednesday and choose "This and following". The Wednesday appointment isn't there, the next one is Thursday, and the pattern is still Tue/Thu.
- **Why it matters:** The thing they just moved disappears.
- **Fix:** When the day of the week changes, shift `byDay` by the same number of days. At minimum, always include the new first date as an occurrence.
- **Effort:** S

### S-11 · Dragging a repeating appointment to another day offers "All", which then fails · Medium · usability
- **Where:** `CalendarView.tsx:158-161,291-294`, `ScopeDialog.tsx:30`, and `appointments.ts:279` ("To move the dates of a series, choose 'This and following'").
- **What the user experiences:** They drag the weekly session from Tue to Wed and pick "All". An error toast appears and nothing moves.
- **Why it matters:** The app offered a choice it then refuses.
- **Fix:** Pass `dateChanged` to `ScopeDialog` and leave out "All" (or explain it) when the day changes. Better: implement "All" as shifting every future occurrence, and `byDay`, by the same number of days.
- **Effort:** S

### S-12 · Recurring task with no due date stops repeating; late completion cascades overdue · Medium · logic
- **Where:** `ipc-tasks.ts:110-152`. If there's no `due_date`, then `nextDate` is null and the task is marked complete for good. The next date is the old due date plus the interval, not counted from completion. `TaskFormDialog.tsx` allows Repeat without a due date, and `TaskItem.tsx:117-123` can clear the date on a repeating task.
- **What the user experiences:** (a) "Weekly: submit timesheet" with no date is ticked once and is gone forever. (b) A weekly task three weeks late, once ticked, comes back still two weeks overdue.
- **Why it matters:** The repeat breaks silently, and the overdue counts look wrong.
- **Fix:** Require a due date when Repeat is set (default today), or start the cycle from the completion date. Roll the next date forward until it's on or after today, or offer "Next one: from the due date / from when I finish it".
- **Effort:** S

### S-13 · Snooze "1 day" hides a task for two days on the Tasks page, but not elsewhere · Medium · bug
- **Where:** `views/tasks/taskHelpers.ts:26-29` (`snoozed_until >= today` counts as snoozed) vs `ipc-tasks.ts:38` (`snoozed_until <= today` counts as due again). The help (`faqData.tsx:369`) says "hidden until the snooze date, then reappear as due".
- **What the user experiences:** They snooze until tomorrow. Tomorrow the dashboard and briefing show it as due, but on the Tasks page it's still collapsed under "Snoozed" until the day after.
- **Why it matters:** Two screens disagree about the same task.
- **Fix:** Make `isSnoozed` use `snoozed_until > today`. Show dates as "Tomorrow (Sun, Oct 11)" instead of "(2026-10-11)" in `SnoozeDialog.tsx:27`.
- **Effort:** S

### S-14 · Newest tasks drop off the list after about 500 tasks · Medium · bug
- **Where:** `ipc-tasks.ts:22-25`: `ORDER BY position ASC ... LIMIT 500`, with completed tasks included. New tasks get `MAX(position)+1` (line 59), so they sort last.
- **What the user experiences:** After about a year of daily use without "Clear All", newly added tasks don't appear on the Tasks page, although they still show on the calendar and dashboard.
- **Why it matters:** Silent loss of visibility for heavy users.
- **Fix:** `ORDER BY is_completed, position`, and limit completed tasks separately (for example the most recent 200).
- **Effort:** S

### S-15 · Re-entering a stage adds its checklist again and overwrites its date · Medium · logic
- **Where:** `src/main/stages.ts:118-125`. `applyChecklistTemplate` runs on every entry and doesn't check for existing items. `setCellWithHistory` overwrites the stamp column every time. The settings label at `StageSettingsDialog.tsx:126-135` doesn't warn about either.
- **What the user experiences:** A job goes Approved, back to Estimate sent, then Approved again. It now has two copies of "Job site safety", and "Approved on" shows the second date, so the original is lost. The same happens with "Intake date" when a client bounces between stages.
- **Why it matters:** Duplicate to-dos and overwritten history.
- **Fix:** Skip template items whose `template_source_id` already has open items on the record. Add a per-stage "Only fill in the date if it's empty" choice, defaulting to on, and say in the dialog what happens on re-entry.
- **Effort:** S

### S-16 · Undoing a stage move resets "time in stage" and writes another change note · Medium · logic
- **Where:** `src/renderer/utils/stageMove.ts:43-47`. Undo calls `grid.updateCell(previous)`, which (because `isUndoing` is set) goes through plain `CELL_UPDATE` (`ipc-cell.ts:103-140`). That adds a new `cell_history` row and a new "X changed to Y" system note. `stageDurations` (`stages.ts:161-177`) then counts the current stay from the undo.
- **What the user experiences:** A record has waited 40 days in "Waiting". It's dragged to "Ready" by mistake and Ctrl+Z is pressed. The board and the dashboard's "Waiting longest" now say 0 days, and the activity log shows two stage-change entries. The help says "One Undo puts it all back" (`faqData.tsx:597`).
- **Why it matters:** Time-in-stage is the reason to have stages, and one slip wipes it.
- **Fix:** Add a `STAGE_UNDO` that restores the cell and deletes the history rows and notes the move created (their ids are already returned in `StageMoveResult`), instead of writing a new change.
- **Effort:** M

### S-17 · Repeating series quietly stop after two years (or 500 times) · Medium · logic
- **Where:** `src/shared/appointments.ts:91-94,142-144` and `appointments.ts:160`. The horizon is `first + 24 months`, not a rolling window. `describeRule` (shared/appointments.ts:193) is never used in the UI. `AppointmentPanel.tsx:46` only says "· repeats".
- **What the user experiences:** A weekly therapy client is in their third year and the appointments just aren't on the calendar any more. Nothing ever showed the pattern or its end.
- **Why it matters:** Long-term clients are normal in these fields.
- **Fix:** Make the horizon rolling (today + 24 months, materialized as time passes). In the panel and profile, show the rule, for example "Every week on Tue · until Mar 3, 2027" using `describeRule`. If a real cap is needed, warn when it's set.
- **Effort:** S

### S-18 · A series' pattern and end can't be changed after it's made · Medium · usability
- **Where:** `AppointmentDialog.tsx:203` (the Repeats fieldset is shown only when `!a`).
- **What the user experiences:** An authorization ends early, or sessions go from weekly to every two weeks. Their only route is to find the right occurrence and choose Delete, then "This and following", then make a new series.
- **Why it matters:** A common change takes three hard-to-discover steps.
- **Fix:** When editing a series occurrence, show the Repeats section with the current rule. Changing it implies "This and following" (or "All" when editing the first one). Add "End this series on…" to the panel.
- **Effort:** M

### S-19 · Status actions differ in each of three places, and "Back to scheduled" leaves moved dates behind · Medium · consistency
- **Where:**
  - The calendar panel (`AppointmentPanel.tsx:52-78`) has Done with a note, No-show, Cancel it, Edit, Delete and Back to scheduled. It allows Done on future appointments.
  - The Today card (`TodayCard.tsx:48-49`) has Done (no note prompt) and No-show.
  - The profile (`RecordAppointments.tsx:40-45`) has Done and No-show only, and only on or before today. Clicking an appointment there opens Edit, with no Delete or Cancel.
  - "Back to scheduled" voids the note but doesn't put back dates the note moved (`appointments.ts:393-397`). Only Undo does that (`appointmentActions.ts:58-62`).
- **What the user experiences:** They can't cancel or delete an appointment from the person's page. Marking something done in one place asks for a note and in another doesn't. They undo a mistaken Done with "Back to scheduled" and "Last visit" still shows the wrong date.
- **Why it matters:** Inconsistency and a quiet data error.
- **Fix:** Use one shared actions component (Done…, No-show, Cancelled, Edit, Delete) everywhere, with the note prompt optional through a setting. Return and revert `updatedDates` when leaving "done", and record them on the appointment row. Ask "This hasn't happened yet. Mark it done anyway?" for future appointments.
- **Effort:** M

### S-20 · Task list ignores priority and due date; the help says otherwise · Low · usability
- **Where:** `TasksView.tsx:337-340` sorts by manual position only (the store has `sortMode` but no UI). The help (`faqData.tsx:375`) says "Urgent tasks always appear at the top" and calls Normal priority "Medium".
- **What the user experiences:** The header says "3 overdue", but those tasks are scattered through the list.
- **Fix:** Add a Sort menu with "My order", "Due date" and "Priority". Or pin overdue tasks to an "Overdue" section at the top. Fix the help text.
- **Effort:** S

### S-21 · Tasks page shows two "No tasks yet" empty states · Low · bug
- **Where:** `TasksView.tsx:505-525`, where both blocks render under the same condition. Screenshot `audit-tour/24-tasks.png`.
- **Fix:** Delete the first block.
- **Effort:** S

### S-22 · "Clear All" completed tasks says it can't be undone (it can, one by one) · Low · wording
- **Where:** `TasksView.tsx:798-806`. Each `deleteTask` pushes its own undo entry (`taskStore.ts:99-121`).
- **Fix:** Delete them all as one undo step (like `Checklist.tsx` doClearCompleted) and say "You can undo this". Rename the button "Delete completed".
- **Effort:** S

### S-23 · Checklist ticks and undos clutter the activity log · Low · logic
- **Where:** `ipc-checklists.ts:69-82` writes a system note on every completion and every reopen. An undo of a tick writes a new "Reopened…" note (`Checklist.tsx:203-210`). Undoing "Reset cycle" (`Checklist.tsx:345-350`) writes one "Completed…" note per item.
- **Fix:** Have undo restore the state without logging, by passing `{ silent: true }` or using `CHECKLIST_RESTORE_ITEM`. Void the original note instead of adding an opposite one.
- **Effort:** S

### S-24 · Two separate checklist template editors · Low · consistency
- **Where:** `src/renderer/components/profile/Checklist.tsx:833-1285` (`TemplateManager`, used on the profile and Tasks page) and `ChecklistTemplateEditor.tsx` (the Templates page). They duplicate the same fields and the same non-working recurring toggle.
- **Fix:** Keep one editor. The profile and Tasks pickers open it.
- **Effort:** M

### S-25 · A stage column hidden from the table skips on-enter actions when edited from the profile · Low · bug
- **Where:** `gridStore.ts:507-515` looks the column up only in `get().columns` (visible columns). `ProfileView.tsx:533-538` passes `[...columns, ...hiddenColumns]` to `GridDataSummary`, which saves through `updateCell`.
- **What the user experiences:** The stage column is hidden in the table and changed on the profile. No checklist is added, no date is filled in and no stage note is written.
- **Fix:** Look the column up in `columns.concat(hiddenColumns)` (the same goes for the read-only check above it).
- **Effort:** S

### S-26 · Board wording and hidden cards · Low · wording/usability
- **Where:** `StageSettingsDialog.tsx:150-154` ("hide done … after [0] days", where 0 means *never*, per `boardLanes.ts:83`). `BoardView.tsx:318-321` ("N older … hidden" with no way to see them).
- **Fix:** Use a checkbox, "Hide finished {record:many} after [14] days", and unchecking it turns hiding off. Make the "hidden" line a button that shows them.
- **Effort:** S

### S-27 · Requirements don't show what's already planned or how long is left · Low · usability
- **Where:** `ContactStatusLine.tsx:31-40` shows "Visit 0 of 1 this month". `daysLeft` exists in `periods.ts:72-77` but isn't shown, and scheduled appointments aren't counted as planned.
- **Fix:** Show "Visit 0 of 1 this month · 1 scheduled Oct 28 · 18 days left". Give the dashboard a "not met and nothing scheduled" filter.
- **Effort:** M

### S-28 · Calendar wording and look · Low · wording/usability
- **Where:**
  - "When it's done, log it as: The usual kind (a visit)" (`AppointmentDialog.tsx:194`), which shows on a tree service (`audit-tour/21-appointment-new.png`). `noteTypeFor` (`appointments.ts:373-377`) actually falls back to the first note type when there's no "visit".
  - The panel has both "Cancel it" (cancel the appointment) and "Cancel" (close the note box) (`AppointmentPanel.tsx:63,58`).
  - Done, no-show and cancelled all use the same grey strikethrough (`CalendarView.tsx:37-42`).
  - The layer chips have no visible "Show:" label (`CalendarView.tsx:224`).
  - Follow-ups read only "Name: follow-up" (`CalendarView.tsx:69`).
  - Clicking a task goes to the Tasks page, not to the task (line 164).
- **Fix:**
  - Name the real default type ("Usual: {first note type}").
  - Rename "Cancel it" to "Mark cancelled".
  - Show done with a check and no strikethrough, and keep strikethrough for cancelled and no-show.
  - Add a visible "Show:" label.
  - Show the first words of the follow-up note.
  - Open the task's edit dialog.
- **Effort:** S

### S-29 · Week view hides who an appointment is with · Low · usability
- **Where:** `TimeGrid.tsx:174` (one truncated line). Screenshot `website/screenshots/therapy-practice/04-calendar.png`: "11:00 am Sessio…".
- **Fix:** For events 44px or taller, use two lines: the time and title, then the record's name. The full text is already in `title`.
- **Effort:** S

### S-30 · .ics export: semicolons not escaped; cancelled appointments stay in Outlook; not reachable from the calendar · Low · bug/usability
- **Where:**
  - `export-ics.ts:44`: `'\;'` in JS is just `';'`, so `;` isn't escaped as RFC 5545 requires (it should be `'\\;'`).
  - Lines 100-104 export only scheduled appointments, so re-importing never removes cancelled or deleted ones (UIDs are stable, but no `STATUS:CANCELLED` is sent).
  - The export lives in Reports and Dashboard ("Add to calendar"), not on the Calendar page.
  - `X-WR-CALNAME:Pulse deadlines` (line 129) even when the file holds appointments.
- **Fix:**
  - Escape properly.
  - Include appointments cancelled or deleted in the window as `STATUS:CANCELLED`, which needs remembering deleted UIDs for 30 days.
  - Add an "Add to my calendar…" button on the Calendar toolbar.
  - Name the calendar "Pulse".
- **Effort:** S–M

### S-31 · Undoing a new repeating series can leave far-future copies · Low · bug
- **Where:** `appointments.ts:197-221` snapshots only the occurrences made at creation. Browsing more than 6 months ahead calls `ensureMaterialized` (line 54), which adds more. `restoreAppointments` (89-111) then deletes the listed ids and the series, and `ON DELETE SET NULL` (`040_appointments.ts:25`) leaves the extra ones as standalone appointments. *Suspected, related:* `INSERT OR REPLACE INTO appointment_series` (line 94) deletes and re-inserts the parent row, which may null `series_id` on occurrences not in the snapshot.
- **Fix:** In restore, delete appointments whose `series_id` is in `createdSeriesIds` before deleting the series. Use `UPDATE … / INSERT OR IGNORE` instead of `REPLACE` for series rows.
- **Effort:** S

### S-32 · Calendar can't be narrowed to one list or one person · Low · usability
- **Where:** `listAppointments` supports `gridId` and `rowId` filters (`appointments.ts:49-59`), but `CalendarView.tsx` never offers them. `calendarItems` has no filter at all.
- **What the user experiences:** Someone with "Clients" and "Staff credentials" lists sees everything mixed together, and the tree service sees crew training among jobs (`audit-tour/20-calendar-month.png`).
- **Fix:** Add a "List: All ▾" picker beside the layer chips, remembered like `calendar_layers`, and pass it to both calls.
- **Effort:** S

## Things that work well
- **Appointment undo:** every change returns a snapshot, so create, edit, delete and status changes each undo as one step (`appointments.ts:32-111`, `appointmentActions.ts`).
- **Series storage:** occurrences are real rows with `series_date` and `exdates`, so moved or deleted dates never come back. The scope dialog wording ("Only this one / This and following / All", with hints) is plain and clear.
- **Times and dates:**
  - Wall times are stored without a zone and the date math is local, so `minutesBetween` and `addMinutes` are DST-safe.
  - Appointment notes are dated at the appointment time and capped at now (`noteTimestamp`).
  - Requirement counting uses `date(created_at,'localtime')`, and periods respect the week-start setting.
  - Monthly-on-the-31st lands on the last day of shorter months.
- **Privacy in reminders and exports:** reminders show initials by default, keep nothing on disk while locked, and remember sent reminders by time. The .ics export uses initials by default, leaves out note text, uses stable UIDs and floating local times.
- **Stage moves:** a stage move is a single transaction returning everything it touched. Stage settings validate that templates, columns and note types still exist, with human error messages.
- **Calendar:** keyboard shortcuts (T, N, M, W, D, A, arrows and Enter), a minimum 44px event height, 15-minute snapping, side-by-side lanes for overlaps, and the remembered layers and view mode.
- **Deleted records:** records in the trash drop out of the calendar, reminders and exports. A purged record's series cleans itself up (`materialize`, lines 153-159).
