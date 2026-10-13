# Calendar: choose what shows, and add deadlines from it

## What exists today
- The Calendar's filter chips are Appointments, Deadlines, Follow-ups and Tasks, plus a list picker. All of them are remembered.
- "Deadlines" is all-or-nothing: every date column with a rule, on every record, shows up.
- The calendar can create only appointments: the "New appointment" button and clicking a time.

## Part 1: choose what shows
1. **Pick deadline columns.** Next to the Deadlines chip, a "Which deadlines…" menu lists each deadline column, grouped by list, with a checkbox for each (e.g. show "Last Care Plan Review", hide "Last Phone Contact"). The choice is remembered in settings (`calendar_deadline_columns`). Columns added later show by default.
2. **How soon.** A filter for All / Overdue and due within 30 days / Overdue only, so the month view isn't flooded with deadlines that are far off.
3. **Per column, from the column itself.** The column's ⋯ menu gets a "Show on the Calendar" switch, which writes the same setting as option 1, so it can be turned off from the list as well.
4. **Plain date columns** (no rule, e.g. "Court date") can be opted in to the Calendar with the same switch. They're off by default.

The filtering happens in main, in `calendar:items`, so the counts and the "N more" day overflow stay right. Existing settings carry over: with nothing chosen yet, everything shows, as today.

## Part 2: add from the Calendar
Clicking an empty day, or a "New…" button, opens a small chooser:
- **Appointment.** The existing dialog.
- **Deadline for a record.** Pick a record and one of its deadline columns, and the date goes into that column. This needs a decision on interval rules (see Question 2).
- **Event.** A plain calendar event like an Outlook one: title, time or all-day, location, notes, repeat. It isn't tied to any record. It reuses the appointment dialog with no record (the database already allows `row_id` to be null), with the record field shown as optional.
- **Task** due that day. It reuses the task dialog.

Follow-ups stay attached to notes, as now.

## Decisions (owner, 2026-10-12)
- Filtering: pick deadline columns (Part 1, items 1 and 3). The how-soon filter, plain date columns and record/status filters are not wanted now.
- Creating a deadline: the clicked day is when it's due. Pulse works out the stored date from the rule. Rule kinds that can't be worked backwards (quota, meter, sequence) are shown but disabled, with a plain reason.

- Standalone events (added 2026-10-12): appointments with no record get their own "Events" chip on the Calendar, separate from record appointments, and they're available even when the Appointments feature is switched off. They're drawn without the record-name prefix, and clicking one opens it for editing, not a profile. Reminders, repeats and the .ics export work the same as for appointments.

## Testing
- Main: the item filter, setting validation, old settings carrying over, working back from a due date for each rule kind.
- Renderer: the menu, the switches, the chooser.
- Vocabulary words throughout. Plus a screenshot pass.
