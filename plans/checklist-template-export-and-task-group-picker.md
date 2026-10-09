# Plan: Checklist Template Export/Import + Task Group Picker

## Feature A: Checklist Template File Export/Import

### Goal
Make checklist templates shareable as `.pulse-checklist` JSON files so teams can standardize workflows (intake, discharge, etc.).

### File Format
```json
{
  "pulse_type": "checklist-template",
  "version": 1,
  "template": {
    "name": "Intake Checklist",
    "description": "Standard intake procedure",
    "items": [
      { "title": "Verify identity", "priority": "normal" },
      { "title": "Collect insurance info", "priority": "high" }
    ],
    "is_recurring": 0,
    "recurrence_days": null
  }
}
```

- `pulse_type` + `version` for forward compatibility and to distinguish from `.pulse` grid templates
- `items` is the parsed array (not the raw JSON string from DB) for human readability
- No `id`, `is_system`, `created_at` — just the portable structure

### Implementation

#### 1. No new IPC needed
- Use existing `APP_SHOW_SAVE_DIALOG` / `APP_SHOW_OPEN_DIALOG` for file dialogs
- Use existing `APP_READ_FILE` / `APP_WRITE_FILE` for reading/writing (check if these exist, otherwise use `fs` via new IPC)
- Template data is already in the renderer from `CL_TEMPLATE_GET_ALL`; export = serialize + write
- Import = read file + validate + call `CL_TEMPLATE_CREATE`

**Check:** Do `APP_READ_FILE` / `APP_WRITE_FILE` IPC channels exist? If not, add them or use a dedicated `CL_TEMPLATE_EXPORT` / `CL_TEMPLATE_IMPORT` IPC pair that handles file I/O in main process (more secure, no need for renderer file access).

**Decision:** Add two new IPC channels:
- `CL_TEMPLATE_EXPORT` — takes template id + file path, writes JSON to disk
- `CL_TEMPLATE_IMPORT` — takes file path, reads + validates JSON, creates template, returns it

This keeps file I/O in the main process (security best practice).

#### 2. New IPC channels (ipc-channels.ts)
```typescript
CL_TEMPLATE_EXPORT: 'checklist-template:export',
CL_TEMPLATE_IMPORT: 'checklist-template:import',
```

#### 3. IPC contract (ipc-contract.ts)
```typescript
'checklist-template:export': { args: [id: number, filePath: string]; return: true }
'checklist-template:import': { args: [filePath: string]; return: ChecklistTemplate }
```

#### 4. Main process handlers (ipc-checklists.ts)

**Export handler:**
- Look up template by id
- Build export object (parse items JSON → array, strip DB-only fields)
- `writeFileSync(filePath, JSON.stringify(exportObj, null, 2))`
- Validate filePath has `.pulse-checklist` extension

**Import handler:**
- `readFileSync(filePath, 'utf-8')`
- Parse JSON, validate `pulse_type === 'checklist-template'` and `version === 1`
- Validate template.name (string, non-empty, max 200 chars)
- Validate template.items (array, each has title string)
- Check for name conflict → if exists, append " (imported)" or " (2)" etc.
- Stringify items array back to JSON string
- INSERT via same logic as CL_TEMPLATE_CREATE
- Return created ChecklistTemplate

#### 5. UI changes (TemplateManagerView.tsx)

Add to the Checklist Templates section header (next to "New Checklist" button):
- **Import button** (Upload icon) — opens file dialog filtered to `.pulse-checklist`, calls import IPC, refreshes list, shows toast
- **Export button on each row** (Download icon) — in ChecklistTemplateRow actions, opens save dialog with default filename = `{template-name}.pulse-checklist`, calls export IPC, shows toast

#### 6. ChecklistTemplateRow changes
Add a Download/Export icon button to the actions column (alongside edit/delete).

### Files to modify
| File | Change |
|-|-|
| `src/shared/ipc-channels.ts` | Add `CL_TEMPLATE_EXPORT`, `CL_TEMPLATE_IMPORT` |
| `src/shared/ipc-contract.ts` | Add type contracts for both |
| `src/main/ipc/ipc-checklists.ts` | Add export + import handlers |
| `src/renderer/views/TemplateManagerView.tsx` | Add Import button in header, export handler |
| `src/renderer/views/template-manager/ChecklistTemplateRow.tsx` | Add Export button in actions |

---

## Feature B: Group Picker in Tasks Module Add/Edit Dialog

### Goal
Add a Group dropdown to `TaskFormDialog` (identical to the one in `ChecklistAddDialog`) so users can assign tasks to groups from the add/edit modal.

### Current State
- `TaskFormDialog` has: Title, Notes, Priority, Due Date, Repeat — but NO Group
- `ChecklistAddDialog` has all the same fields PLUS a Group picker (shown only when groups exist)
- `TasksView` already loads `taskGroups` state and has full group CRUD
- `CaseloadTask` type already has `group_id: number | null`
- `createTask` / `updateTask` in taskStore already pass `group_id` through to IPC

### Implementation

#### 1. TaskFormDialog changes (TaskFormDialog.tsx)

**New props:**
```typescript
export interface TaskFormDialogProps {
  onClose: () => void
  onSave: (task: Omit<CaseloadTask, 'id' | 'created_at' | 'updated_at'>) => void
  initial?: Partial<CaseloadTask>
  groups?: TaskGroupType[]  // NEW — pass from TasksView
}
```

**New state:**
```typescript
const [groupId, setGroupId] = useState<number | null>(initial?.group_id ?? null)
```

**New UI block** (between Due Date row and Repeat row, matching ChecklistAddDialog):
```tsx
{groups && groups.length > 0 && (
  <div>
    <label className="...">Group</label>
    <select value={groupId ?? ''} onChange={e => setGroupId(e.target.value ? parseInt(e.target.value) : null)} className="input w-full">
      <option value="">-- Ungrouped --</option>
      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  </div>
)}
```

**Update handleSave output:**
Add `group_id: groupId ?? null` to the returned object (currently it's omitted, which means it falls through as undefined).

#### 2. TasksView changes (TasksView.tsx)

Pass `groups={taskGroups}` to `TaskFormDialog`:
```tsx
<TaskFormDialog
  onClose={...}
  onSave={handleSaveTask}
  initial={editingTask ?? undefined}
  groups={taskGroups}  // NEW
/>
```

### Files to modify
| File | Change |
|-|-|
| `src/renderer/views/tasks/TaskFormDialog.tsx` | Add `groups` prop, `groupId` state, Group picker UI, include `group_id` in save output |
| `src/renderer/views/TasksView.tsx` | Pass `groups={taskGroups}` to TaskFormDialog |

---

## Testing Notes
- Export a checklist template → verify .pulse-checklist file is valid JSON with correct structure
- Import the exported file → verify template appears in list with correct name/items
- Import with duplicate name → verify name gets deduplicated
- Import invalid/corrupt file → verify user-friendly error message
- Add task with group selected → verify task appears in correct group
- Edit task → verify group picker shows current group, can change it
- Add task when no groups exist → verify group picker is hidden
