# W04. Linked records

Size: L (8 days). Phase: P3. Depends on W01 (feature switch `links`), W02 (display names).

## 1. User stories
1. *As a shop owner*, each vehicle has an owner (a customer), each job is for a vehicle, and a customer's page shows their vehicles and jobs.
2. *As a guardian*, a ward is linked to a facility and a court case, and I can see all wards at one facility.
3. *As an agency lead*, each client has an assigned staff member, and I can filter or report by staff.
4. *As anyone*, linking is as easy as picking from a searchable list, and it shows up in the audit trail.

## 2. Concepts
- **Link type:** a named relationship between two lists, defined once, e.g. Vehicles → Customers, "Owner" / "Vehicles".
- **Link:** one connection between two records of that type.
- **Link column:** shows a link type's links in a list's grid (either direction).
- **Cardinality:**
  - `many_to_one`: many vehicles → one owner. The forward side holds one; the backward side holds many.
  - `one_to_one`.
  - `many_to_many`: staff ↔ clients.
- **Self-links** (same list on both sides, e.g. household members) are allowed.

## 3. Data (migration 038)
```sql
CREATE TABLE IF NOT EXISTS link_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
  to_grid_id   INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
  label_forward  TEXT NOT NULL,     -- shown on the "from" record: "Owner"
  label_backward TEXT NOT NULL,     -- shown on the "to" record: "Vehicles"
  cardinality TEXT NOT NULL DEFAULT 'many_to_one' CHECK (cardinality IN ('one_to_one','many_to_one','many_to_many')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS record_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_type_id INTEGER NOT NULL REFERENCES link_types(id) ON DELETE CASCADE,
  from_row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
  to_row_id   INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (link_type_id, from_row_id, to_row_id)
);
CREATE INDEX IF NOT EXISTS idx_record_links_from ON record_links(link_type_id, from_row_id);
CREATE INDEX IF NOT EXISTS idx_record_links_to   ON record_links(link_type_id, to_row_id);
```
**Link column:** new `ColumnType` `'link'`, config `{ link_type_id: number; direction: 'forward' | 'backward'; show?: 'names' | 'count' }`. No `cells` rows are stored for link columns.

## 4. Grid loading (keeps the single-query rule)
`buildGridQuery` gets the list's link columns and adds one correlated subquery per link column next to the `MAX(CASE…)` pivots:
```sql
(SELECT GROUP_CONCAT(t.id || char(30) || COALESCE(t.display_name,''), char(31))
   FROM record_links l JOIN rows t ON t.id = l.to_row_id      -- (from/to swapped for backward)
  WHERE l.link_type_id = 7 AND l.from_row_id = r.id AND t.deleted_at IS NULL
  ORDER BY t.display_name) AS col_42
```
- It's still one statement and one round trip (correlated subqueries use the indexes).
- The renderer parses `id␞name␟id␞name` into chips.
- **Budget:** 500 rows × 3 link columns in under 300 ms.
- `getRow` gets the same. Sorting by a link column sorts by the concatenated names. Filtering supports "is empty / contains name / links to record X".

## 5. Main module: `src/main/links.ts`
```ts
export function listLinkTypes(gridId?: number): LinkType[]                      // types touching a grid
export function saveLinkType(input: LinkTypeInput): LinkType                    // create/update labels/cardinality (cardinality change validated against existing data)
export function deleteLinkType(id: number): void                                // removes its link columns too (confirm in UI with counts)
export function getLinksForRow(rowId: number): RowLinks[]                        // both directions, grouped by type, with display names + list names
export function addLink(typeId: number, fromRowId: number, toRowId: number): LinkChange   // enforces grids + cardinality; many_to_one replaces the previous target
export function removeLink(typeId: number, fromRowId: number, toRowId: number): LinkChange
export function searchLinkTargets(typeId: number, direction: 'forward'|'backward', query: string, limit = 20): Target[]
```
- **Cardinality enforcement** happens in the same transaction: for `many_to_one` forward, delete any existing link of that type from `fromRowId` first, and return the replaced link so undo can restore it.
- **Audit:**
  - Each add or remove writes a `system` case-log entry on **both** records, only when either list has log changes enabled (same rule as cell changes): "Owner set to Jane Smith (was Bob Lee)", "Vehicle 2017 Honda Civic linked".
  - The audit loader also reads link history. Because links can be deleted, add a small `record_link_history (link_type_id, from_row_id, to_row_id, action, at)` table in 038 so the audit trail is complete even when logging is off.

## 6. IPC
| Channel | Args → result |
|-|-|
| `LINK_TYPE_GET_ALL` | (gridId?) → `LinkType[]` |
| `LINK_TYPE_SAVE` | (input) → `LinkType` |
| `LINK_TYPE_DELETE` | (id) → ok |
| `RECORD_LINKS_GET` | (rowId) → `RowLinks[]` |
| `RECORD_LINK_ADD` | (typeId, fromRowId, toRowId) → `LinkChange` |
| `RECORD_LINK_REMOVE` | (typeId, fromRowId, toRowId) → `LinkChange` |
| `RECORD_LINK_SEARCH` | (typeId, direction, query) → `Target[]` |
| push `RECORD_LINKS_CHANGED` | (rowIds) → open grids/profiles refresh |

All writes go through `enforceWritable` and validate that the rows belong to the type's grids.

## 7. Renderer

### 7.1 Creating a link
- **From a list's column menu** → "Add column" → **Link to another list**: pick the target list → labels (prefilled: forward = target's `record` word singular, backward = this list's plural) → "Can one {record} have several {target}s?" (sets cardinality) → creates the link type and a forward link column here, and offers "Also show on {target list}" (backward column there).
- **From the W01 offer:** "Connect these lists?" when a second list exists.

### 7.2 Grid cell
- **Display:** chips with display names (max 3, then "+2"); click a chip → open that record's profile.
- **Edit (Enter/double-click):** a popover with a search box (`RECORD_LINK_SEARCH`), the current links with ×, keyboard navigation, and "New {target}…", which creates a record in the target list with the typed name and links it.
- **Bulk edit:** "Set {label} for selected" (forward many_to_one only).

### 7.3 Profile
- **Section "Linked"** (feature `links`): one block per link type touching this list, both directions:
  - header "Vehicles (2)" with "+ Link" and "+ New";
  - rows show the display name, the target list's key columns (first 2 visible), and the deadline chip if any.
- **Rollups:** a linked record's overdue or due-soon deadlines show under the block ("2017 Civic: oil change overdue 12 days").

### 7.4 Filters, grouping, reports
- **FilterBar:** link column conditions (is empty, is not empty, links to [record picker], linked record's column [op] value; one level deep).
- **Grouping:** group by a link column (forward many_to_one) → "Owner: Jane Smith".
- **Reports** (W10 builder): group by linked record.

### 7.5 Dashboard and deadlines
Each deadline row shows the primary link as context ("Oil change: 2017 Civic (Jane Smith)") when the list has a forward many_to_one link column. Configured by "Show with deadlines" on the link column.

## 8. Lifecycle
| Event | Links |
|-|-|
| Record archived | Kept; shown muted ("archived") in chips and profile |
| Record moved to trash | Hidden from chips, search and rollups (filtered on `deleted_at`); restored with it |
| Record purged | Rows deleted → `ON DELETE CASCADE` removes links; history rows stay for the audit trail |
| Record duplicated | Forward links copied (not backward, to avoid stealing many_to_one targets) |
| Record moved to another list (`MoveToGridModal`) | Links whose type doesn't fit the new list are removed, with a warning listing them |
| List deleted | Link types touching it cascade; confirm dialog states how many links will go |
| Backup/restore, move wizard | Tables travel inside the DB, no change |
| Templates/starters | `links` in `StarterList` by list `key`; `.pulse` v1.1 single-list files can't hold links (they need two lists) |
| Import (C2) | A source column can map to a link column: values matched to target display names (exact, case-insensitive); unmatched values listed in warnings, with an option "create missing {targets}" |

## 9. Tests
- Migration 038 on a fixture.
- Cardinality: many_to_one replace returns the replaced link; one_to_one both sides; many_to_many duplicates rejected by UNIQUE.
- Rows from wrong grids rejected.
- Grid query: link names in a single query, trashed targets hidden, performance budget.
- Profile links both directions; rollup deadlines.
- Audit entries on both records, and history kept after purge.
- Lifecycle table rows (archive, trash, purge, duplicate, move, list delete).
- Import mapping into link columns with create-missing.
- Starter apply with links; export setup includes link types.
- Renderer: chip rendering and parsing, picker keyboard flow, "New {target}…" creates and links, undo of add/remove/replace.

## 10. Commits
1. Migration 038 + `links.ts` + IPC + tests.
2. Link column type in the pivot query + grid display chips (read-only) + perf test.
3. Link picker popover (add/remove/new) + undo + audit entries.
4. Profile "Linked" section + rollups.
5. Create-link flow from the column menu + `FeatureOffer`.
6. Filters/grouping on link columns.
7. Lifecycle handling (duplicate, move, list delete) + import mapping.
8. Starter/template support.
