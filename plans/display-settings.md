# Display & Appearance Settings — Implementation Plan

## Overview

Add comprehensive display customization to Settings > Appearance. All settings persist to the `settings` DB table via `SETTINGS_UPDATE` IPC and hydrate on unlock via `hydrateFromSettings`.

---

## Settings Inventory

### 1. UI Scale (zoom)
- **Key:** `ui_scale`
- **Type:** Range slider, 80% to 150%, step 5%
- **Default:** 100%
- **Mechanism:** Sets `zoom` CSS property on `<html>` element (Chromium supports this natively in Electron)
- **Why not font-size?** `zoom` scales everything proportionally — fonts, padding, borders, icons — without breaking layouts. Font-size would only scale text and leave spacing/icons unchanged.
- **Keyboard shortcut:** Ctrl+= (zoom in), Ctrl+- (zoom out), Ctrl+0 (reset to 100%)
- **Preview:** Live — changes apply immediately as slider moves
- **Persists:** On slider release (debounced 300ms)
- **Note:** At 80%, text goes below 15px spec minimum — add a note: "Smaller sizes may reduce readability"

### 2. Grid Density
- **Key:** `grid_density`
- **Values:** `compact` | `comfortable` | `spacious`
- **Default:** `comfortable`
- **Mechanism:** Sets `--row-height` CSS variable on `:root`
  - compact: 36px (existing `--height-row-compact`)
  - comfortable: 44px (existing `--height-row-comfortable`, current default)
  - spacious: 52px (existing `--height-row-spacious`)
- **Also adjusts:** `--cell-padding` (new variable): compact=6px, comfortable=12px, spacious=16px
- **UI:** Three toggle buttons with visual preview (like theme picker)
- **Affects:** Grid cells, task rows, contact rows — anything using `.grid-cell` or `--row-height`
- **Does NOT affect:** Buttons, inputs, modals (those stay at 44px min-height always)

### 3. Sidebar Width
- **Key:** `sidebar_width`
- **Values:** `narrow` | `normal` | `wide`
- **Default:** `normal`
- **Mechanism:** Sets `--width-sidebar-expanded` CSS variable
  - narrow: 180px
  - normal: 220px (current)
  - wide: 280px
- **UI:** Three toggle buttons
- **Note:** Collapsed sidebar always stays at 48px regardless of this setting

### 4. Row Striping
- **Key:** `row_striping`
- **Type:** Toggle (on/off)
- **Default:** off
- **Mechanism:** When on, add `.striped-rows` class to the grid container. CSS rule:
  ```css
  .striped-rows [data-row-index]:nth-child(even) {
    background-color: var(--bg-stripe);
  }
  ```
  - Light: `--bg-stripe: #F8FAFC` (slate-50)
  - Dark: `--bg-stripe: #1E293B` (slate-800)
- **Note:** Stripe color must not conflict with alert colors. Alert bg always wins (applied inline).

### 5. Grid Lines
- **Key:** `grid_lines`
- **Values:** `full` | `horizontal` | `none`
- **Default:** `full`
- **Mechanism:** CSS class on grid container
  - `full`: current behavior (border-r + border-b on cells)
  - `horizontal`: border-b only, no border-r
  - `none`: no cell borders (only header border-b remains)
- **UI:** Three toggle buttons with small visual preview icons

### 6. Reduced Motion (bonus)
- **Key:** `reduced_motion`
- **Type:** Toggle (on/off)
- **Default:** off (respects OS `prefers-reduced-motion` by default)
- **Mechanism:** When on, adds `.reduce-motion` class to `<html>`, CSS:
  ```css
  .reduce-motion *, .reduce-motion *::before, .reduce-motion *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
  ```
- **Note:** This is an in-app override for users whose OS doesn't expose the setting

### 7. High Contrast Mode (bonus)
- **Key:** `high_contrast`
- **Type:** Toggle (on/off)
- **Default:** off (respects OS `prefers-contrast: more` by default)
- **Mechanism:** When on, adds `.high-contrast` class to `<html>`, same rules as existing `@media (prefers-contrast: more)` block but triggered by class instead of media query
- **Note:** Useful for users on systems that don't expose high-contrast toggle at OS level

### 8. Clock Format (bonus)
- **Key:** `clock_format`
- **Values:** `12h` | `24h`
- **Default:** `12h`
- **UI:** Two toggle buttons
- **Affects:** Activity timeline timestamps, case log timestamps, task due times
- **Mechanism:** Utility function `formatTime(date, format)` checks this setting

### 9. Week Start Day (bonus)
- **Key:** `week_start`
- **Values:** `sunday` | `monday`
- **Default:** `sunday`
- **UI:** Two toggle buttons
- **Affects:** Dashboard "This Week" calculations, any weekly grouping
- **Mechanism:** Passed to date-fns `startOfWeek` options

---

## Implementation Details

### A. Settings Store Changes (`settingsStore.ts`)

Add new fields to `SettingsState`:

```typescript
// Display settings
uiScale: number           // 80-150, default 100
gridDensity: 'compact' | 'comfortable' | 'spacious'
sidebarWidth: 'narrow' | 'normal' | 'wide'
rowStriping: boolean
gridLines: 'full' | 'horizontal' | 'none'
reducedMotion: boolean
highContrast: boolean
clockFormat: '12h' | '24h'
weekStart: 'sunday' | 'monday'
```

Add setters for each. Update `hydrateFromSettings` to parse these from the settings record.

### B. CSS Variable Application (`App.tsx`)

Add a `useEffect` that watches display settings and applies them to `document.documentElement`:

```typescript
useEffect(() => {
  const root = document.documentElement

  // UI Scale
  root.style.zoom = `${uiScale}%`

  // Grid density
  const rowHeights = { compact: '36px', comfortable: '44px', spacious: '52px' }
  const cellPaddings = { compact: '6px', comfortable: '12px', spacious: '16px' }
  root.style.setProperty('--row-height', rowHeights[gridDensity])
  root.style.setProperty('--cell-padding', cellPaddings[gridDensity])

  // Sidebar width
  const sidebarWidths = { narrow: '180px', normal: '220px', wide: '280px' }
  root.style.setProperty('--width-sidebar-expanded', sidebarWidths[sidebarWidth])

  // Grid lines
  root.classList.toggle('grid-lines-horizontal', gridLines === 'horizontal')
  root.classList.toggle('grid-lines-none', gridLines === 'none')

  // Row striping
  root.classList.toggle('striped-rows', rowStriping)

  // Reduced motion
  root.classList.toggle('reduce-motion', reducedMotion)

  // High contrast
  root.classList.toggle('high-contrast', highContrast)
}, [uiScale, gridDensity, sidebarWidth, gridLines, rowStriping, reducedMotion, highContrast])
```

### C. CSS Additions (`globals.css`)

```css
/* Row striping */
:root {
  --bg-stripe: #F8FAFC;
}
.dark {
  --bg-stripe: rgba(30, 41, 59, 0.5);
}
.striped-rows [data-row-index]:nth-child(even) .grid-cell {
  background-color: var(--bg-stripe);
}

/* Grid line modes */
.grid-lines-horizontal .grid-cell { border-right-color: transparent; }
.grid-lines-none .grid-cell { border-right-color: transparent; border-bottom-color: transparent; }

/* App-level reduced motion (mirrors prefers-reduced-motion) */
.reduce-motion *, .reduce-motion *::before, .reduce-motion *::after {
  transition-duration: 0.01ms !important;
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
}

/* App-level high contrast (mirrors prefers-contrast: more) */
.high-contrast { /* duplicate the existing @media (prefers-contrast: more) rules */ }

/* Cell padding variable */
.grid-cell { padding-left: var(--cell-padding, 12px); padding-right: var(--cell-padding, 12px); }
```

### D. Keyboard Shortcuts

| Shortcut | Action | Where handled |
|-|-|-|
| Ctrl+= | Zoom in (scale +5%) | App.tsx global keydown |
| Ctrl+- | Zoom out (scale -5%) | App.tsx global keydown |
| Ctrl+0 | Reset zoom to 100% | App.tsx global keydown |

These are standard browser zoom shortcuts — users expect them. We intercept and apply to our `uiScale` setting instead of Electron's built-in zoom (which we'll disable).

### E. Settings UI Layout (`SettingsView.tsx` — Appearance section)

Reorganize the Appearance section into subsections:

```
Appearance
├── Theme (existing: Light / Dark / System)
├── UI Scale
│   └── Slider 80%—150% with current value label + Reset button
├── Grid Display
│   ├── Density: [Compact] [Comfortable] [Spacious]
│   ├── Row Striping: toggle
│   └── Grid Lines: [Full] [Horizontal] [None]
├── Sidebar Width: [Narrow] [Normal] [Wide]
├── Date & Time
│   ├── Date Format (existing: US / ISO / EU)
│   ├── Clock Format: [12-hour] [24-hour]
│   └── Week Starts On: [Sunday] [Monday]
└── Accessibility
    ├── Reduced Motion: toggle
    └── High Contrast: toggle
```

Each subsection separated by a subtle border-t divider.

### F. DataGrid Integration

- `data-row-index` attribute must be on each row element for striping CSS to work
- Alert inline styles must use `!important` or be applied after stripe (inline styles naturally win)
- Verify `.grid-cell` padding uses `var(--cell-padding)` instead of hardcoded `px-3`

### G. Sidebar Integration

- Sidebar already reads `--width-sidebar-expanded` — verify this
- If sidebar width is hardcoded anywhere, replace with the CSS variable

### H. Clock Format Utility

Add to `src/renderer/utils/formatters.ts` (or create if needed):

```typescript
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const format = useSettingsStore.getState().clockFormat
  if (format === '24h') {
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
```

Update all timestamp formatting in:
- `ActivityTimeline.tsx`
- `CaseLogEntry.tsx`
- `TaskItem.tsx`
- `ContactInteractionLog.tsx`

### I. Week Start Utility

Update `DashboardView.tsx` "This Week" tab and any `startOfWeek` / `endOfWeek` calls to pass `{ weekStartsOn: weekStart === 'monday' ? 1 : 0 }`.

---

## Files to Modify

| File | Changes |
|-|-|
| `src/renderer/stores/settingsStore.ts` | Add 9 new display fields + setters + hydration |
| `src/renderer/views/SettingsView.tsx` | Expand Appearance section with new controls |
| `src/renderer/App.tsx` | useEffect to apply CSS variables/classes from settings |
| `src/renderer/styles/globals.css` | New CSS rules for striping, grid lines, reduced motion, high contrast, cell padding variable |
| `src/renderer/components/grid/DataGrid.tsx` | Add `data-row-index` to rows; use `--cell-padding` variable |
| `src/renderer/components/layout/Sidebar.tsx` | Verify uses CSS variable for width |
| `src/renderer/components/shared/KeyboardShortcutsModal.tsx` | Add zoom shortcuts to shortcut list |
| `src/renderer/utils/formatTime.ts` | New file: clock format utility |
| `src/renderer/views/DashboardView.tsx` | Week start day for "This Week" tab |

## Files to Read (not modify)

| File | Why |
|-|-|
| `src/renderer/components/profile/ActivityTimeline.tsx` | Find timestamp formatting to update |
| `src/renderer/components/profile/CaseLogEntry.tsx` | Find timestamp formatting |
| `src/renderer/components/tasks/TaskItem.tsx` | Find timestamp formatting |
| `src/renderer/components/contacts/ContactInteractionLog.tsx` | Find timestamp formatting |

---

---

## 10. Custom Group Buckets

### Concept

Current grouping creates one group per unique value (e.g., grouping by Acuity shows O, E, HE, + as 4 separate groups). Custom group buckets let users combine multiple values into named groups.

**Example:** User creates two custom buckets for Acuity:
- "Outreach" → contains: O
- "Active Caseload" → contains: E, HE, +

Or three buckets:
- "Outreach" → O
- "Standard" → E, HE
- "Intensive" → +

Rows whose values don't match any bucket go into an auto-generated "Other" group at the bottom.

### Data Model

Store custom group definitions per grid in the `settings` table as JSON:

**Key:** `custom_groups_{gridId}`
**Value:**
```json
[
  {
    "id": "cg_1709123456",
    "name": "Active Caseload Grouping",
    "columnId": "__acuity__",
    "buckets": [
      { "label": "Outreach", "values": ["O"], "color": "#3B82F6" },
      { "label": "Active Caseload", "values": ["E", "HE", "+"], "color": "#22C55E" }
    ]
  },
  {
    "id": "cg_1709123789",
    "name": "Status Grouping",
    "columnId": 42,
    "buckets": [
      { "label": "Open Cases", "values": ["Active", "In Progress", "Pending"] },
      { "label": "Closed Cases", "values": ["Closed", "Inactive"] }
    ]
  }
]
```

### TypeScript Types

```typescript
interface CustomGroupBucket {
  label: string
  values: string[]      // column values that belong in this bucket
  color?: string        // optional accent color for the group header
}

interface CustomGroupDef {
  id: string                    // unique id (timestamp-based)
  name: string                  // user-facing name shown in the Group By picker
  columnId: number | string     // column id or '__acuity__'
  buckets: CustomGroupBucket[]  // 2+ buckets
}
```

### UI: Creating Custom Groups

**Entry point:** In the GroupingBar dropdown, add a "Custom groups..." option at the bottom (with a Pencil/Settings icon). This opens a **CustomGroupEditor** modal.

**CustomGroupEditor modal:**
1. **Choose column** — dropdown of groupable columns + Acuity
2. **Preview of unique values** — shows all distinct values currently in that column (fetched from grid data)
3. **Bucket builder:**
   - Each bucket is a named row with a text input (label) and a multi-select of values
   - "Add bucket" button to add more (minimum 2)
   - Drag values between buckets, or click to toggle
   - Values not assigned to any bucket shown in a gray "Unassigned" pool
   - Optional: color picker per bucket (small swatch)
4. **Save** — persists to settings table
5. **Saved custom groups** listed in the GroupingBar dropdown alongside regular columns

**Quick-create flow:** When grouping is active (standard group-by), show a "Customize groups..." link in the toolbar that opens the editor pre-populated with the current column and its values split into current groups.

### UI: Applying Custom Groups

In the GroupingBar dropdown, custom groups appear in a "Custom" section:

```
Group by
─────────────
Remove grouping
─────────────
⬡ Acuity                    level
⬡ Status                    dropdown
⬡ Priority                  dropdown
─────────────
★ Active Caseload Grouping   custom
★ Status Grouping            custom
─────────────
⚙ Manage custom groups...
```

When a custom group is selected, `groupByColumnId` is replaced by a new `customGroupId` field in gridStore (or we set `groupByColumnId` to a special key like `__custom_cg_1709123456__`).

### DataGrid Integration

In the `displayItems` memo, add a branch before the standard grouping logic:

```typescript
// Custom group bucketing
if (activeCustomGroup) {
  const bucketMap = new Map<string, { label: string; indices: number[] }>()
  // Initialize buckets in order
  for (const bucket of activeCustomGroup.buckets) {
    bucketMap.set(bucket.label, { label: bucket.label, indices: [] })
  }
  bucketMap.set('__other__', { label: 'Other', indices: [] })

  tableRows.forEach((tr, i) => {
    const raw = getValueForGrouping(tr, activeCustomGroup.columnId)
    let matched = false
    for (const bucket of activeCustomGroup.buckets) {
      if (bucket.values.includes(raw)) {
        bucketMap.get(bucket.label)!.indices.push(i)
        matched = true
        break
      }
    }
    if (!matched) bucketMap.get('__other__')!.indices.push(i)
  })

  // Build display items (skip empty buckets)
  const items: DisplayItem[] = []
  for (const [key, { label, indices }] of bucketMap) {
    if (indices.length === 0) continue
    items.push({ kind: 'group-header', value: label, count: indices.length, groupKey: key, isCollapsed: collapsedGroups.has(key) })
    if (!collapsedGroups.has(key)) {
      for (const i of indices) items.push({ kind: 'row', tableRowIndex: i })
    }
  }
  return items
}
```

### Grid Store Changes

```typescript
// In GridState:
customGroups: CustomGroupDef[]          // all saved custom groups for current grid
activeCustomGroupId: string | null      // currently active custom group (null = standard grouping)

// Actions:
loadCustomGroups: (gridId: number) => void
saveCustomGroup: (gridId: number, def: CustomGroupDef) => void
deleteCustomGroup: (gridId: number, defId: string) => void
setActiveCustomGroupId: (id: string | null) => void
```

When `activeCustomGroupId` is set, it takes precedence over `groupByColumnId`.

### Persistence

- Custom group definitions: stored in `settings` table as `custom_groups_{gridId}` (JSON string)
- Active custom group selection: stored in per-grid config alongside `groupByColumnId`
- Loaded when grid loads (in `loadGrid`)

### Files to Modify (in addition to display settings files)

| File | Changes |
|-|-|
| `src/renderer/stores/gridStore.ts` | Add `customGroups`, `activeCustomGroupId`, load/save/delete actions |
| `src/renderer/components/grid/GroupingBar.tsx` | Add "Custom" section, "Manage custom groups" link |
| `src/renderer/components/grid/CustomGroupEditor.tsx` | New file: modal for creating/editing custom group buckets |
| `src/renderer/components/grid/DataGrid.tsx` | Add custom group branch in `displayItems` memo |
| `src/shared/types.ts` | Add `CustomGroupBucket`, `CustomGroupDef` types |

### Testing Checklist (Custom Groups)

- [ ] Create a 2-bucket custom group (e.g., Acuity O vs E/HE/+)
- [ ] Create a 3+ bucket custom group
- [ ] Rows not matching any bucket appear in "Other"
- [ ] Empty buckets are hidden (no empty group headers)
- [ ] Custom group persists across page navigation
- [ ] Custom group persists across lock/unlock
- [ ] Editing a custom group updates the active view immediately
- [ ] Deleting the active custom group falls back to no grouping
- [ ] Custom groups work with Acuity column
- [ ] Custom groups work with dropdown columns
- [ ] Custom groups work alongside filters (filter first, then group)
- [ ] Collapsing/expanding custom group headers works
- [ ] Row count in group headers is correct

---

## 11. Bulk Acuity Assignment

### Problem

Currently, changing acuity on one row only affects that row. When multiple rows are selected (checkboxes), the user expects the acuity change to apply to all selected rows — like how bulk archive/delete/move already work.

### Current Architecture

- `AcuityBadge` component renders per-row, receives `onSetLevel: (levelId: number | null) => void`
- In DataGrid's SortableRow: `onSetLevel={levelId => onSetAcuityLevel(rowId, levelId)}`
- `onSetAcuityLevel` maps to `gridStore.setRowAcuityLevel(rowId, levelId)` — single row
- `selectedRowIds` is a `Set<number>` state in DataGrid, not passed to AcuityBadge
- Bulk action bar (fixed bottom bar) already exists with Archive, Move, Delete buttons

### Implementation

**Two approaches (both should work):**

#### A. Inline Acuity Badge (when clicking badge on a selected row)

When a user clicks the acuity badge on a row that is part of a multi-selection, apply the chosen level to ALL selected rows.

**Changes to DataGrid's SortableRow:**

```typescript
// Current:
onSetLevel={levelId => onSetAcuityLevel(rowId, levelId)}

// New:
onSetLevel={levelId => {
  if (selectedRowIds.has(rowId) && selectedRowIds.size > 1) {
    onBulkSetAcuityLevel(Array.from(selectedRowIds), levelId)
  } else {
    onSetAcuityLevel(rowId, levelId)
  }
}}
```

This means `selectedRowIds` needs to be passed into SortableRow (it already receives `isSelected`).

**AcuityBadge visual hint:** When the row is part of a multi-selection, show a small count badge or tooltip: "Apply to 5 selected clients". This can be done by passing `bulkCount?: number` to AcuityBadge.

#### B. Bulk Action Bar Button

Add an "Assign Acuity" button to the bulk action bar (the fixed bottom bar that appears when rows are selected). Clicking it opens a dropdown with acuity levels.

**This is simpler and more discoverable.** The user sees the button alongside Archive/Move/Delete.

### Recommended: Both A and B

- **B (bulk bar button)** is the primary, discoverable way
- **A (inline badge)** is the power-user shortcut — you're already looking at a badge, just click it

### Grid Store Changes

Add `bulkSetRowAcuityLevel` action:

```typescript
bulkSetRowAcuityLevel: async (rowIds: number[], levelId: number | null) => {
  // Save previous levels for undo
  const prevLevels = new Map<number, number | null>()
  for (const id of rowIds) {
    const row = get().rows.find(r => r.row_id === id)
    prevLevels.set(id, row?.acuity_level_id ?? null)
  }

  // Optimistic update all rows
  set(s => ({
    rows: s.rows.map(r => rowIds.includes(r.row_id) ? { ...r, acuity_level_id: levelId } : r)
  }))

  try {
    // Batch IPC call
    await invoke(IPC.ACUITY_BULK_SET_LEVEL, rowIds, levelId)

    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Set acuity for ${rowIds.length} client${rowIds.length !== 1 ? 's' : ''}`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'gauge',
      undo: async () => {
        // Restore each row's previous level
        for (const [rid, prevId] of prevLevels) {
          await get().setRowAcuityLevel(rid, prevId)
        }
      },
      redo: async () => {
        await get().bulkSetRowAcuityLevel(rowIds, levelId)
      },
    })
  } catch (err) {
    // Rollback
    set(s => ({
      rows: s.rows.map(r => {
        if (prevLevels.has(r.row_id)) {
          return { ...r, acuity_level_id: prevLevels.get(r.row_id)! }
        }
        return r
      })
    }))
    console.error('Bulk acuity set failed:', err)
  }
}
```

### IPC: ACUITY_BULK_SET_LEVEL

New IPC channel in `ipc-channels.ts`:

```typescript
ACUITY_BULK_SET_LEVEL: 'acuity:bulk-set-level'
```

Handler in main process (ipc-row.ts or similar):

```typescript
secureHandle(IPC.ACUITY_BULK_SET_LEVEL, (_e, rowIds: number[], levelId: number | null) => {
  const stmt = db.prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?')
  const run = db.transaction(() => {
    for (const rowId of rowIds) {
      stmt.run(levelId, rowId)
    }
  })
  run()
  return ok(true)
})
```

### Bulk Action Bar UI

Add between "Move to caseload..." and "Delete" buttons:

```tsx
{acuityEnabled && (
  <div className="relative">
    <button
      className="text-sm px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors font-medium"
      onClick={() => setBulkAcuityOpen(v => !v)}
    >
      Set Acuity
    </button>
    {bulkAcuityOpen && (
      <div className="absolute bottom-full left-0 mb-2 bg-white dark:bg-slate-800 border rounded-lg shadow-xl py-1 w-44">
        {acuityLevels.map(level => (
          <button
            key={level.id}
            onClick={async () => {
              await bulkSetRowAcuityLevel(Array.from(selectedRowIds), level.id)
              setBulkAcuityOpen(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
            style={{ minHeight: 36 }}
          >
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: level.color }} />
            <span>{level.name}</span>
            <span className="text-slate-400 ml-auto">{level.points} pts</span>
          </button>
        ))}
        <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
        <button
          onClick={async () => {
            await bulkSetRowAcuityLevel(Array.from(selectedRowIds), null)
            setBulkAcuityOpen(false)
          }}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          None (remove acuity)
        </button>
      </div>
    )}
  </div>
)}
```

### Files to Modify

| File | Changes |
|-|-|
| `src/shared/ipc-channels.ts` | Add `ACUITY_BULK_SET_LEVEL` |
| `src/main/ipc/ipc-row.ts` (or ipc-grid.ts) | Add bulk set handler (transaction) |
| `src/renderer/stores/gridStore.ts` | Add `bulkSetRowAcuityLevel` action |
| `src/renderer/components/grid/DataGrid.tsx` | Pass selectedRowIds to SortableRow; add "Set Acuity" to bulk bar; modify onSetLevel callback to detect multi-selection |
| `src/renderer/components/grid/AcuityBadge.tsx` | Add optional `bulkCount` prop for visual hint |

### Testing Checklist (Bulk Acuity)

- [ ] Select 3 rows, click acuity badge on one → all 3 get that level
- [ ] Select 5 rows, use bulk bar "Set Acuity" → all 5 updated
- [ ] Undo restores each row's previous individual acuity level
- [ ] Redo re-applies the bulk level
- [ ] Setting acuity to "None" in bulk clears all selected
- [ ] Acuity points total in toolbar/status bar updates immediately
- [ ] Works with single row selected (no behavior change from current)
- [ ] Works when no rows selected (normal single-row badge behavior)
- [ ] Bulk bar "Set Acuity" button only visible when acuity is enabled

---

## Testing Checklist

- [ ] UI Scale slider changes all text/UI proportionally
- [ ] Ctrl+=/-/0 shortcuts work for zoom
- [ ] Grid density changes row height in real-time
- [ ] Compact density doesn't clip text in cells
- [ ] Row striping doesn't conflict with alert colors
- [ ] Row striping respects dark mode
- [ ] Grid lines: horizontal mode looks clean
- [ ] Grid lines: none mode still has header border
- [ ] Sidebar width changes are smooth (no layout jank)
- [ ] Reduced motion stops all animations
- [ ] High contrast thickens borders and outlines
- [ ] Clock format changes timestamps everywhere
- [ ] Week start changes Dashboard "This Week" grouping
- [ ] All settings persist across lock/unlock
- [ ] All settings persist across app restart
- [ ] Settings load correctly on fresh install (defaults)
- [ ] Zoom doesn't cause horizontal scrollbar in main layout
- [ ] Print layout ignores zoom/density (uses its own sizing)
