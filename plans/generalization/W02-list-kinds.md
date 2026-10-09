# W02. List kinds, display names and auto numbers

Size: S–M (4 days). Phase: P1. Depends on W01 (migration 036 adds the columns).

## 1. User stories
1. *As a shop owner*, my Vehicles list should show "2017 Honda Civic – ABC123" as the name everywhere, not just the first column.
2. *As an equipment manager*, I don't want "Age from date of birth" or initials-only calendar entries for machines.
3. *As someone tracking jobs*, I want each job to get a number automatically (J-0001, J-0002…).
4. *As anyone*, I want to say what a list holds when I create it, and change it later.

## 2. Kinds
| Kind | Meaning | Differences from today |
|-|-|-|
| `person` | Clients, students, staff, customers, wards | None: today's behavior |
| `thing` | Vehicles, equipment, units, documents, licenses | Person-only parts hidden; full names allowed in calendar export and file names |
| `job` | Work orders, jobs, cases, transactions, applications | Like `thing`; suggests an auto-number column and a stage column (W06); not counted for the free limit (W13) |

### What "person-only" means (hidden or changed for thing/job lists)
- The **Age from date of birth** column type is not offered in the add-column menu (`GridToolbar.tsx` type list, line ~45) or in setup suggestions. Existing columns of that type keep working.
- **Calendar export (.ics, `export-ics.ts`):** initials are used only for person lists; thing/job lists use the display name.
- **File names** for exports that use initials (`export-csv` / PDF initials-based names from the security fixes) use the display name for thing/job.
- **"Discharged"-style archive wording** comes from the list's vocab `archive` term.
- **Morning briefing and notifications** never show names by default for any kind (no change).
- Starter templates with `personFields` off hide guardian/DOB suggestions (W01 §3.3).

## 3. Display name formats
**Today:** `rows.display_name` is maintained by triggers (migration 017). It holds the name column's value plus a "last name" column when present.

**New:** `grids.display_format` (migration 036), e.g. `{Year} {Make} {Model} – {Plate}`.
- **Tokens** are column names in braces, case-insensitive. Unknown tokens render empty. Runs of spaces and dangling separators (" – " at either end) are trimmed.
- **When set,** main recomputes `display_name` for affected rows:
  - `recomputeDisplayNames(gridId)` after the format changes or columns are renamed or deleted (in the same transaction).
  - On `CELL_UPDATE` / bulk edit / import, when the changed column is referenced by the format. The format's column IDs are cached per grid. This runs after the triggers fire, so it wins.
- **When empty (default),** the triggers behave exactly as today.
- **Editing:** "List settings…" dialog → "How to show each one's name": token chips you can click to insert, plus a live preview from the first record.
- **Max length:** 200 chars (truncate).
- **Everything that reads `display_name` benefits automatically:** dashboard, reports, PDFs, audit trail, calendar, links (W04).

## 4. Auto-number column type
- **New `ColumnType` `'auto_number'`.** The config is `{ prefix: string; pad: number; next: number }`; the default `{ prefix: '', pad: 4, next: 1 }`.
- **Assigned in main on `ROW_CREATE`, duplicate and import:**
  - inside the row-create transaction: read config, write the cell `prefix + String(next).padStart(pad,'0')`, then `next++` in the config;
  - the transaction makes it race-free.
  - **Existing rows** when the column is added: numbered in current position order, oldest first (confirm dialog: "Number the 42 existing jobs now?").
- Read-only in the grid. Searchable, sortable (natural sort on the numeric part), and usable in display formats ("{Number} {Title}").
- **Duplicates** get a new number. **Restoring from trash** keeps the old number. **Import** can map a source column into it, keeping imported values; `next` then becomes max+1.
- **Touchpoints for a new column type** (from grep of `calculated_days`):
  - `src/shared/types.ts` (`ColumnType`, `VALID_COLUMN_TYPES`)
  - `src/main/ipc/ipc-grid.ts` (validation, add-column defaults)
  - `src/main/templates.ts` (`KNOWN_COLUMN_TYPES`)
  - `src/main/missing-info.ts` and `src/shared/requiredFields.ts` (auto numbers can't be required)
  - `src/renderer/components/grid/CellDisplay.tsx`, `CellEditor.tsx` (read-only), `DataGrid.tsx`, `SortableRow.tsx`, `BulkEditDialog.tsx` (excluded), `CellConditionalFormatPanel.tsx`, `GridToolbar.tsx` (type picker)
  - `src/renderer/utils/deadlineCalc.ts` (n/a)
  - CSV export (plain value)

## 5. "List settings…" dialog (new, list menu in the sidebar and grid header)
Fields:
- Name.
- **What does this list hold?** People / Things / Jobs or tasks (a change warns about what will show or hide).
- **What do you call one / more than one?** (per-list `record` words; "Use the workspace words" checkbox).
- **How to show each one's name** (display format, §3).
- **Priority levels on/off** (today's acuity toggle moves here).
- **Monthly requirements…** (opens A2's dialog; it moves from the sidebar menu into here, and the sidebar keeps a shortcut).

Saved via `GRID_SETTINGS_UPDATE(gridId, { name?, record_kind?, vocab?, display_format?, acuity_enabled? })`, with zod validation, one transaction and `WORKSPACE_CHANGED` pushed (vocab).

## 6. Creating a list
"New list" (sidebar +) opens a small dialog:
- name;
- kind (3 cards);
- one/many words (prefilled from the name);
- "Start with: Empty / Suggested columns / From an example list" (the gallery in add-lists mode, W01).

This replaces today's name-only prompt.

## 7. Tests
- Display format parsing (tokens, unknown tokens, separator trimming, case-insensitivity), recompute on cell change, rename and delete of a referenced column.
- Auto number: sequential, concurrent creates in one transaction, duplicate gets a new number, import keeps values and bumps `next`, numbering existing rows.
- Kind-based hiding: age column type absent for things; ics naming per kind.
- Migration fixture: existing grids are `person`, no format, unchanged names.

## 8. Commits
1. `display_format` engine + recompute hooks + tests.
2. `auto_number` column type end to end + tests.
3. Kind-based hiding (type picker, ics, file names) + tests.
4. "List settings…" dialog + `GRID_SETTINGS_UPDATE`.
5. New-list dialog with kind and words.

## 9. Edge cases
- **Changing person → thing** hides the age column type but keeps existing age columns (they still compute).
- **A display format referencing a link column (W04)** uses the linked record's display name. Recompute happens on link change, with a depth limit of 1 to avoid loops.
- **An empty format result** (all tokens empty) falls back to the name column, then "Unnamed {record}".
