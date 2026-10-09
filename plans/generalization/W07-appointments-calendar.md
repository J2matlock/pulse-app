# W07. Appointments and the calendar view

Size: L (9 days). Phase: P4. Depends on W03 (activity types), W05 (deadlines layer).

## 1. User stories
1. *As a therapist*, I schedule a client every Tuesday at 3 pm until the authorization ends, and see my week at a glance.
2. *As a shop owner*, I book drop-offs and see today's in order on the dashboard.
3. *As a caseworker*, my visits are on the calendar next to deadlines and follow-ups.
4. *As anyone*, when an appointment happens I mark it done, and the note it creates counts toward requirements and visit limits.
5. *As anyone*, I can put appointments in Outlook or Google via the calendar file, and print a day sheet.

## 2. Data (migration 040)
```sql
CREATE TABLE IF NOT EXISTS appointment_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule TEXT NOT NULL,              -- JSON: { freq: 'daily'|'weekly'|'monthly', interval: 1..12, byDay?: number[], until?: 'YYYY-MM-DD', count?: number }
  template TEXT NOT NULL,          -- JSON: title, duration_min, location, activity_type_key, row_id
  materialized_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER REFERENCES rows(id) ON DELETE CASCADE,          -- NULL = not about a record (staff meeting)
  series_id INTEGER REFERENCES appointment_series(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,           -- local wall time 'YYYY-MM-DDTHH:MM' (or 'YYYY-MM-DD' when all_day)
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  activity_type_key TEXT,           -- becomes this kind of note when done
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled','no_show')),
  case_log_id INTEGER REFERENCES case_log(id) ON DELETE SET NULL,  -- the note created when done
  notes TEXT,
  is_exception INTEGER NOT NULL DEFAULT 0,                         -- edited occurrence of a series
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appt_row ON appointments(row_id, start_at);
```
**Why local wall time with no zone:** one user in one place. Pulse never syncs times with other systems except the .ics export, which writes floating local times. This avoids every DST bug of UTC round trips.

## 3. Recurring series
- **Materialized:** occurrences are real rows for the next 6 months; `materialized_until` is extended on unlock and when the calendar navigates past it, in a single transaction.
- **Edit/delete scope:** "Only this one" (sets `is_exception`), "This and following" (splits the series: end the old one at the previous occurrence, create a new series from here), "All" (updates future non-exception scheduled occurrences; past and done ones are never changed).
- `until` can be taken from a column ("until the authorization ends": `untilColumnId` in the template; re-materialize when that cell changes).
- **Limits:** 2 years max horizon and 500 occurrences per series.

## 4. Main module: `src/main/appointments.ts`
```ts
listAppointments(range: { from: string; to: string }, filter?: { gridId?: number; rowId?: number; status?: string[] }): Appointment[]
createAppointment(input, series?: SeriesRule): { ids: number[] }
updateAppointment(id, patch, scope: 'one'|'following'|'all'): Change
deleteAppointment(id, scope): Change
setStatus(id, status, opts?: { noteContent?: string; measures?: Measures }): { caseLogId?: number }
ensureMaterialized(until: string): void
```
**`setStatus('done')`:**
1. Creates a case-log entry: type = `activity_type_key` (default `visit`, or the first user type); content = the note text from the done dialog, or "Appointment: {title}"; `source_action_id` = `appt:<id>`; measures from the dialog (minutes default = duration when time tracking is on).
2. Links `case_log_id`.
3. Runs A1 note-date updates.

Undo: delete or void the note, then status back to scheduled.

**No-show / cancelled:** optionally logs an activity of type `no_show` / `cancelled` if those keys exist (therapy starter), so quotas and requirements can treat them as needed.

## 5. IPC
`APPT_LIST`, `APPT_CREATE`, `APPT_UPDATE`, `APPT_DELETE`, `APPT_SET_STATUS`, push `APPOINTMENTS_CHANGED`. Times are validated with regexes; `end_at > start_at`; title ≤ 200 chars; location ≤ 300 chars.

## 6. Calendar view (`/calendar`, sidebar item when `appointments` is on, or always as "Calendar" showing deadlines)
- **Modes:** Month · Week · Day · Agenda (list). The default is Week when appointments are on, else Month.
- **Layers** (toggle chips, remembered):
  - Appointments
  - Deadlines (W05, all-day, colored by state)
  - Follow-ups (note follow-up dates)
  - Tasks
  - Checklist items with due dates
- **Filters:** list(s), activity type, status.
- **Interactions:**
  - Click an empty slot → new appointment (prefilled time).
  - Drag to move or resize (week/day; 15-minute snap). A drag on a series asks the scope.
  - Click an event → side panel: details, record link, Mark done / No-show / Cancel, Edit, Delete.
  - Deadline events open the record with the deadline highlighted.
- **Keyboard:**
  - arrows move the day focus, Enter opens the day, N = new appointment, T = today, M/W/D/A switch modes;
  - every event is focusable in order;
  - screen-reader labels: "Tuesday Oct 6, 3:00 to 3:50 pm, Session with J.S., scheduled".
- **Week start** and **12/24h** follow existing settings (`week_start`, `clock_format`).
- **Accessibility:** 15px text minimum (month cells show "+3 more" rather than shrinking), 44px targets for events in the day/week grid (minimum event height = 44px; short events expand on hover/focus).
- **Built in-house** (CSS grid + date math) to avoid a heavy dependency and CSP trouble; about 600 lines across `views/calendar/*`.

## 7. Elsewhere in the app
- **Profile:** an "Appointments" section with upcoming (next 5) and past (last 5, with status) entries, plus "Schedule…".
- **Dashboard:** a "Today" card listing appointments in order, with quick Done/No-show buttons.
- **Morning briefing:** "4 appointments today, first at 9:00".
- **Weekly planner PDF** (D4): appointments section with times.
- **Calendar export (C1):** appointments as timed events (floating local time `DTSTART:20261006T150000`). Initials rule unchanged for person lists.
- **Document templates (W10):** "Appointment reminder" placeholders `{{appointment.date}}`, `{{appointment.time}}`, `{{appointment.location}}`, for printing or copying. Nothing is sent.
- **Free tier:** appointments are not records; no limit.

## 8. Tests
- Series materialization: weekly, biweekly, monthly on the 31st (clamped), `until` from a column, extension on unlock, DST weeks (wall times stay at 3:00 pm).
- Edit scopes (one, following, all) including exceptions; deleting a series keeps done occurrences.
- Done → note created with type, measures, A1 date update and quota count; undo reverses all.
- No-show logging when the type exists.
- Calendar layer queries for a month in under 100 ms with 2,000 appointments + deadlines.
- Renderer: month/week rendering, drag snap, keyboard navigation, side panel actions.
- ics: timed events and floating times.

## 9. Commits
1. Migration 040 + `appointments.ts` (single appointments) + IPC + tests.
2. Series (materialize, scopes) + tests.
3. Done/no-show/cancel → activities + undo.
4. Calendar view: month + agenda, appointment and deadline layers.
5. Week/day views + drag/resize + keyboard.
6. Profile section, dashboard Today card, briefing line.
7. Planner PDF, ics and document-template placeholders.
