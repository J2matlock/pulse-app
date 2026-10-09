# W05. Deadline engine v2

Size: L (10 days). Phase: P2. Depends on W03 (quota counts activity types). The riskiest refactor in the plan: parity first.

## 1. User stories
1. *As a vocational counselor*, the plan is due 90 days after the **eligibility date** (another column), not after the date in this column.
2. *As a bookkeeper*, estimates are due Apr 15, Jun 15, Sep 15 and Jan 15 for every client, with no date to type in.
3. *As a special-ed coordinator*, evaluations are due in 60 **school days**, skipping weekends and breaks.
4. *As a shop owner*, oil changes are due every 5,000 miles **or** 6 months, whichever comes first, with Pulse estimating the date from odometer readings.
5. *As a therapist*, I'm warned when an authorization has 2 sessions left or ends within 14 days.
6. *As an early-intervention coordinator*, one referral date drives a sequence: 45-day IFSP, then 6-month review, then annual, with each step checked off.
7. *As anyone*, a deadline only applies while the record is Active, and I can grant an extension with a reason that shows in the audit trail.

## 2. Architecture

### 2.1 Today
- **Effective date:** SQL `effectiveDateSql()` (`src/shared/ruleInterval.ts`), used by `ipc-dashboard.ts` (`queryDeadlines`, briefing), `export-planner.ts`, `export-ics.ts`, `compliance.ts` and `export-supervisor.ts`.
- **Renderer** uses `deadlineCalc.ts` (`computeEffectiveDeadline`, `computeDaysUntil`) with `addInterval`.
- **Thresholds** (colors) are JSON on `alert_rules.thresholds`.

### 2.2 New
- **`src/shared/deadlineEngine.ts`:** pure, no DB, used by both processes.
  ```ts
  export type RuleKind = 'interval' | 'relative' | 'calendar' | 'meter' | 'quota' | 'sequence'
  export interface RuleConfig { /* union per kind, see §3 */ }
  export interface EngineRule { id: number; kind: RuleKind; interval: RuleInterval; config: RuleConfig | null; condition: Condition | null; businessDays: boolean }
  export interface RecordContext {
    today: string                                   // YYYY-MM-DD (injected for tests)
    columnDate: string | null                       // value of the column the rule is on
    values: Record<number, string | null>           // other columns referenced (anchor, condition, meter, limit…)
    meterHistory?: Array<{ at: string; value: number }>   // for meter rules (from cell_history)
    activityCount?: number                          // for quota rules (window already applied)
    extension?: { newDue: string; reason: string } | null
    progress?: number[]                             // completed sequence steps
    holidays: Set<string>; weekend: number[]        // business-day calendar
  }
  export interface DeadlineResult {
    due: string | null                // null = nothing due (no date, condition false, quota inactive)
    state: 'none' | 'ok' | 'soon' | 'due' | 'overdue' | 'paused' | 'done'
    daysUntil: number | null
    estimated: boolean                // meter forecasts
    label?: string                    // sequence step label, quota "2 of 12 left"
    detail: string                    // plain-English explanation for tooltips and PDFs
    extended?: { from: string; reason: string }
  }
  export function evaluate(rule: EngineRule, ctx: RecordContext): DeadlineResult
  export function referencedColumns(rule: EngineRule): number[]   // what the loader must fetch
  ```
- **Main loader `src/main/deadlines.ts`:**
  ```ts
  export function loadDeadlines(opts: { gridId?: number; rowIds?: number[]; from?: string; to?: string; limit?: number; today?: string }): DeadlineItem[]
  ```
  1. Load rule-linked columns (one query).
  2. Load the cells for those columns plus referenced columns (one pivot-style query per grid).
  3. Load meter histories for meter columns (one query over `cell_history`).
  4. Load quota counts (one GROUP BY over `case_log` per quota rule window).
  5. Load extensions and progress (two queries).
  6. Evaluate in JS, sort by due, apply the range and limit.

  **Replaces** `queryDeadlines`, the briefing counts, `loadPlannerRows`'s deadline part, `loadIcsItems`'s deadline part, `compliance.ts`'s deadline loop and the supervisor deadline counts.
- **Renderer:** `deadlineCalc.ts` delegates to `evaluate()`. The grid gets each row's context from loaded row data (all columns are already loaded). Meter history and quota counts come from the grid load (W05 adds `GRID_DEADLINE_CONTEXT(gridId)` returning per-row meter series and quota counts, loaded alongside the grid).
- `effectiveDateSql` stays only until parity is proven, then is deleted along with its SQL callers.

## 3. Rule kinds

### 3.1 `interval` (today's rules, unchanged)
`due = addInterval(columnDate, {days, months, endOfMonth})`, or `columnDate` itself when there's no interval.

### 3.2 `relative`
```ts
{ kind: 'relative', anchorColumnId: number | 'self', offset: { days?: number; months?: number; businessDays?: number; direction: 'after' | 'before' } }
```
- **Examples:**
  - "60 days before Lease End": anchor = Lease End, direction before.
  - "90 days after Eligibility Date".
  - "10 school days before the hearing".
- The rule sits on a column. The column's own value, if any, is treated as **completed on** (done). When the done date is ≥ the window start, the state is `done`. This lets "Plan written on" sit next to "Eligibility date".

### 3.3 `calendar`
```ts
{ kind: 'calendar', months: number[] /* 1–12 */, day: number | 'last', fromColumnMonth?: number /* columnId: take month from this date, e.g. registration */ , lead?: number /* days before to start showing */ }
```
- **Due** = the next occurrence of (month, day) on or after the last completion (the column's own date = done date), else from today.
- **Examples:**
  - quarterly estimates `months [1,4,6,9]`, day 15;
  - annual report on the appointment anniversary: `fromColumnMonth` = Appointment Date, day = its day;
  - every March 31.

### 3.4 `meter`
```ts
{ kind: 'meter', readingColumnId: number, lastServiceReadingColumnId: number, every: number, unit: string, timeFallback?: RuleInterval, typicalPerDay?: number }
```
- Due reading = last service reading + `every`.
- **Rate:** least squares over `meterHistory` (the reading column's `cell_history` + current value) in the last 180 days. It needs ≥ 2 points 7+ days apart; else `typicalPerDay` (default from the starter, e.g. 33 mi/day ≈ 12k/yr); else no forecast.
- `dueByMeter = today + (dueReading − currentReading) / rate`; `due = min(dueByMeter, timeFallback from the column date)`; `estimated = true` when the meter decided.
- **detail:** "4,200 mi left (about Mar 3) or by Apr 10, whichever is first".
- **Mark done:** asks "Current reading?" and sets both the column date (today) and the last-service reading.

### 3.5 `quota`
```ts
{ kind: 'quota', activityTypes: string[], limitColumnId?: number, limit?: number, startColumnId: number, endColumnId: number, warnRemaining: number, warnDaysBeforeEnd: number }
```
- `used` = count of non-voided activities of those types with `date(created_at,'localtime')` between start and end (from the loader).
- **State:**
  - `overdue` when used ≥ limit (out of sessions) or today > end;
  - `soon` when remaining ≤ `warnRemaining` or end − today ≤ `warnDaysBeforeEnd`.
- `due` = end date. **label:** "9 of 12 used".
- Appointments (W07) marked done count automatically, since they create activities.

### 3.6 `sequence`
```ts
{ kind: 'sequence', anchorColumnId: number | 'self', steps: Array<{ label: string; offset: { days?: number; months?: number; businessDays?: number } }> , repeatLast?: RuleInterval }
```
- Due = the first step not in `progress`, at anchor + offset.
- `repeatLast`: after the last step, repeat (e.g. annual reviews forever).
- **Mark done** completes the current step (`deadline_progress`) and logs "IFSP meeting done (step 2 of 4)".
- Profile shows all steps with checkmarks.

### 3.7 Common options (all kinds)
- **Condition:**
  ```ts
  { columnId: number; op: 'is' | 'is_not' | 'empty' | 'not_empty'; values?: string[]; whenFalse: 'hide' | 'pause' }
  ```
  e.g. only while Status is Active; `pause` shows "paused" muted.
- **Business days:** `offset.businessDays`, or `businessDays: true` on the rule to roll a due date falling on a weekend or holiday back to the previous business day.
  - **Calendar:** settings `workspace_holidays` (dates array) + `workspace_weekend` (default [0,6]).
  - Settings → Deadlines → "Days off": add dates, add ranges (school breaks), import US federal holidays for a year (computed in code; no network).
- **Thresholds** (colors) unchanged for all kinds.

## 4. Extensions and progress (migration 039)
```sql
ALTER TABLE alert_rules ADD COLUMN kind TEXT NOT NULL DEFAULT 'interval';     -- guarded
ALTER TABLE alert_rules ADD COLUMN rule_config TEXT DEFAULT NULL;             -- guarded, JSON validated by zod
ALTER TABLE alert_rules ADD COLUMN rule_condition TEXT DEFAULT NULL;          -- guarded, JSON
ALTER TABLE alert_rules ADD COLUMN business_days INTEGER NOT NULL DEFAULT 0;  -- guarded
CREATE TABLE IF NOT EXISTS deadline_extensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
  column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  step INTEGER,                                 -- sequence step, else NULL
  original_due TEXT NOT NULL, new_due TEXT NOT NULL, reason TEXT NOT NULL,
  anchor_value TEXT,                            -- the column/anchor value it applied to; a new value voids it
  created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS deadline_progress (
  row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
  column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  step INTEGER NOT NULL, done_at TEXT NOT NULL, anchor_value TEXT,
  PRIMARY KEY (row_id, column_id, step)
);
```
**Extend:**
- From a dashboard row menu, the profile deadline panel or the grid cell menu: "Extend…" → new date + reason (required).
- Logged as a system activity "Annual review extended to Apr 2 (was Mar 3): waiting on doctor's report".
- Appears in the audit trail and the requirements summary ("3 extended").
- **Revoke:** "Remove extension", also logged.
- An extension stops applying when the anchor value changes (a new cycle).

## 5. IPC
| Channel | Purpose |
|-|-|
| `DEADLINES_GET` | (opts) → `DeadlineItem[]` (dashboard, calendar layer, reports) |
| `GRID_DEADLINE_CONTEXT` | (gridId) → per-row meter series + quota counts + extensions + progress for grid coloring |
| `DEADLINE_EXTEND` | (rowId, columnId, step?, newDue, reason) |
| `DEADLINE_EXTENSION_REVOKE` | (extensionId) |
| `DEADLINE_STEP_DONE` | (rowId, columnId, step) + undo counterpart `DEADLINE_STEP_UNDO` |
| `DEADLINE_METER_DONE` | (rowId, columnId, reading) |
| `ALERT_RULE_CREATE/UPDATE` | accept `kind`, `rule_config`, `rule_condition`, `business_days` (zod per kind) |
| `HOLIDAYS_GET/SET` | business-day calendar |

Existing `DASHBOARD_GET_DEADLINES` becomes a thin wrapper over `loadDeadlines` (same output shape plus new fields) so the dashboard migrates in one step.

## 6. Rule editor (renderer `AlertRuleEditor.tsx`)
1. **"How is this deadline worked out?"** shows 6 cards with plain examples:
   - **After the date in this column:** every 30 days, 6 months, 1 year.
   - **From another date:** 45 days after Referral date; 60 days before Lease end.
   - **On fixed dates:** every Mar 31; quarterly on the 15th.
   - **By usage:** every 5,000 miles or 6 months.
   - **A limited number of visits:** 12 sessions until the authorization ends.
   - **A series of steps:** 30-day, 90-day, then annual.
2. **Kind-specific fields**, using column pickers (filtered by type: dates for anchors, numbers for meters).
3. **"Only when…"** (condition, optional) and **"Count business days only"**.
4. **Color thresholds** (unchanged UI).
5. **Live preview:** pick a record from the list (defaults to the first with data) → "For Jane Smith: due Mar 3, 2027 (oil change: 4,200 mi left)".

Rules are created on a column (column menu → Deadline rule), as today. Quota and calendar rules can live on a date column used as the "completed on" marker, or on a **virtual deadline column**: new `ColumnType` `'deadline'`, which has no input of its own and just displays the rule's status. It's needed for calendar rules with no date to type ("Quarterly estimates").

## 7. Mark done per kind (extends A4 `completeDeadline.ts`)
| Kind | Done does | Undo |
|-|-|-|
| interval | column = today (next cycle) or clear (as A4) | restore value |
| relative | column (done marker) = today | restore |
| calendar | column (done marker) = today → next occurrence | restore |
| meter | prompt reading → column = today, last-service reading = reading | restore both |
| quota | not offered (shows "Renew authorization…" to set new start/end/limit) | — |
| sequence | progress step done | delete progress row |

All log the activity text as today, plus the checklist-on-done option (A4).

## 8. Parity plan (do this first)
1. Build a fixture DB from the human-services sample data plus A3 calendar-month rules, and run today's code to snapshot JSON:
   - `queryDeadlines()`
   - briefing counts
   - `loadPlannerRows(week)`
   - `loadIcsItems()`
   - `getComplianceSummary(month)`
   - supervisor deadline counts
   - grid row colors (renderer `computeDaysUntil` over all cells)
2. Implement the engine + loader; snapshot the same functions; assert **identical** (excluding new optional fields).
3. Only then switch callers one by one (dashboard → briefing → planner → ics → compliance → supervisor → grid), each its own commit with the parity test green.
4. Delete `effectiveDateSql` and its SQL usages.

## 9. Tests
- **Engine unit tests per kind**, including:
  - month-end clamps;
  - business days across holidays and weekends, including rolling back from a holiday;
  - calendar next occurrence on the boundary day;
  - meter with 0, 1, 2 and many history points, negative usage (odometer corrected), time-fallback winning;
  - quota with voided notes, end passed, limit from a column;
  - sequence progress and `repeatLast`;
  - conditions hide/pause;
  - extensions applying and voiding on anchor change.
- **Property tests:** random dates and intervals; interval kind equals the old `addInterval`.
- **Parity snapshots** (§8).
- **Performance:** 2,000 records × 5 rule columns < 200 ms in `loadDeadlines`.
- **Renderer:** the rule editor builds valid configs per kind (zod), the preview text, and Extend/step/meter dialogs with undo.

## 10. Commits
1. Engine (interval only) + parity fixture + snapshot tests.
2. `loadDeadlines` (interval) + switch dashboard + briefing.
3. Switch planner, ics, compliance, supervisor, grid; delete `effectiveDateSql`.
4. Migration 039 + relative + business-day calendar + holidays UI.
5. Calendar kind + `deadline` column type.
6. Meter kind + mark-done prompt + grid context IPC.
7. Quota kind.
8. Sequence kind + progress + profile steps view.
9. Conditions.
10. Extensions (extend, revoke, audit, summary).
11. Rule editor v2 with live preview.
12. Starter/template support (`kind`, `rule_config` with columns by name).
