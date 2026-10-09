# Tasks & Checklists Unification Plan

Tasks (global) and Profile Checklists (per-client) should look and function identically. This plan covers: adding groups to tasks, removing category, unifying toolbar/UX, template-apply-to-group, and bug fixes.

---

## 1. Remove Category

Category is redundant now that groups exist. Remove from UI; leave DB columns in place (no migration needed).

### 1a. Checklist changes
- **`ChecklistToolbar.tsx`** (line 7): Remove `'category'` from `SortMode` type. Remove `{ key: 'category', label: 'Category' }` from sort options array (line 13).
- **`Checklist.tsx`** (line 116): Remove the category sort fallthrough branch in `activeItems` useMemo. After removing, the `else` should default to `manual` (identity sort) or be unreachable.
- **`ChecklistItem.tsx`** (lines 46, 52, 63, 91–92, 232–253): Remove the full inline category edit UI — state variable, ref, save handler, input field, display badge. This is ~30 lines of UI code.

### 1b. Task changes
- **`TasksView.tsx`** (line 44): Remove `{ key: 'category', label: 'Category' }` from sort options. Remove `sortedByCategory` memo (line 250). Remove `sortedByCategory.map(...)` render branch (line 439). Remove `category: item.category || null` from template import (line 579).
- **`taskStore.ts`** (line 7): Remove `'category'` from `TaskSortMode`.
- **`TaskFormDialog.tsx`**: Remove category text input field from form.
- **`TaskItem.tsx`**: Remove category badge and inline category edit UI (clickable text + inline input).

### 1c. Backward compat / edge case
- **`ipc-tasks.ts`**: Keep `category` in `TASK_UPDATE` allowlist and INSERT (existing data integrity). Just stop sending from UI.
- **`ipc-checklists.ts`**: Same.
- **Persisted sort mode**: If a user's stored `sortMode` is `'category'`, it will no longer match any pill. Add a guard: if loaded sortMode is not in the valid set, fallback to `'manual'`. Check `taskStore.ts` (default state) and `Checklist.tsx` (local state init). This prevents a broken UI for existing users.

---

## 2. Task Groups — Schema & Backend

### 2a. Migration 030 — `task_groups` table + `group_id` on `caseload_tasks`

**File:** `src/main/migrations/030_task_groups.ts`

```sql
CREATE TABLE IF NOT EXISTS task_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_collapsed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE caseload_tasks ADD COLUMN group_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_caseload_tasks_group ON caseload_tasks(group_id);
```

Schema version → 30. No `row_id` on task_groups (tasks are global). Register in `database.ts` and `tests/helpers.ts`.

### 2b. IPC Channels

**File:** `src/shared/ipc-channels.ts` — 6 new channels:

```
TASK_GROUP_GET_ALL: 'task:group-get-all'
TASK_GROUP_CREATE: 'task:group-create'
TASK_GROUP_UPDATE: 'task:group-update'
TASK_GROUP_DELETE: 'task:group-delete'
TASK_GROUP_REORDER: 'task:group-reorder'
TASK_MOVE_TO_GROUP: 'task:move-to-group'
```

### 2c. Shared Types

**File:** `src/shared/types.ts`

```typescript
export interface TaskGroup {
  id: number
  name: string
  position: number
  is_collapsed: 0 | 1
  created_at: string
}
```

Add `group_id: number | null` to `CaseloadTask`.

### 2d. IPC Handlers

**File:** `src/main/ipc/ipc-tasks.ts` — 6 new handlers mirroring checklist group pattern. Use `secureWrap`, `validId`, `ok`, `fail`, `buildSafeSetClause`, `enforceWritable` consistently.

- **TASK_GROUP_GET_ALL**: `SELECT * FROM task_groups ORDER BY position, id`
- **TASK_GROUP_CREATE**: `(name: string)` → validate name (non-empty, max 200 chars, trimmed). Insert with `position = (SELECT COALESCE(MAX(position), -1) + 1 FROM task_groups)`. Return created group.
- **TASK_GROUP_UPDATE**: `(groupId, updates)` → `buildSafeSetClause` for `name`, `position`, `is_collapsed`. Validate name length if present.
- **TASK_GROUP_DELETE**: Transaction: `UPDATE caseload_tasks SET group_id = NULL WHERE group_id = ?` then `DELETE FROM task_groups WHERE id = ?`
- **TASK_GROUP_REORDER**: `(orderedGroupIds: number[])` → validate all IDs are positive integers. Update position for each.
- **TASK_MOVE_TO_GROUP**: `(taskId, groupId: number | null)` → validate taskId. If groupId is not null, verify it exists in `task_groups`. Update `caseload_tasks SET group_id = ?`.

**Modify TASK_CREATE** (line 62): Accept optional `group_id` in input. Add to INSERT columns + VALUES. Scope `MAX(position)` to `WHERE group_id IS ?` (use SQLite `IS` for NULL equality).

**Modify TASK_REORDER**: No change needed — existing handler updates position by ID list regardless of group.

**Modify TASK_RESTORE** (lines 188-209): Add `group_id` to the INSERT column list and parameter interface (same pattern as CHECKLIST_RESTORE_ITEM fix from previous session).

---

## 3. Unified Toolbar

Both toolbars should render identically: Title + count | sort pills | + Add Task | + Group | Templates.

### 3a. Profile Checklist Toolbar

**File:** `ChecklistToolbar.tsx`

Current: Title "Checklist" + count | sort pills (Manual/Due Date/Priority/~~Category~~) | Group button | Templates.

Changes:
- Remove Category pill
- Add `+ Add Task` button (blue filled, matching TasksView style: `bg-blue-600 text-white hover:bg-blue-700 rounded px-3 py-1 text-sm font-medium`) between sort pills and Group button
- New prop: `onAddTask: () => void`
- Button order: [sort pills] [+ Add Task] [+ Group] [Templates]

### 3b. Tasks Toolbar

**File:** `TasksView.tsx` header section

Current: Title "Tasks" + count | sort pills (Manual/Due Date/Priority/~~Category~~) | + Add Task | Templates.

Changes:
- Remove Category pill
- Add `+ Group` button (FolderPlus icon, same style as checklist Group button) between + Add Task and Templates
- Button order: [sort pills] [+ Add Task] [+ Group] [Templates]

### 3c. Inline Input Text

**File:** `Checklist.tsx`

Change all placeholder text to match Tasks wording:
- Line 615: `"+ Add item to group…"` → `"+ Add task… (press Enter)"`
- Line 616: Fix `fontSize: 14` → `fontSize: 15` (violates 15px minimum rule)
- Line 646: `hasGroups ? '+ Add ungrouped item… (press Enter)' : '+ Add item… (press Enter)'` → `'+ Add task… (press Enter)'` (always same text regardless of groups)

**File:** `TasksView.tsx` — inline input already says `"+ Add task... (press Enter)"` — no change needed.

---

## 4. Task Groups — Frontend

### 4a. TasksView Refactor

**File:** `src/renderer/views/TasksView.tsx`

**New state:**
```typescript
const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([])
const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
const [groupAddTitles, setGroupAddTitles] = useState<Record<number, string>>({})
```

**Load flow:**
- On mount / refresh: `Promise.all([loadTasks(), loadTaskGroups()])`
- `loadTaskGroups`: invoke `TASK_GROUP_GET_ALL`, set state, initialize collapse from `is_collapsed`

**Render flow — `sortMode === 'manual'` only:**

Groups only display in manual sort mode. When sorted by due_date/priority, all tasks render flat (matching checklist behavior where groups are a manual-mode organizational tool).

1. Check `hasGroups = taskGroups.length > 0`
2. If no groups: current flat rendering (DndContext + SortableContext, unchanged)
3. If groups exist:
   - Ungrouped tasks first (group_id === null), in a SortableContext
   - Then each group sorted by position: GroupHeader → collapsible items in SortableContext → per-group add input
   - Group headers wrapped in their own SortableContext (see bug fix 7b)

**When sortMode !== 'manual':**
- Existing behavior: `due_date` shows Overdue/Due Today/This Week/Later TaskGroups (the date-based groups, not user groups). `priority` shows flat sorted list.
- Group headers hidden, assignments preserved in DB.

**Handlers** (mirror Checklist.tsx pattern):
- `handleAddGroup`, `handleRenameGroup`, `handleDeleteGroup`, `handleToggleCollapse`
- `handleInlineAdd` modified: accept optional `groupId`, pass to `createTask` call
- All group mutations push undo entries

### 4b. Make ChecklistGroupHeader generic

**File:** `src/renderer/components/profile/ChecklistGroupHeader.tsx`

**Problem:** Currently imports `ChecklistGroup` type directly. `TaskGroup` has the same shape minus `row_id`, but they're different TS types.

**Fix:** Change the `group` prop from `ChecklistGroup` to a minimal interface:
```typescript
interface GroupData {
  id: number
  name: string
  position: number
}
```
This is satisfied by both `ChecklistGroup` and `TaskGroup`. No other changes needed — component doesn't use `row_id` or `created_at`.

**Also:** Move component from `components/profile/` to `components/shared/GroupHeader.tsx` since it's now shared. Update imports in Checklist.tsx and TasksView.tsx.

### 4c. taskStore updates

**File:** `src/renderer/stores/taskStore.ts`

- Remove `'category'` from `TaskSortMode`. Add guard: if persisted sortMode is invalid, fallback to `'manual'`.
- Do NOT add group state to taskStore. Task groups are loaded/managed locally in TasksView (matching how Checklist.tsx manages groups with local useState, not a store). This keeps the pattern consistent and avoids store bloat.

---

## 5. Template Apply → Group Picker

### 5a. Flow

When user clicks "Apply" on a template (in TemplateManager), instead of immediately applying, show a group picker dropdown:

```
Apply to:
  ○ No group (ungrouped)
  ○ Group A
  ○ Group B
  ─────────────────────
  + Create new group...
```

- Reads existing group names from the parent component's groups state (passed as prop)
- "Create new group" shows inline text input; Enter confirms name
- After selection: create group if new → apply template with groupId

### 5b. GroupPicker Component

**File:** `src/renderer/components/shared/GroupPicker.tsx`

```typescript
interface GroupPickerProps {
  groups: Array<{ id: number; name: string }>
  onSelect: (groupId: number | null) => void
  onCreateAndSelect: (name: string) => void
  onCancel: () => void
}
```

Renders as a small positioned popover. Simple radio-button list + create-new section. 44px min click targets. Escape to cancel. Max height with scroll if many groups.

**Security:** Group name input: trim, max 200 chars, reject empty. Validation happens at IPC level too (defense in depth).

### 5c. Modify CHECKLIST_APPLY_TEMPLATE IPC

**File:** `src/main/ipc/ipc-checklists.ts`

Add third parameter `groupId?: number | null`:
```
CHECKLIST_APPLY_TEMPLATE(rowId, templateId, groupId?)
```

In the handler: if `groupId` is provided, set `group_id = groupId` on all inserted items. This is more efficient than inserting ungrouped then moving (one transaction vs N+1 updates).

### 5d. Task Template Apply

**Current state:** TasksView has NO `TASK_APPLY_TEMPLATE` IPC. It parses template JSON client-side and calls `createTask` per item (lines 571-579 in TasksView.tsx).

**New approach:** Create `TASK_APPLY_TEMPLATE` IPC handler in `ipc-tasks.ts`:
- Params: `(templateId: number, groupId?: number | null)`
- Reads template from `checklist_templates` table (shared with checklists)
- Parses items JSON (v1 flat array)
- Inserts all tasks in a single transaction with optional group_id
- Returns created task IDs for undo

Add `TASK_APPLY_TEMPLATE: 'task:apply-template'` to IPC channels.

This replaces the client-side per-item creation, which was: (a) not transactional, (b) harder to undo, (c) now needs group_id support.

### 5e. Undo

**Checklist template apply undo** (Checklist.tsx lines 462-491):
- Current: deletes each added item individually
- New: also delete `createdGroupId` if a new group was created during this apply
- Track `createdGroupId` in the undo closure

**Task template apply undo:**
- Same pattern: delete created tasks + created group if applicable

---

## 6. Simplify Template Format

Remove v2 template format. Templates are always flat item arrays. Group assignment is at apply-time.

### 6a. Backend

**File:** `src/main/templates.ts` (lines 99-115)
- `checklistItemsJson` validator: remove v2 object acceptance. Only validate as JSON array where each element is string or object.

**File:** `src/main/ipc/ipc-checklists.ts`
- `CHECKLIST_APPLY_TEMPLATE` (lines 168-226): Remove v2 parsing branch (group creation from template JSON). Replace with flat-array-only logic + optional `groupId` param.
- `CL_TEMPLATE_CREATE` validation (line ~320): Change error from `'Template items must be a JSON array or v2 format'` back to `'Template items must be a JSON array'`.
- `CL_TEMPLATE_UPDATE` validation: Same change.

### 6b. Tests

**File:** `tests/ipc-error-paths.test.ts`
- Revert expected error to `'Template items must be a JSON array'`

---

## 7. Bug Fixes

### 7a. Empty groups not showing

**File:** `Checklist.tsx`

**Root cause identified (lines 526-530):** The empty state check `activeItems.length === 0 && completedItems.length === 0` (line 526) renders "No checklist items yet" BEFORE the grouped rendering branch (line 530). When a group exists but has no items, the empty state takes precedence and groups are never rendered.

**Fix:** Change the condition to also check for groups:
```typescript
) : activeItems.length === 0 && completedItems.length === 0 && !hasGroups ? (
  <div>No checklist items yet...</div>
) : !hasGroups ? (
```

This way: if groups exist (even with zero items), we skip the empty state and enter the grouped rendering path, which correctly renders empty group headers with their per-group add-item inputs.

**Same pattern for TasksView** once groups are added.

### 7b. Group drag reorder broken

**File:** `Checklist.tsx`

**Root cause identified (two issues):**

1. **No SortableContext for group headers.** Group headers call `useSortable({ id: 'group-${id}' })` in ChecklistGroupHeader, but they're never registered in a `SortableContext`. Without registration, dnd-kit doesn't track them as sortable nodes — drag visually does nothing.

2. **`handleDragEnd` ignores group drags.** Lines 290-318: `activeItems.findIndex(i => i.id === active.id)` searches for numeric item IDs. Group IDs are strings like `"group-5"` → always returns -1 → handler returns early.

**Fix:**

Add a `SortableContext` wrapping all group headers:
```tsx
<SortableContext
  items={groups.sort((a, b) => a.position - b.position).map(g => `group-${g.id}`)}
  strategy={verticalListSortingStrategy}
>
  {groups.sort(...).map(group => (
    <div key={group.id}>
      <ChecklistGroupHeader ... />
      {!isCollapsed && (
        <SortableContext items={groupItems.map(i => i.id)} ...>
          ...items...
        </SortableContext>
      )}
    </div>
  ))}
</SortableContext>
```

Update `handleDragEnd` to detect group drags:
```typescript
const handleDragEnd = useCallback(async (event: DragEndEvent) => {
  const { active, over } = event
  if (!over || active.id === over.id) return

  const activeStr = String(active.id)
  const overStr = String(over.id)

  // Group reorder
  if (activeStr.startsWith('group-') && overStr.startsWith('group-')) {
    const activeGroupId = Number(activeStr.replace('group-', ''))
    const overGroupId = Number(overStr.replace('group-', ''))
    const sorted = [...groups].sort((a, b) => a.position - b.position)
    const oldIdx = sorted.findIndex(g => g.id === activeGroupId)
    const newIdx = sorted.findIndex(g => g.id === overGroupId)
    if (oldIdx === -1 || newIdx === -1) return
    const newOrder = arrayMove(sorted, oldIdx, newIdx)
    setGroups(newOrder.map((g, i) => ({ ...g, position: i })))
    await safeInvoke(IPC.CHECKLIST_GROUP_REORDER, rowId, newOrder.map(g => g.id))
    return
  }

  // Item reorder (existing logic)
  const activeIdx = activeItems.findIndex(i => i.id === active.id)
  ...
```

**Same pattern for TasksView** (using `TASK_GROUP_REORDER` instead, no `rowId` param).

### 7c. Group header rename UX

**File:** `ChecklistGroupHeader.tsx` (to be moved to `components/shared/GroupHeader.tsx`)

Current: double-click to edit (not discoverable).

**New UX:**
- Group name text has a subtle `border-b border-dotted border-slate-300 dark:border-slate-600` (visual hint it's editable)
- On hover: small pencil icon (Pencil from lucide, 14px) appears to the right of the name. Border changes to solid.
- **Single-click** on name or pencil → enters edit mode (input replaces text, auto-selected)
- On blur / Enter → save. Escape → cancel.
- **Newly created groups** (name === 'New Group') → auto-enter edit mode on first render with text selected. Use a `useEffect` that checks if name is 'New Group' and auto-focuses.

---

## 8. Implementation Sequence

Order chosen to minimize broken intermediate states and allow parallel agent work:

1. [ ] **Bug fix: empty groups** (Checklist.tsx line 526 — add `&& !hasGroups`)
2. [ ] **Bug fix: group drag** (Checklist.tsx — SortableContext for groups + handleDragEnd branch)
3. [ ] **Bug fix: rename UX** (ChecklistGroupHeader → single-click + pencil + dotted border)
4. [ ] **Move GroupHeader** to `components/shared/`, make generic (GroupData interface)
5. [ ] **Remove category** from UI (ChecklistToolbar, Checklist, ChecklistItem, TasksView, TaskFormDialog, TaskItem, taskStore). Add sortMode fallback guard.
6. [ ] **Migration 030** + shared types + IPC channels for task groups
7. [ ] **Task group IPC handlers** in ipc-tasks.ts (6 new + modify create/restore)
8. [ ] **Unify toolbar** (+ Add Task in Checklist, + Group in Tasks, button order)
9. [ ] **Unify inline input text** (checklist wording + 15px font fix)
10. [ ] **TasksView grouped rendering** (manual mode only, mirror Checklist pattern)
11. [ ] **Simplify template format** (remove v2 from backend, revert validators)
12. [ ] **TASK_APPLY_TEMPLATE IPC** (new handler, replaces client-side per-item creation)
13. [ ] **Modify CHECKLIST_APPLY_TEMPLATE** to accept optional groupId param
14. [ ] **GroupPicker component** (shared popover for template-apply-to-group)
15. [ ] **Wire GroupPicker** into Checklist.tsx + TasksView.tsx template apply flows
16. [ ] **Undo/redo** for task groups + template-apply-with-group (track createdGroupId)
17. [ ] **Update tests** (helpers migration030, error messages, Checklist.test.tsx, new group handler tests)

## 9. Critical Files

| File | Change |
|-|-|
| `src/main/migrations/030_task_groups.ts` | New migration |
| `src/main/ipc/ipc-tasks.ts` | 6 new group handlers + TASK_APPLY_TEMPLATE + modify create/restore |
| `src/main/ipc/ipc-checklists.ts` | Modify apply-template (accept groupId, remove v2) |
| `src/main/templates.ts` | Revert to v1-only validation |
| `src/shared/ipc-channels.ts` | 7 new channels (6 TASK_GROUP_* + TASK_APPLY_TEMPLATE) |
| `src/shared/types.ts` | TaskGroup interface, group_id on CaseloadTask |
| `src/renderer/views/TasksView.tsx` | Major: groups, remove category, toolbar, template apply |
| `src/renderer/views/tasks/TaskFormDialog.tsx` | Remove category field |
| `src/renderer/views/tasks/TaskItem.tsx` | Remove category display/edit |
| `src/renderer/stores/taskStore.ts` | Remove category sort, add sortMode fallback |
| `src/renderer/components/profile/Checklist.tsx` | Fix empty groups, fix drag, toolbar button, text, template groupId |
| `src/renderer/components/profile/ChecklistToolbar.tsx` | Remove category, add + Add Task button |
| `src/renderer/components/profile/ChecklistItem.tsx` | Remove category inline edit UI |
| `src/renderer/components/shared/GroupHeader.tsx` | Moved + generic + rename UX |
| `src/renderer/components/shared/GroupPicker.tsx` | New: template apply group selection |
| `tests/helpers.ts` | Add migration030 |
| `tests/ipc-error-paths.test.ts` | Revert template error message |

## 10. Risks & Mitigations

| Risk | Mitigation |
|-|-|
| Persisted `sortMode: 'category'` breaks UI | Fallback guard in both taskStore and Checklist.tsx |
| Group drag conflicts with item drag (same DndContext) | String-prefixed IDs (`group-N` vs numeric) + type check in handleDragEnd |
| TASK_APPLY_TEMPLATE replaces client-side logic | Ensure new IPC returns enough data for undo (created task IDs) |
| Template undo doesn't clean up created group | Track `createdGroupId` in undo closure |
| ChecklistGroupHeader move breaks imports | Search all import sites; only 1 currently (Checklist.tsx) + new TasksView |
| Tasks DndContext already exists for manual sort | Extend existing context with group SortableContext, don't add a second DndContext |
