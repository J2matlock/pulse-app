# W03. Activity types, measures and recurring requirements

Size: M (5 days). Phase: P1. Depends on W01.

## 1. User stories
1. *As a therapist*, my note types are Session, Phone, No-show and Cancellation, not Visit/Meeting/Email.
2. *As a shop owner*, each job note can record labor hours and parts cost, and I can total them per month.
3. *As a coach*, I need "2 check-ins per week", not per month.
4. *As an existing user*, my five note types, minutes and miles keep working exactly as before.

## 2. Activity types

### 2.1 Today
`case_log.log_type` is validated against a fixed set in `src/main/ipc/ipc-caselog.ts` (`VALID_CASE_LOG_TYPES`: note, phone, meeting, email, visit + system, manual, import, followup). The renderer has fixed `LOG_TYPES` (CaseLog.tsx) and `TYPE_CONFIG` (CaseLogEntry.tsx). A1 (`note-date-updates.ts` `NOTE_UPDATE_TYPES`) and A2 (`contact-requirements.ts`) hard-code the five keys.

### 2.2 Model (migration 037)
```sql
CREATE TABLE IF NOT EXISTS activity_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,              -- stored in case_log.log_type; [a-z0-9_]{1,30}
  label TEXT NOT NULL,                   -- ≤ 40 chars
  icon TEXT,                             -- lucide icon name from an allowlist, or an emoji
  color TEXT,                            -- one of the app's 8 palette keys
  position INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Seed (INSERT OR IGNORE) the five defaults with today's labels and emoji:
-- note 📝 Note · phone 📞 Phone · meeting 🤝 Meeting · email ✉️ Email · visit 🏠 Visit
```
**System types** (`system`, `manual`, `import`, `followup`) stay in code (`SYSTEM_ACTIVITY_TYPES` in `src/shared/activityTypes.ts`); they are never in the table and never shown in pickers.

### 2.3 Shared helpers: `src/shared/activityTypes.ts`
```ts
export interface ActivityType { id: number; key: string; label: string; icon: string | null; color: string | null; position: number; is_archived: 0 | 1 }
export const SYSTEM_ACTIVITY_TYPES = ['system', 'manual', 'import', 'followup'] as const
export function keyFromLabel(label: string, taken: Set<string>): string   // "No-show" → "no_show", "no_show_2"
export function labelFor(types: ActivityType[], key: string): string     // archived/unknown keys still get a readable label
```

### 2.4 Main
- `src/main/activity-types.ts`:
  - `listActivityTypes(includeArchived)`
  - `saveActivityType({ id?, label, icon, color })`: the key is generated only on create and never changes
  - `archiveActivityType(id)`, `unarchiveActivityType(id)`
  - `reorderActivityTypes(ids)`
  - `userTypeKeys()` (cached; invalidated on any change and on DB close)
- `ipc-caselog.ts`: replace `VALID_CASE_LOG_TYPES` with `isValidLogType(key) = SYSTEM ∪ userTypeKeys(includeArchived=false)` for **create**. Restore and edit allow archived keys, so undo still works.
- `note-date-updates.ts`: `NOTE_UPDATE_TYPES` → `userTypeKeys()`.
- `contact-requirements.ts` validation: allowed `note_types` = `userTypeKeys()`.
- `export-audit.ts` `NOTE_TYPE_LABEL`, `time-mileage.ts`, `compliance.ts`: labels via `labelFor`.
- Deleting is not offered. Archive only if used; if never used, a real delete is allowed (`DELETE ... WHERE NOT EXISTS (SELECT 1 FROM case_log WHERE log_type = key)`).

### 2.5 IPC
| Channel | Args → result |
|-|-|
| `ACTIVITY_TYPE_GET_ALL` | (includeArchived?: boolean) → `ActivityType[]` |
| `ACTIVITY_TYPE_SAVE` | (`{ id?, label, icon?, color? }`) → `ActivityType` |
| `ACTIVITY_TYPE_ARCHIVE` | (id, archived: boolean) → ok |
| `ACTIVITY_TYPE_DELETE` | (id) → ok \| fail("This type is used by N notes; archive it instead") |
| `ACTIVITY_TYPE_REORDER` | (ids: number[]) → ok |
| push `ACTIVITY_TYPES_CHANGED` | → renderer store reload |

### 2.6 Renderer
- `src/renderer/stores/activityTypeStore.ts` + `useActivityTypes()`.
- **Replace hard-coded lists:**
  - `CaseLog.tsx` `LOG_TYPES` (type chips)
  - `CaseLogEntry.tsx` `TYPE_CONFIG` (label/icon/background). The background comes from the color key, with system types keeping their current styling.
  - `NoteUpdatePicker.tsx` `NOTE_TYPE_OPTIONS`
  - `ContactRequirementsDialog.tsx` `NOTE_TYPES`
  - case log filter chips, if present.
- **Editor:** Settings → Case notes ("Notes & activity"):
  - list with drag to reorder (dnd-kit), label input, icon picker (a 24-icon grid), color swatches;
  - Archive/Restore, Delete (only if unused);
  - "Add a type".
- **The composer chip row** wraps; when more than 6 types exist, the overflow goes into a "More…" menu. The last used type is remembered (settings `note_type_last`).

## 3. Measures

### 3.1 Today
`case_log.minutes INTEGER`, `case_log.miles REAL` (migration 035). Units via `unitsFor`; rate via `mileage_rate`. Switches `track_time` / `track_mileage`.

### 3.2 Model
- **The built-ins stay as they are:** `minutes` (with units) and `miles` (with rate). The W01 features `timeTracking` / `mileage` replace the `track_*` settings; migration 036 maps the old values.
- **Custom measures:**
  - Definitions in settings key `workspace_measures`:
    ```ts
    interface MeasureDef { key: string; label: string; unit?: string; kind: 'number' | 'currency' | 'hours'; decimals: 0 | 1 | 2; archived?: boolean }
    ```
    Max 10 active. The key is generated from the label and immutable.
  - Values in `case_log.extra_measures TEXT` (JSON object `{ [key]: number }`), migration 037 (guarded).
- **Validation (`validMeasures` in `ipc-caselog.ts`):**
  - keys must be defined measures (archived allowed on edit/restore);
  - finite and ≥ 0;
  - number ≤ 1e7, currency ≤ 1e7 rounded to 2 decimals, hours ≤ 24 rounded to 2;
  - at most 10 keys.
- `CASE_LOG_CREATE` measures arg becomes `{ minutes?, miles?, extra?: Record<string, number> }`; `CASE_LOG_SET_MEASURES` takes the same.

### 3.3 Renderer
- **Composer and entry edit inputs** (`CaseLog.tsx` / `CaseLogEntry.tsx`):
  - built-ins when on, then each active custom measure;
  - inputs are `type=number` with unit suffix and currency prefix;
  - badges on entries: "45 min (3 units) · 12.4 mi · Labor 1.5 h · Parts $84.20".
- **Settings → Case notes:** a "Numbers on notes" section:
  - built-ins (time + unit size, mileage + rate);
  - custom measures list (add, rename, kind, decimals, archive).

### 3.4 Totals report (replaces "Time and mileage")
- `src/main/time-mileage.ts` → `src/main/totals.ts`, `getTotals(month, gridId?)`:
  - per record: minutes, units, miles, plus each custom measure sum;
  - totals row;
  - mileage amount when a rate is set.
- **CSV:** one row per note with every measure column (Date, {record}, List, Type, Minutes, Units, Miles, …custom, Amount, Note), then the total row.
- **Dialog:** `TimeMileageDialog` → `TotalsDialog`, same month/scope controls; table columns only for measures with data that month.
- **IPC:** rename to `TOTALS_GET` / `TOTALS_EXPORT_CSV`, keeping the old channel names as aliases for one release (or update the callers at the same time; it's internal).

## 4. Recurring requirements (A2 generalized)
- Migration 037: `ALTER TABLE contact_requirements ADD COLUMN period TEXT NOT NULL DEFAULT 'month'` (guarded). Values: `week | month | quarter | year`. `per_month` keeps its name in the DB but means "per period" (renaming a column isn't worth a table rebuild).
- **Period math** in `src/shared/periods.ts`:
  ```ts
  export function periodRange(period, ref: Date, weekStart: 'sunday' | 'monday'): { start: string; end: string; key: string; label: string }
  // week → key '2026-W40'; month → '2026-10'; quarter → '2026-Q4'; year → '2026'
  ```
- `getContactStatus(month)` → `getRequirementStatus(ref: string /* YYYY-MM-DD */, gridId?)`:
  - each requirement counts notes inside **its own** period containing `ref`;
  - SQL uses `date(cl.created_at,'localtime') BETWEEN ? AND ?` per period group.
- **UI:**
  - The requirements dialog gets a period select ("per week / month / quarter / year").
  - The dashboard card title is built from the periods present ("This week's and this month's requirements"); days-left text is per period.
  - The profile line shows each requirement with its period ("Check-ins this week 1 of 2").
  - The compliance summary (W10 "Requirements summary") states the period per requirement ("Q4 2026").

## 5. Starter template support
Starters can carry `activityTypes` and `measures` (W01 §4.1). Applying:
- adds missing types by key, never renaming the user's existing ones;
- adds measures by key, skipping ones that exist;
- maps requirements' `note_types` to keys.

## 6. Migration 037 summary
```sql
CREATE TABLE IF NOT EXISTS activity_types (...);           -- + seed 5 defaults
ALTER TABLE case_log ADD COLUMN extra_measures TEXT DEFAULT NULL;        -- guarded
ALTER TABLE contact_requirements ADD COLUMN period TEXT NOT NULL DEFAULT 'month';  -- guarded
UPDATE app_meta SET value = '37' WHERE key = 'schema_version';
```
Notes whose `log_type` isn't in the table or system list (impossible today, but defensive) are inserted as archived types labelled from the key.

## 7. Tests
- Migration 037 on a fixture: 5 types seeded; all existing notes still valid; requirements default to month.
- Create a note with a custom type; reject an archived type on create but allow it on restore; delete only if unused.
- A1 date updates and A2 requirements with a custom type key.
- Measures validation per kind; `extra_measures` round trip through create, set and restore; totals per record/list; CSV columns.
- Period ranges: week with Sunday/Monday start across year boundaries, quarters, years; requirement status per period.
- Renderer: chips from the store, the overflow menu, the type editor (reorder, archive), measure inputs rendering.

## 8. Commits
1. Migration 037 + `activityTypes.ts` + main module + IPC + tests.
2. Replace the hard-coded type lists in main (caselog validation, A1, A2, audit, totals labels).
3. Renderer store + replace the hard-coded type lists + Settings type editor.
4. Custom measures (definitions, validation, composer/entry inputs, badges).
5. Totals report (rename + custom measures + CSV).
6. Requirement periods (math, status, dialog, card, profile line, summary).

## 9. Edge cases
- **Renaming a type** changes the label everywhere, including old notes. Keys never change, so history stays correct.
- **Archived types** still show on old notes with their label and a muted "(archived)" in filters.
- **Custom measure archived:** the values remain in old notes and totals for months that have them.
- **Week-start setting changed mid-week:** status recalculates for the new definition. The past isn't stored, so nothing to migrate.
