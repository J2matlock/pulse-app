# W10. Reports, document templates and the dashboard

Size: M–L (8 days in parts). Phase: P3 (renames, documents, batch, cards, number chart) and P5 (report builder).

## 1. User stories
1. *As a shop owner*, I print "your vehicle is due for service" postcards for every vehicle due next month, with address labels.
2. *As a supervisor*, I make a report like "jobs completed per month with total parts cost" without help, and save it.
3. *As a therapist*, I see a client's PHQ-9 scores as a small chart over time.
4. *As anyone*, my dashboard shows the cards that matter to my work, in the order I want.

## 2. Report renames (vocab-driven, P3)
| Today | New title | File / dialog |
|-|-|-|
| Supervisor report | Summary report | `export-supervisor.ts`, `SupervisorReportDialog.tsx` |
| Compliance summary | Requirements summary | `compliance.ts`, `ComplianceSummaryDialog.tsx` |
| Time and mileage | Totals | W03 |
| Audit trail · Missing information · Handoff packet | unchanged ("Record packet" for thing/job lists) | — |

The Export menu groups items under "Export" (CSV, PDF, Batch print) and "Reports" (Summary, Requirements, Missing information, Audit trail, Totals, Saved reports…).

## 3. Document templates (letters generalized, P3)
- The `letter_templates` table is unchanged; the UI is renamed "Documents" ("Letters & documents" in the sidebar).
- **Placeholders** (`generateLetter` in `templates.ts`) are rewritten as a resolver:
  | Placeholder | Value |
  |-|-|
  | `{{name}}` | record display name (W02) |
  | `{{field:Column Name}}` | any column, formatted by type |
  | `{{linked:Owner.Phone}}` | a forward many_to_one link's target column (W04) |
  | `{{my_name}}`, `{{my_title}}`, `{{my_org}}`, `{{my_phone}}`, `{{my_email}}` | profile settings |
  | `{{today}}`, `{{today:long}}` | dates |
  | `{{deadline:Column Name}}` | that column's due date from the engine (W05) |
  | `{{appointment.date}}`, `{{appointment.time}}`, `{{appointment.location}}` | next scheduled appointment (W07) |
  | **Aliases kept forever:** `{{client_name}}` = name, `{{case_manager_name}}` = my_name, `{{dob}}`, `{{age}}` and every existing column-derived key | unchanged |
- **The editor** gets an "Insert field" menu built from the current list's columns, links and profile fields (replacing hand-typing).
- **Unknown placeholders** are left visible and listed in a warning before printing.

### 3.1 Batch documents
`DOC_BATCH(templateId, { gridId, rowIds? | savedFilterId? | deadline: { columnId, from, to } })` → one PDF, one document per page (page break between), in display-name order.

**Entry points:**
- bulk action bar "Print documents for selected";
- the dashboard "Due next month" menu → "Print reminder letters";
- the saved filter menu.

### 3.2 Address labels and postcards
- **Labels:** `DOC_LABELS({ rowIds, addressColumnId, nameFormat, layout: 'avery-5160' | 'avery-5163' })` → PDF.
  - 5160: 30 per sheet, 2.625×1 in.
  - 5163: 10 per sheet, 4×2 in.
  - The address comes from an `address` column; multi-line is preserved.
- **Postcards:** a template page size option, `letter` | `postcard-4x6` (two per letter sheet with cut marks).

## 4. Dashboard cards (P3)
- **The dashboard becomes:** a header (title + action buttons) → a **card area** (user-arranged) → the existing tabbed priority/overdue/week/month/archived panel, which stays as the main card.
- **Card registry** `src/renderer/views/dashboard/cards/index.ts`:
  ```ts
  interface CardDef { key: string; title: (t) => string; feature?: FeatureKey; component: React.FC; defaultOn: boolean }
  ```
  | Key | Card | Feature |
  |-|-|-|
  | `summary` | Summary counts (today's 5 tiles) | — |
  | `requirements` | Requirements this period (A2 card) | requirements |
  | `missingInfo` | Missing information notice (B2) | — |
  | `today` | Today's appointments | appointments |
  | `stages` | Stage counts per list | stages |
  | `dueForService` | Meter rules due in 30 days | — (shown if any meter rule) |
  | `quotas` | Authorizations/quotas running low | — (shown if any quota rule) |
  | `recentActivity` | Last 10 notes across lists | — |
  | `savedReport:<id>` | A pinned saved report's table | — |
- **Layout:**
  - settings `dashboard_layout` (JSON array of keys);
  - "Customize dashboard" mode with show/hide checkboxes and drag to reorder;
  - starters suggest a layout on apply;
  - cards whose feature is off are skipped.

## 5. Number history chart (P3)
- **On a profile,** each number/currency column with ≥ 2 history entries shows a sparkline next to its value, and a full chart on click: dates on the x axis, values on y, points labelled.
- **Data:** `CELL_HISTORY_SERIES(rowId, columnId)` → `[{ at, value }]` from `cell_history` (+ current value).
- **Rendering:** inline SVG (no chart library), dark mode aware, with a table fallback for screen readers.
- **Columns can opt in to "Record every change"** (forces `log_changes`), so history exists for scores like PHQ-9.

## 6. Report builder (P5)
### 6.1 Definition (migration 043)
```sql
CREATE TABLE IF NOT EXISTS report_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
  config TEXT NOT NULL,          -- JSON ReportConfig
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
```ts
interface ReportConfig {
  source: 'records' | 'activities' | 'appointments' | 'deadlines'   // what each row of the report is
  filters: FilterCondition[]                    // same shape as FilterBar
  dateRange?: { field: string; from?: string; to?: string; preset?: 'this_month' | 'last_month' | 'this_quarter' | 'this_year' }
  groupBy?: Array<{ field: string; bucket?: 'day' | 'week' | 'month' | 'quarter' | 'year' }>   // ≤ 2
  values: Array<{ fn: 'count' | 'sum' | 'avg' | 'min' | 'max'; field?: string; label?: string }>  // ≤ 6
  columns?: string[]                            // when not grouped: which fields to list
  sort?: { field: string; dir: 'asc' | 'desc' }
}
```
**Fields available:**
- records: columns, stage, days in stage, link targets' columns, created date;
- activities: type, date, measures, the record's columns;
- appointments: status, date, type;
- deadlines: rule, state, due date, days overdue.

### 6.2 Execution
- `src/main/report-builder.ts` compiles the config to **parameterized** SQL over a whitelist of fields:
  - column refs are resolved to ids and validated against the grid;
  - no user text is ever concatenated into SQL;
  - aggregation over EAV values via `CAST(... AS REAL)` for numeric fields.
- The deadlines source runs through `loadDeadlines` (W05) and is grouped in JS.
- **Limits:** 50,000 source rows, 2,000 output rows, a 5 s timeout.

### 6.3 UI
`Reports → New report…`, a 4-step panel with a live preview table:
1. Pick the list and what to count (records / notes / appointments / deadlines).
2. Filters and date range.
3. Group by (optional).
4. Values.

Then Save, Export PDF/CSV, and "Pin to dashboard".

## 7. Tests
- Placeholder resolver: every alias, links, deadlines, unknown placeholder warnings.
- Batch PDF page count; labels layout positions (5160 coordinates).
- Dashboard layout persistence; feature-off cards hidden.
- Sparkline series from history.
- Report builder: config validation (zod), SQL generation snapshots, injection attempts in names/values, each source type, grouping by month, sums of measures and currency, limits.

## 8. Commits
- **P3:**
  1. Report renames + Export menu grouping.
  2. Placeholder resolver + insert-field menu.
  3. Batch documents + labels + postcards.
  4. Dashboard card registry + customize mode + new cards.
  5. Number history chart.
- **P5:**
  6. Migration 043 + report builder engine + tests.
  7. Builder UI + save/pin/export.
