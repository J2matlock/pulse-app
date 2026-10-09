# Checklist Groups Implementation Plan

## Design Decision: Separate `checklist_groups` table

A separate table (not inline columns) because groups need their own identity for collapse state, rename, reorder, and per-group progress tracking. Clean FK relationship. Backward compatible: existing items have `group_id = NULL` (displayed as "Ungrouped").

---

## 1. Schema Change — Migration 028

**File:** `src/main/migrations/028_checklist_groups.ts`

> Migration 027 is reserved for document storage (shared file-storage infrastructure). This is 028.

```sql
CREATE TABLE IF NOT EXISTS checklist_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_collapsed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checklist_groups_row ON checklist_groups(row_id);

ALTER TABLE checklist_items ADD COLUMN group_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_checklist_items_group ON checklist_items(group_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_row_group ON checklist_items(row_id, group_id);
```

Schema version → 28. No FK constraint on `group_id` (SQLite limitation with ALTER TABLE). Handle integrity in application layer: delete group → `UPDATE checklist_items SET group_id=NULL WHERE group_id=?`.

**Note:** The compound index `(row_id, group_id)` is needed for efficient group-scoped `MAX(position)` queries (the single-column `group_id` index won't help with `WHERE row_id = ? AND group_id = ?`).

## 2. IPC Channel Additions

**File:** `src/shared/ipc-channels.ts`

```typescript
CHECKLIST_GROUP_GET_ALL: 'checklist:group-get-all',       // (rowId) => ChecklistGroup[]
CHECKLIST_GROUP_CREATE: 'checklist:group-create',          // (rowId, name) => ChecklistGroup
CHECKLIST_GROUP_UPDATE: 'checklist:group-update',          // (groupId, updates) => ok
CHECKLIST_GROUP_DELETE: 'checklist:group-delete',          // (groupId) => ok (items become ungrouped)
CHECKLIST_GROUP_REORDER: 'checklist:group-reorder',        // (rowId, orderedGroupIds) => ok
CHECKLIST_MOVE_ITEM_TO_GROUP: 'checklist:move-item-group', // (itemId, groupId | null) => ok
```

## 3. Shared Types

**File:** `src/shared/types.ts`

```typescript
export interface ChecklistGroup {
  id: number
  row_id: number
  name: string
  position: number
  is_collapsed: 0 | 1
  created_at: string
}
```

Extend `ChecklistItem` with `group_id: number | null`.

## 4. IPC Handler Implementation

**File:** `src/main/ipc/ipc-checklists.ts`

### New handlers:
- **CHECKLIST_GROUP_GET_ALL**: `SELECT * FROM checklist_groups WHERE row_id = ? ORDER BY position, id`
- **CHECKLIST_GROUP_CREATE**: Insert with maxPos + 1 pattern, return created group
- **CHECKLIST_GROUP_UPDATE**: `buildSafeSetClause` for `name`, `position`, `is_collapsed`; validate name length (max 200)
- **CHECKLIST_GROUP_DELETE**: Transaction: `UPDATE checklist_items SET group_id = NULL WHERE group_id = ?` then `DELETE FROM checklist_groups WHERE id = ?`
- **CHECKLIST_GROUP_REORDER**: Same pattern as CHECKLIST_REORDER, updating position for each group_id
- **CHECKLIST_MOVE_ITEM_TO_GROUP**: `UPDATE checklist_items SET group_id = ? WHERE id = ?`; validate groupId belongs to same row_id

### Modified existing handlers:
- **CHECKLIST_GET**: Query unchanged (already `SELECT *`, includes new `group_id` column)
- **CHECKLIST_CREATE_ITEM**: Accept optional `group_id` in the `extra` parameter. **Add `group_id` to the explicit INSERT column list and VALUES placeholders** (current INSERT has 8 columns: row_id, title, description, due_date, category, priority, position, created_at). Calculate `maxPos` scoped to group: `SELECT MAX(position) ... WHERE row_id = ? AND group_id IS ?` (SQLite's `IS` operator handles NULL equality correctly — avoids the `OR (? IS NULL AND group_id IS NULL)` pattern)
- **CHECKLIST_APPLY_TEMPLATE**: If template has groups (v2 format), create groups first, then insert items with correct group_ids
- **CHECKLIST_RESTORE_ITEM**: Add `group_id` to the INSERT column list (current handler has 16 explicit columns at ipc-checklists.ts:162), VALUES placeholders, **AND the typed parameter interface** (at ipc-checklists.ts:144). Note: CREATE_ITEM has 8 columns but RESTORE_ITEM has 16 — they're different handlers.
- **CHECKLIST_REORDER**: **Breaking API change** — change payload from `orderedIds: number[]` to `{itemId, groupId, position}[]` tuples for cross-group reordering. Current handler (line 96-110) validates `orderedIds.every(id => Number.isInteger(id) && id > 0)` and Checklist.tsx (line 274) passes `newOrder.map(i => i.id)`. **All of these must be updated simultaneously:** (a) handler validation, (b) all call sites in Checklist.tsx, (c) any undo callbacks in undoStore that reference the old reorder format.

## 5. Template System Changes

### Template format v2:
```json
{
  "version": 2,
  "groups": [
    {"name": "Intake", "items": [{"title": "...", "category": "...", "priority": "normal"}]},
    {"name": "SNAP Application", "items": [{"title": "..."}]}
  ],
  "ungrouped": [{"title": "..."}]
}
```

**Backward compatibility**: Check if template items is an array (v1) or object with `version: 2` (v2). V1 templates produce all-ungrouped items.

**Files to update:**
- `src/main/ipc/ipc-checklists.ts` — CHECKLIST_APPLY_TEMPLATE: parse v1 or v2 format. **Also update `CL_TEMPLATE_CREATE` and `CL_TEMPLATE_UPDATE` validators** (lines 210, 225) which currently validate `items` as a JSON array — they will reject v2 object format. Must accept both array (v1) and object with `version: 2` (v2).
- `src/main/templates.ts` — Update Zod validator to accept both formats
- `src/renderer/components/profile/Checklist.tsx` — Template save produces v2 when groups exist
- `src/renderer/components/profile/ChecklistTemplateEditor.tsx` — Major UI change for group sections

## 6. UI Changes

### 6a. New Component: ChecklistGroupHeader.tsx

**File:** `src/renderer/components/profile/ChecklistGroupHeader.tsx`

```typescript
interface Props {
  group: ChecklistGroup
  totalItems: number
  completedItems: number
  isCollapsed: boolean
  onToggleCollapse: () => void
  onRename: (name: string) => void
  onDelete: () => void
  isDragDisabled: boolean
}
```

Renders: drag handle, chevron (right/down), editable name, progress badge ("3/5"), delete button (on hover). Uses `useSortable` from @dnd-kit for group-level reorder.

### 6b. Checklist.tsx — Major Refactor

**New state:**
```typescript
const [groups, setGroups] = useState<ChecklistGroup[]>([])
const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
```

**Collapse state sync strategy:** Initialize `collapsedGroups` from DB `is_collapsed` on load. Toggle updates local state immediately (optimistic). Debounce-save collapse changes to DB via `CHECKLIST_GROUP_UPDATE` (500ms) — avoid IPC round-trip on every click. This keeps the UI snappy while persisting state across sessions.

**Render flow:**
1. Load groups via `CHECKLIST_GROUP_GET_ALL` alongside items
2. Compute `groupedItems: Map<number | null, ChecklistItemType[]>` — key is `group_id`
3. Render: ungrouped items first (if any), then groups sorted by `position`
4. Each group: header row → collapsible item list with `SortableContext` per group
5. Per-group progress badge: completed/total for that group
6. Each group gets inline "+ Add item" input at bottom
7. If all items are ungrouped (no groups exist), UI looks identical to today

### 6c. ChecklistToolbar.tsx

Add "+ Group" button next to Templates button. New prop: `onAddGroup: () => void`.

### 6d. ChecklistTemplateEditor.tsx

Add group sections: each group has name field + draggable items list. "Ungrouped" section for items outside groups. Drag items between groups.

## 7. DnD Implementation

Two levels of drag:

### Item drag (within and between groups):
- Multiple `SortableContext` (one per group + one for ungrouped)
- On `onDragEnd`: if item moved to different group's drop zone, call `CHECKLIST_MOVE_ITEM_TO_GROUP` then `CHECKLIST_REORDER`
- Custom `collisionDetection` that considers group boundaries

### Group drag (reorder groups):
- Group headers wrapped in `useSortable` with `type: 'group'` data attribute
- Items have `type: 'item'` data attribute
- `onDragStart` detects type and restricts drop targets accordingly

## 8. Export/PDF Changes

**File:** `src/main/export-pdf.ts`

1. Query groups: `SELECT * FROM checklist_groups WHERE row_id = ? ORDER BY position`
2. Group items by `group_id`
3. Render group headers as bold section labels in PDF
4. Ungrouped items render first without header

**File:** `src/renderer/components/profile/ProfilePrintLayout.tsx` — same grouping logic for print.

## 9. Keyboard Navigation

- **Tab** through group headers and items in order
- **Enter** on collapsed group header → expand; on group name → edit mode
- **Escape** from edit mode reverts
- **Arrow Up/Down** between items within group and between groups
- Collapsed group: arrow down skips to next group header
- **Ctrl+Shift+G** (within checklist): create new group

## 10. Migration Path

- Existing items get `group_id = NULL` (ALTER TABLE default)
- `group_id = NULL` items display in "Ungrouped" section
- If all items ungrouped, UI looks identical to today (no group headers)
- Group headers only appear when ≥1 group exists for that client
- No data migration needed beyond schema change

## 11. Undo/Redo

- Group create → undo deletes group (items become ungrouped)
- Group delete → undo recreates group and reassigns items (must snapshot item→group assignments)
- Move item to group → undo restores previous group_id
- **Template apply with groups → undo must delete created groups AND created items** (current undo for `handleApplyTemplate` only deletes items individually)
- All group operations logged as `category: 'structural'` in undoStore

## 12. Implementation Sequence

1. [x] Migration 028 (schema) + shared types
2. [x] IPC channels + handler implementation (group CRUD + modify existing)
3. [x] ChecklistGroupHeader component
4. [x] Checklist.tsx refactor (grouping logic, collapse, per-group progress)
5. [x] ChecklistToolbar.tsx (add group button)
6. [x] DnD within groups (cross-group drag deferred — needs custom collision detection)
7. [x] Template system v2 format (backend read/write; frontend save as v2 deferred)
8. [ ] ChecklistTemplateEditor.tsx groups support (deferred — templates work as v1 flat lists)
9. [x] Export/PDF updates
10. [ ] Keyboard navigation (Ctrl+Shift+G deferred — basic Tab/Enter works)
11. [x] Undo/redo for group operations

## 13. Test Scenarios

- [ ] Create group, rename, delete — items become ungrouped on delete
- [ ] Drag item between groups — group_id updates correctly
- [ ] Reorder groups — position persists across profile switches
- [ ] Collapse/expand group — state persists
- [ ] Apply v1 template (no groups) — items go to ungrouped
- [ ] Apply v2 template (with groups) — groups created, items assigned
- [ ] Create v2 template from existing grouped checklist
- [ ] Export PDF with grouped checklist — group headers in output
- [ ] 200+ items across 10+ groups — scroll performance
- [ ] Undo group delete — group + item assignments restored
- [ ] Keyboard: Tab through groups, Enter to expand, arrow navigation
- [ ] Existing data: no visible change for ungrouped items

## Critical Files

| File | Change |
|-|-|
| `src/main/migrations/028_checklist_groups.ts` | New migration |
| `src/main/ipc/ipc-checklists.ts` | Group CRUD handlers + modify existing |
| `src/shared/ipc-channels.ts` | 6 new channels |
| `src/shared/types.ts` | ChecklistGroup interface + extend ChecklistItem |
| `src/renderer/components/profile/Checklist.tsx` | Major refactor for grouped rendering |
| `src/renderer/components/profile/ChecklistGroupHeader.tsx` | New component |
| `src/renderer/components/profile/ChecklistToolbar.tsx` | Add group button |
| `src/renderer/components/profile/ChecklistTemplateEditor.tsx` | Group sections in template editor |
| `src/main/templates.ts` | v2 format validation |
| `src/main/export-pdf.ts` | Grouped PDF output |
