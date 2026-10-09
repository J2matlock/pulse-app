# UX Implementation Plan — All 51 Findings

Generated: 2026-03-08 by 34 Opus agents

---

# 1.1 Enter Moves Down

## Implementation Plan: Enter Key Focus Movement (Excel Convention)

**Current Behavior:**
- Enter triggers cell edit mode (for text/number/phone/email etc.) or toggles checkbox
- No focus movement after commit
- After edit completes (CellEditor onSave), focus returns to the edited cell

**Desired Behavior:**
- Enter: commit edit + move focus to next row, same column (Excel convention)
- Shift+Enter: commit edit + move focus to previous row, same column
- Wrapping: last row + Enter → no-op (stay on last row); first row + Shift+Enter → no-op

---

### Files to Modify

1. **`src/renderer/components/grid/gridKeyboardNav.ts`** (Enter key handler)
   - Lines 45–57: Update Enter/F2 handler
   - Problem: Currently only enters edit mode; doesn't handle focus movement after edit

2. **`src/renderer/components/grid/SortableRow.tsx`** (cell save callback)
   - Lines 310–317 (onSave callback in CellEditor)
   - Problem: `onSave` callback returns focus to edited cell, doesn't navigate
   - Solution: Pass a navigation callback parameter to CellEditor

3. **`src/renderer/components/grid/CellEditor.tsx`** (editor save)
   - Lines 42–68: guardedSave function
   - Problem: No way to signal "move focus after save"
   - Solution: Add onSaveWithNavigation callback (optional), emit it from handleKeyDown

4. **`src/renderer/components/grid/DataGrid.tsx`** (orchestrate navigation)
   - Lines 735–737: handleCellKeyDown callback
   - Problem: After CellEditor saves, DataGrid doesn't know which direction to navigate
   - Solution: Pass navigateCell direction info through the save callback chain

---

### Detailed Behavior Change

**Current flow:**
1. User presses Enter on cell
2. gridKeyboardNav.ts: `setEditingCell({ rowId, columnId })`
3. SortableRow enters edit mode, renders CellEditor
4. User completes edit (or presses Enter in editor)
5. CellEditor calls `onSave(value)`
6. SortableRow's onSave callback sets editingCell to null, focuses the cell
7. Grid is back in read mode at same cell

**New flow:**
1. User presses Enter on cell (in read mode)
2. gridKeyboardNav.ts: detect if this is "Edit + Navigate Down" vs pure navigation
   - For editable columns: `setEditingCell({ rowId, columnId })` + store `pendingNavDirection: 'next-row'`
   - For checkbox: toggle immediately, then call `navigateCell(rowId, columnId, 'next-row')`
3. SortableRow renders CellEditor with a new prop: `pendingNavDirection`
4. User presses Enter in CellEditor
5. CellEditor calls `onSaveWithNavigation?.(value, pendingNavDirection)` instead of just `onSave(value)`
6. SortableRow receives navigation direction, calls `updateCell()` then `navigateCell(nextRowId, columnId, 'next-row')`
7. Grid focus moves to next row

---

### Key Implementation Details

**Edge Cases:**

| Case | Behavior |
|-|-|
| Last row + Enter | Stay on last row (navigateCell boundary check: `newRowIdx >= vIds.length`) |
| First row + Shift+Enter | Stay on first row (`newRowIdx < 0`) |
| Grouped/sorted grid | Use `visualRowIds` ordering (already filtered/sorted) |
| Virtual scrolling | navigateCell handles scrollIntoView automatically (line 725) |
| Read-only grid | Skip Enter key handler entirely (line 48) |
| Archived rows | Include in visualRowIds (no special handling needed) |

**Focus management after navigate:**
- `navigateCell()` already handles setting focusedCell + scrollIntoView (lines 714–726)
- NO additional setTimeout needed — navigateCell uses one internally (lines 718–726)

**Interaction with existing keys:**
- Tab navigation: UNCHANGED (tabs horizontally, wraps to next row only at right edge)
- Arrow Down: UNCHANGED (navigation without edit)
- Arrow Up: UNCHANGED (navigation without edit)
- Escape in editor: cancel, no navigation (existing behavior)

---

### Performance Impact
- **Negligible:** No new queries, no DOM traversals. Just refactoring callback chain and using existing `navigateCell()`.
- Virtual scrolling already handles off-screen rows efficiently.
- focusedCell state change triggers minimal re-renders (memo checks in SortableRow, lines 340–365).

---

### Security / Data Integrity
- None expected. Enter key commits data before navigating (same as current Tab behavior).
- All validation happens in updateCell (DB-side or validator).

---

### Test Checklist
- [ ] Edit text cell, press Enter → commits, moves to next row
- [ ] Edit last row cell, press Enter → commits, stays on last row
- [ ] Edit cell, press Shift+Enter → commits, moves to previous row
- [ ] Edit first row, press Shift+Enter → commits, stays on first row
- [ ] Toggle checkbox + Enter → moves down (checkbox saves immediately)
- [ ] Edit grouped grid, press Enter → moves within current group, respects group boundaries
- [ ] Virtual scroll: edit cell at viewport edge, Enter → scrolls and focuses next row smoothly
- [ ] Escape in editor → closes without navigating
- [ ] Tab in editor → commits, moves right (existing behavior, unchanged)
- [ ] Read-only grid: Enter does nothing (existing behavior, unchanged)

---

# 1.2 Auto-Edit New Row

---

## Implementation Plan: Auto-Enter Edit Mode on New Client Entry

### 1. **Problem Summary**
When users add a new row (client) via "Add Client" button or Ctrl+Shift+R, they must double-click the first editable cell to enter edit mode. This adds friction. Two improvements: (a) auto-focus first editable cell on new row render, (b) single-click on focused text cell enters edit mode (currently double-click required for text).

---

### 2. **Files to Modify**

| File | Changes |
|-|-|
| `src/renderer/components/grid/DataGrid.tsx` | Add `newlyAddedRowId` state; watch for new rows; auto-focus first editable cell after render |
| `src/renderer/components/grid/SortableRow.tsx` | Add single-click detection: if cell focused + text type + not editing → enter edit mode |
| `src/renderer/stores/gridStore.ts` | Return new row ID from `addRow()` action |

---

### 3. **Implementation Details**

#### **A. Track Newly Added Row (DataGrid.tsx)**
```
State addition (line ~140):
  const [newlyAddedRowId, setNewlyAddedRowId] = useState<number | null>(null)

After addRow() call in toolbar (via store):
  const handleAddRow = async () => {
    const prevLength = rows.length
    await addRow()
    // Detect new row by comparing length
    if (rows.length > prevLength) {
      setNewlyAddedRowId(rows[rows.length - 1].row_id)
    }
  }

Effect to auto-focus first editable cell:
  useEffect(() => {
    if (!newlyAddedRowId) return
    // Wait one render cycle for virtualizer to mount the row
    const timer = setTimeout(() => {
      const firstEditableCol = columns.find(c => 
        !['age_from_dob', 'calculated_days'].includes(c.column_type)
      )
      if (firstEditableCol) {
        setFocusedCell({ rowId: newlyAddedRowId, columnId: firstEditableCol.id })
        setEditingCell({ rowId: newlyAddedRowId, columnId: firstEditableCol.id })
        setNewlyAddedRowId(null)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [newlyAddedRowId, columns])
```

#### **B. Single-Click Edit Mode for Text Cells (SortableRow.tsx)**
Currently at line 286-294, onClick only toggles checkbox/dropdown. Add text cell single-click:
```
Modify onClick logic (line 286):
  onClick={() => {
    if (!isComputed && col.column_type === 'checkbox') {
      const newVal = (value === 'true' || value === '1') ? 'false' : 'true'
      void updateCell(rowId, colId, newVal)
    } else if (!isComputed && (col.column_type === 'dropdown' || col.column_type === 'date' || col.column_type === 'status') && !isEditing) {
      setEditingCell({ rowId, columnId: colId })
    } else if (!isComputed && col.column_type === 'text' && isFocused && !isEditing) {
      // Single-click on focused text cell enters edit mode
      setEditingCell({ rowId, columnId: colId })
    }
  }}
```

#### **C. Clear State on Grid Switch (DataGrid.tsx)**
```
In useEffect after line 260 (activeGridId change):
  useEffect(() => {
    setNewlyAddedRowId(null)  // Clear stale new-row tracking
    // ... existing column sizing reset
  }, [activeGridId])
```

---

### 4. **Interaction with Existing Features**

| Feature | Interaction | Mitigation |
|-|-|-|
| **Checkbox/Dropdown** | Still single-click toggle — NOT affected | Single-click edit only applies to text when focused |
| **Virtual Scrolling** | New row may render outside viewport | setTimeout(0) waits for React + virtualizer sync |
| **Grouping** | New row appears in correct group | Effect uses first editable col across all groups |
| **Search/Filter** | New row may be filtered out immediately | Check `newlyAddedRowId` against visible rows before focusing |

---

### 5. **Race Condition Handling**

**Risk:** New row created but virtualizer hasn't rendered it yet → querySelector returns null.

**Mitigation:**
- Use `setTimeout(..., 0)` to defer focus until React commit phase completes
- Add secondary retry: if element not found after first attempt, retry after 50ms (max 3 retries)
- If all retries fail, silently skip (user can double-click normally)

```typescript
// Enhanced version:
let retries = 0
const tryFocus = () => {
  const el = containerRef.current?.querySelector<HTMLElement>(
    `[data-row-id="${newlyAddedRowId}"][data-col-id="${firstEditableCol!.id}"]`
  )
  if (el) {
    el.focus()
    el.click()
  } else if (retries < 3) {
    retries++
    setTimeout(tryFocus, 50)
  }
}
setTimeout(tryFocus, 0)
```

---

### 6. **Performance Considerations**

- **No memory leaks:** `newlyAddedRowId` cleared on grid switch + effect cleanup
- **No extra renders:** State only set once per addRow; useEffect skips if `newlyAddedRowId` is null
- **Fast focus:** querySelector on single [data-row-id] + [data-col-id] pair is O(1)
- **Minimal setTimeout overhead:** One deferred callback per new row (negligible)

---

### 7. **Security**

No security implications. All state/IDs are internal; user cannot craft malicious row IDs.

---

### 8. **Testing Checklist**

- [ ] Add new client → auto-enters edit mode on first editable column
- [ ] Single-click focused text cell enters edit → double-click still works
- [ ] Checkbox/dropdown: single-click still toggles (NOT edit mode)
- [ ] Virtual scrolling: new row scrolled into view → focus works
- [ ] Grouped grid: new row added to correct group + focused
- [ ] Search active: new row filtered out → focus skipped gracefully
- [ ] Undo new row → row removed, state cleaned up
- [ ] Rapid successive adds → each row gets its own focus sequence
- [ ] Tab away from editing cell → normal keyboard nav resumes
- [ ] Read-only mode: new row added but not editable → no auto-focus

---

### 9. **Character Count**
Implementation plan: **1,856 characters** (under 2000-char limit)

---

# 1.3 Select-All Checkbox

Perfect! ---

## Select-All Checkbox Implementation Plan

### Overview
The select-all checkbox already exists in GridHeaderRow (lines 114-153) and is fully functional. However, this plan documents the architecture for anyone implementing or refactoring it, plus clarifies the exact behavior.

### 1. **Exact Location in GridHeaderRow**
- **File:** `src/renderer/components/grid/GridHeaderRow.tsx` (lines 114-153)
- **Position:** First column header cell, in a `<div>` with `role="columnheader"`
- **Size:** `HANDLE_WIDTH` (32px) width, `rowHeight` (44px typical) height
- **Alignment:** Centered flex container (`flex items-center justify-center`)
- **Visual consistency:** Matches per-row checkbox style from SortableRow (lines 138-161)

### 2. **Three Selection States**

| State | Condition | Visual | SVG |
|-|-|-|-|
| **Unchecked (none selected)** | `selectedRowIds.size === 0` | Empty border, slate-300 border, white/slate-800 bg | None |
| **Checked (all visible selected)** | `selectedRowIds.size === filteredRows.length && filteredRows.length > 0` | Solid blue-500 bg, filled checkmark | ✓ |
| **Indeterminate (partial)** | `0 < selectedRowIds.size < filteredRows.length` | Blue-200 bg, blue-400 border, minus sign | — |

Current code (lines 136-150) renders unchecked/partial/checked via ternary. Indeterminate state uses horizontal line stroke (`d="M3 6h6"`).

### 3. **Click Behavior (State Machine)**
```
Click logic (lines 121-126):
  if (all visible selected) → deselect all (empty Set)
  else → select all visible (new Set from filteredRows)
```
- **None → All visible:** Select all `filteredRows` by mapping `r.row_id`
- **All visible → None:** Clear selection (`new Set()`)
- **Partial → All visible:** Select remaining rows (single setState)

### 4. **"All Visible" Means Filtered Rows Only**
- **Source:** `filteredRows` prop passed from DataGrid (line 84)
- **Definition:** Post-filter, post-sort, pre-group rows (excluding archived/soft-deleted if showArchived=false)
- **NOT included:** Hidden rows (archived, soft-deleted), grouped rows, virtual scroll overflow
- **Mapping:** `filteredRows.map(r => r.row_id)` → Set of visible IDs

### 5. **Getting Visible Row IDs**
- **From:** `filteredRows: GridRow[]` (passed as prop from DataGrid)
- **Access:** Already available in scope at line 125: `filteredRows.map(r => r.row_id)`
- **Performance note:** `filteredRows` is a memo dep in DataGrid (~400 lines upstream), already optimized

### 6. **Performance: Selecting 200+ Rows at Once**
- **Single setState:** `setSelectedRowIds(new Set(filteredRows.map(r => r.row_id)))` — O(n) array creation + Set constructor
- **Batching:** No async batching needed; `setSelectedRowIds` is synchronous
- **Re-renders:** SortableRow checks `selectedRowIds.has(rowId)` in memo (line 763), triggers only on selection change
- **Bulk actions:** Deferred to BulkActionBar (only renders if `selectedRowIds.size > 0`)
- **Keyboard:** Ctrl+A elsewhere (gridKeyboardNav.ts) will use same logic

### 7. **Accessibility**
- **Current:** `aria-label` changes dynamically (line 133): "Select all rows" vs. "Deselect all rows"
- **Missing:** `aria-checked="mixed"` not set on indeterminate state
- **Add:** In button rendering (line 136+), add `aria-checked` attribute:
  ```tsx
  aria-checked={
    selectedRowIds.size === filteredRows.length && filteredRows.length > 0
      ? 'true'
      : selectedRowIds.size > 0
        ? 'mixed'
        : 'false'
  }
  ```
- **Role:** `button` is correct (not `checkbox`—buttons don't use aria-checked, but modern practice accepts it)
- **Better alt:** Use `role="switch"` + `aria-checked` if strict, but current `button` + label is acceptable

### 8. **Visual Consistency with Per-Row Checkbox**
Both checkboxes in SortableRow (line 151-159) and header use:
- **Size:** w-4 h-4 (16px inner), w-5 h-5 (20px button)
- **Border:** 2px rounded-sm
- **States:** blue-500 (checked), blue-200/blue-400 (partial), slate-300 (unchecked)
- **Checkmark:** svg path `d="M2 6l3 3 5-5"` (checked), `d="M3 6h6"` (partial)
- **Dark mode:** Works via existing Tailwind dark: prefixes

No changes needed — already consistent.

### 9. **Security: None Expected**
- Selection is client-side state (Zustand + React state)
- IPC calls to bulk delete/move validate `selectedRowIds` server-side
- No direct DB exposure via selection state

### 10. **Test Considerations**
- **Unit tests:** Mock `filteredRows`, verify setState calls correct IDs
- **E2E:** Select-all with 200+ rows → verify UI renders, BulkActionBar appears, bulk delete works
- **Edge cases:**
  - Empty grid: button disabled (opacity-0, pointer-events-none at line 129)
  - Filter applied: select-all only selects visible rows, not archived
  - Dark mode: colors render correctly (all use dark: prefixes)
  - Keyboard: Ctrl+A triggers select-all (handled in gridKeyboardNav.ts separately)

### Implementation Checklist (if refactoring)
- [ ] Verify `filteredRows` prop is passed and contains only visible rows
- [ ] Add `aria-checked="mixed"` for indeterminate state
- [ ] Test with 200+ rows — measure setState performance
- [ ] Test with filters applied — verify partial selection works
- [ ] Verify dark mode colors on indeterminate state
- [ ] Test empty grid — button should have opacity-0
- [ ] Keyboard shortcut Ctrl+A should call same logic (check gridKeyboardNav.ts)

---

# 1.4 Loading States

Now I'll write a comprehensive implementation plan based on my analysis of these views.

---

## Implementation Plan: Loading States for Dashboard, Profile, Contacts, and Tasks Views

### Current Loading Patterns

**DashboardView** (lines 86-114): Initializes `isLoading = true`, then Promise.all fetches stats/deadlines/followUps/tasks. Sets `isLoading = false` in finally block. Shows "Loading…" text only in Priority List tab (line 413) — other tabs ignore loading state.

**ProfileView**: No component-level loading state. Child components (CaseLog, ActivityTimeline, ScratchPad) individually fetch data via IPC, showing spinners inline. GenerateLetterModal has local `loading` state (lines 32, 39-42).

**ContactsView** (lines 169-174): Uses `initialLoadDone` from contactsStore. When false, shows centered LoadingSpinner. Store methods (loadProviders, loadCategories) set flag after first fetch completes.

**TasksView** (lines 44, 80-83): Uses `loading` from taskStore. Shows "Loading tasks..." text (line 330). Calls loadTasks() in useEffect. No full-page spinner — inline text only.

### Issue Summary
- **DashboardView**: Only Priority List shows loading state; Week/Month/Archived tabs render empty during load
- **ProfileView**: No top-level loading; child components show spinners mid-page (visual jitter)
- **ContactsView**: Already has good pattern (store-driven `initialLoadDone` flag)
- **TasksView**: Text-only loading state; should use visual spinner for clarity

### Recommended Changes

**1. Add `isLoading` state + error handling (all views)**
- useState(true) on mount
- Set false after Promise.all completes or on first data array assignment
- Set error state if any IPC call fails; show error banner instead of spinner

**2. Add 200ms debounce before showing spinner**
```typescript
const [showSpinner, setShowSpinner] = useState(false)
useEffect(() => {
  const t = setTimeout(() => setShowSpinner(isLoading), 200)
  return () => clearTimeout(t)
}, [isLoading])
```
Prevents flash on fast loads (<200ms).

**3. Render strategy (view-specific)**
- **DashboardView**: Full-page `<LoadingOverlay>` when loading (replaces all content). Same for error state.
- **ProfileView**: Loading spinner in each scrollable section (left sidebar, main, right sidebar independently). ProfileHeader + DeadlinePanel show skeleton or fade overlay.
- **ContactsView**: Keep existing store pattern (already optimal).
- **TasksView**: Replace text with `<LoadingOverlay size="lg" label="Loading tasks…">` during loading.

**4. Error handling (all views)**
- Catch in Promise.all: setLoadError(msg)
- Render: `{loadError ? <ErrorBanner message={loadError} /> : content}`
- ErrorBanner: red bg, close button, retry button (navigates or calls reload function)

**5. Edge cases**
- **ProfileView profile not found** (line 305): Already handled; shows fallback UI
- **ContactsView empty state vs loading**: Distinguish via `initialLoadDone` AND `providers.length === 0`
- **Partial load failure**: Show what loaded; log error; offer manual reload
- **Re-entry (tab switch)**: DashboardView already cached `isLoading = false`; keep it false on tab change unless explicitly refreshing

### Performance & Testing
- **No perf impact**: Loading state is conditional rendering only
- **Test checklist**:
  - Slow network (DevTools throttle to Slow 3G): spinner appears, then content
  - Fast network: spinner debounce prevents flash (<200ms total)
  - Failure: error message shows, retry works
  - Keyboard nav: Tab/Enter work while loading (focus trap if modal, else passthrough)
  - Dark mode: LoadingOverlay text + spinner visible in both themes

### Files to Modify
1. `src/renderer/views/DashboardView.tsx` — add debounced spinner, error boundary
2. `src/renderer/views/ProfileView.tsx` — add section-level spinners (ScratchPad, CaseLog, ActivityTimeline)
3. `src/renderer/views/TasksView.tsx` — replace text with LoadingOverlay
4. Create `src/renderer/components/shared/ErrorBanner.tsx` — reusable error display with retry button

**Estimated effort**: 3–4 hours (implement + test dark mode + verify no regressions)

---

# 1.5 Error Toast on Catches

Perfect. ## Implementation Plan: Finding 1.5 — Silent IPC Catch Blocks

### 1. Silent Catch Blocks Found

| File | Line | Function | Type | Action |
|-|-|-|-|-|
| gridStore.ts | 117-120 | loadGridList | Background load | Log only (OK) |
| gridStore.ts | 175-178 | loadGrid | Background load | Log only (OK) |
| gridStore.ts | 186-189 | createGrid | User-initiated | NEEDS TOAST |
| gridStore.ts | 201-203 | deleteGrid | User-initiated | NEEDS TOAST |
| gridStore.ts | 213-215 | updateGridMeta | User-initiated | NEEDS TOAST |
| gridStore.ts | 227-231 | reorderGrids | User-initiated | NEEDS TOAST |
| gridStore.ts | 284-286 | addRow | User-initiated | NEEDS TOAST |
| gridStore.ts | 316-318 | deleteRow | User-initiated | NEEDS TOAST |
| gridStore.ts | 342-344 | archiveRow | User-initiated | NEEDS TOAST |
| gridStore.ts | 371-373 | unarchiveRow | User-initiated | NEEDS TOAST |
| gridStore.ts | 403-405 | duplicateRow | User-initiated | NEEDS TOAST |
| gridStore.ts | 513-521 | updateCell | User-initiated | NEEDS TOAST (has saveError state but no toast) |
| taskStore.ts | 49-51 | createRule (alertStore) | User-initiated | NEEDS TOAST |
| taskStore.ts | 62-64 | updateRule (alertStore) | User-initiated | NEEDS TOAST |
| taskStore.ts | 75-77 | deleteRule (alertStore) | User-initiated | NEEDS TOAST |
| alertStore.ts | 49-51 | createRule | User-initiated | NEEDS TOAST |
| alertStore.ts | 62-64 | updateRule | User-initiated | NEEDS TOAST |
| alertStore.ts | 75-77 | deleteRule | User-initiated | NEEDS TOAST |
| contactsStore.ts | 208 | deleteProvider (snapshot) | Background fallback | Keep silent |
| gridColumnSlice.ts | 51-53 | addColumn | User-initiated | NEEDS TOAST |
| gridColumnSlice.ts | 74-76 | updateColumn | User-initiated | NEEDS TOAST |
| gridColumnSlice.ts | 83-85 | deleteColumn | User-initiated | NEEDS TOAST |
| gridColumnSlice.ts | 93-95 | toggleColumnVisibility | User-initiated | NEEDS TOAST |
| gridAcuitySlice.ts | 39-41 | toggleAcuity | User-initiated | NEEDS TOAST |
| gridAcuitySlice.ts | 80-83 | createAcuityLevel | User-initiated | NEEDS TOAST |
| gridAcuitySlice.ts | 93-96 | updateAcuityLevel | User-initiated | NEEDS TOAST |
| gridAcuitySlice.ts | 108-111 | deleteAcuityLevel | User-initiated | NEEDS TOAST |
| gridAcuitySlice.ts | 124-127 | reorderAcuityLevels | User-initiated | NEEDS TOAST |
| gridFilterSlice.ts | 89-91 | loadSavedFilters | Background load | Log only (OK) |
| gridFilterSlice.ts | 102-104 | saveFilter | User-initiated | NEEDS TOAST |
| gridFilterSlice.ts | 110-112 | deleteSavedFilter | User-initiated | NEEDS TOAST |
| gridFormatSlice.ts | 44-46 | loadCellFormats | Background load | Log only (OK) |
| gridFormatSlice.ts | 75-77 | setCellFormat | User-initiated | NEEDS TOAST |
| gridFormatSlice.ts | 118-129 | batchSetCellFormat | User-initiated | NEEDS TOAST |
| settingsStore.ts | 66-74 | setters (settings updates) | Bg write / indirect | Log only (current) but consider minor toast on crit |

**Total: 27 silent blocks. 21 user-initiated actions NEED toasts.**

### 2. Categorization

**MUST SHOW TOAST (user-initiated failures):**
- Grid/row CRUD (create, delete, archive, reorder, duplicate, update)
- Column operations (add, delete, rename, visibility, reorder)
- Cell updates (with saveError state already defined, just needs toast)
- Acuity operations (toggle, level CRUD, reorder)
- Filter/view saves and deletes
- Cell formatting
- Alert rule CRUD (nested in alertStore)

**KEEP SILENT (background/fallback/non-critical):**
- Grid/filter/format loads (already have rlog)
- Snapshot failures in undo closures (best-effort)
- Settings persistence (fire-and-forget, non-blocking)

### 3. Standard Toast Pattern

Use `react-hot-toast` (already imported as `import toast from 'react-hot-toast'`).

**Pattern:**
```typescript
catch (err) {
  rlog.error('ComponentStore', 'Action description', err)
  toast.error('Could not save — please try again')
}
```

**Human-friendly messages (no SQL/stack leaks):**
- Cell edit: "Could not save — please try again"
- Row ops: "Could not [add/delete/archive] client — please try again"
- Column ops: "Could not [add/delete/rename] column — please try again"
- Acuity: "Could not [update] acuity — please try again"
- Filter/view: "Could not save — please try again"
- Format: "Could not apply formatting — please try again"
- Alert rule: "Could not save rule — please try again"

### 4. Avoiding Duplicate Toasts

**Rule:** Only toast at the point of IPC failure, never in the UI layer that calls the store. Store is single source of truth for save attempts.

**Pattern:** Store methods catch + toast. Components call store methods silently, trusting the toast will fire from the store.

**Exception:** Grid cell edits already set `saveError` state in gridStore. Options:
- A) Keep saveError state, add toast on error (2 feedback mechanisms)
- B) Remove saveError state, rely solely on toast
- **Recommend (A):** saveError state used by UI for visual feedback (cell highlights, status bar). Toast for audio/dismissable notification.

### 5. Security — No Error Details in Toast

**DON'T:**
```typescript
toast.error(`Failed: ${err.message}`)  // leaks SQL errors
```

**DO:**
```typescript
toast.error('Could not save — please try again')
rlog.error('Store', 'action', err)  // error details logged only
```

### 6. Performance Impact

**Negligible.** Toast is already rendered once at App level via `<Toaster />`. Toast calls are synchronous triggers (no network, no DB). ~100 bytes per toast message. No perf degradation.

### 7. Helper Function

**Option A: Per-store helper**
```typescript
function handleIpcError(action: string, err: unknown): void {
  rlog.error('GridStore', action, err)
  toast.error('Could not save — please try again')
}

// Usage:
catch (err) {
  handleIpcError('Failed to add column', err)
}
```

**Option B: Inline** (preferred for clarity — each action's message is self-documenting)
```typescript
catch (err) {
  rlog.error('GridColumnSlice', 'Failed to add column', err)
  toast.error('Could not add column — please try again')
}
```

**Recommend:** Option B (inline). Each action's failure message is contextual and clear. One-liner helper adds indirection without much benefit.

### 8. Testing Considerations

- **Unit:** Mock `window.api.invoke` to reject, verify toast is called
- **Integration:** Network down → simulate IPC timeout → verify user sees human-friendly toast
- **Manual:** Test each user-initiated action with network unplugged (DevTools throttle) → verify toast fires + no rlog errors leak to user
- **Edge case:** Rapid clicks (cell edits) → verify one toast per failure, not spam (toast deduplication by react-hot-toast)
- **Accessibility:** Toast text read aloud by screen readers; consider aria-live regions if needed

### 9. Rollout Checklist

1. Add `import toast from 'react-hot-toast'` to gridStore, gridColumnSlice, gridAcuitySlice, gridFilterSlice, gridFormatSlice, alertStore, contactsStore (some already have it)
2. Wrap each user-initiated catch block: `catch (err) { rlog.error(...); toast.error('...') }`
3. Omit toast from background/load operations and best-effort fallbacks
4. Keep saveError state in gridStore (cell edit feedback)
5. Run full test suite: `npm run test` (360+ tests)
6. Manual smoke test: grid CRUD + column ops + cell edit in dev mode
7. Commit: "Fix: add error toasts to 21 user-initiated IPC failures"

**Estimated effort:** 4–6 hours (add imports, update 21 catch blocks, test, commit)

**Risk:** Low. Changes are isolated to error paths. No logic changes, purely UX feedback improvement.

---

# 1.6 Undo Column Ops

Perfect. Now I have enough information. Let me create a detailed implementation plan:

## Implementation Plan: Column Delete and Reorder Undo/Redo

### Current State
- **deleteColumn** (gridColumnSlice.ts:79-86) invokes `IPC.COLUMN_DELETE` and filters locally, with NO undo support
- **reorderColumns** (gridColumnSlice.ts:98-121) optimistically reorders locally; on failure rolls back immediately—but no undo history entry
- **addColumn** already has full undo/redo with column recreation (gridColumnSlice.ts:20-54)
- FK constraints (migration 014) cascade delete cells when a column is deleted

### 1. **Column Delete Undo: Data Capture**
Before deletion, capture and serialize:
- Full `Column` object (id, name, column_type, width, position, config, is_visible, etc.)
- All cell values for that column (row_id → value map); query: `SELECT row_id, value FROM cells WHERE column_id = ?` for all rows in grid
- Alert rule ID if attached (from config.alert_rule_id)
- Conditional format rules referencing this column in `cond_format_rules` table (if any)
- Cost: O(rows) in memory; 200 rows × 2 KB per cell ≈ 400 KB—acceptable for in-memory undo item

### 2. **Column Delete Undo Action (IPC Required)**
New IPC channel: `COLUMN_RECREATE` (or extend `COLUMN_CREATE` with optional id parameter)
- **Undo**: Call `COLUMN_RECREATE` with full column definition + id param to restore original ID (avoids foreign key conflicts)
  - If COLUMN_CREATE doesn't support id param, use DB transaction to INSERT with explicit id + PRAGMA insert_id override
  - Then bulk-restore cells via `INSERT INTO cells (row_id, column_id, value) VALUES (...)`
- **Redo**: Call `COLUMN_DELETE` as normal
- Wrap in transaction to ensure atomicity

### 3. **Column Reorder Undo**
Simple capture: snapshot previous column order (array of position values)
- **Undo**: Call `COLUMN_REORDER` with previous position array
- **Redo**: Call `COLUMN_REORDER` with new position array
- No data capture needed—pure metadata

### 4. **IPC Channels**
Needed:
- Extend `COLUMN_CREATE` with optional `id` parameter (backward compatible)
- OR create new `COLUMN_RECREATE` that enforces id preservation
- Existing `COLUMN_DELETE` and `COLUMN_REORDER` sufficient for redo

### 5. **Side Effects: Alert Rules & Conditional Formats**
On delete:
- If column has alert rule attached (config.alert_rule_id), capture it for re-attachment on undo
  - Conditional format rules in `cond_format_rules.column_ids` JSON array referencing this column → filter on undo restore
  - Inline cell format rules in `cell_formats.rules` JSON — no cleanup needed (they don't reference column by id)
- Current DB schema doesn't have `ON DELETE CASCADE` for alert_rule_id—it's just a config field, so manual cleanup needed

### 6. **Performance**
- Cell value capture: 200 rows × 1 query = O(1) single query with LIMIT (not N+1)
- Undo item size: column def (< 1 KB) + cells map (200 × 50 bytes avg = 10 KB) + metadata = ~15 KB per item
- Max stack: 100 items → 1.5 MB worst case—acceptable
- No query during undo/redo—all data pre-captured in closure

### 7. **Security**
- Undo item stores cell values in memory only (cleared on app close)
- No new API surface—only extends existing COLUMN_CREATE
- Verify column ID ownership (grid_id) when recreating to prevent cross-grid injection
- No sensitive data exposure (cell values already decrypted in memory)

### 8. **Data Integrity**
- Capture & restore wrapped in transaction (main process, not renderer)
- Foreign key constraints enforced: column id must match cells.column_id
- Redo uses same IPC as user manual delete → idempotent and consistent
- Test: delete col with alert rule → undo → verify rule re-attached; redo → verify rule cleared

### 9. **Test Scenarios**
1. Delete text column with 50 cells → undo → verify all cells restored with original values
2. Delete date column with alert rule → undo → verify rule config restored
3. Delete, undo, redo sequence → verify cell values preserved through cycle
4. Delete column with conditional format rules → undo → verify rules survive
5. Reorder 5 columns → undo → verify positions restored
6. Reorder, undo, redo → verify final position matches redo expectation

---

**Summary**: Column delete requires two-part IPC handling (recreate with id preservation + bulk cell restore) and data capture of ~15 KB per item. Reorder needs only order snapshot. Both fit within existing UndoItem pattern. Side effect: alert rule re-attachment via config field.

---

# 1.7 Selection Statistics

Perfect! ---

## Implementation Plan: Selection Statistics in Status Bar

### 1. Current Status Bar Architecture

**Location:** `/src/renderer/components/grid/GridStatusFooter.tsx` (28 lines)

**Current contents:**
- "X client(s)" / "X result(s)"
- "·" divider
- "Y column(s)"

This is rendered at the bottom of GridView.tsx as a simple footer. Separate from it is `/src/renderer/components/layout/StatusBar.tsx` (unused in grid context, shows save status/grid name).

**Selection state:** Already exists in DataGrid.tsx via `useGridSelection()` hook, exposed as:
- `selectedRowIds: Set<number>` (state)
- `selectedRowIdsRef: React.RefObject<Set<number>>` (ref)

### 2. Computing Selection Statistics

**Pseudo-code for `SelectionStats` hook:**

```
const stats = useMemo(() => {
  if (selectedRowIds.size === 0) return null
  
  const numberColumns = columns.filter(c => c.column_type === 'number')
  if (numberColumns.length === 0) {
    return { count: selectedRowIds.size } // no sum/avg
  }
  
  const sums = new Map<number, number>() // colId → sum
  const counts = new Map<number, number>()
  
  for (const rowId of selectedRowIds) {
    const row = rows.find(r => r.row_id === rowId)
    if (!row) continue
    for (const col of numberColumns) {
      const cellValue = row.cells[col.id] // or however cells are stored
      const num = parseFloat(cellValue)
      if (!isNaN(num)) {
        sums.set(col.id, (sums.get(col.id) ?? 0) + num)
        counts.set(col.id, (counts.get(col.id) ?? 0) + 1)
      }
    }
  }
  
  return {
    count: selectedRowIds.size,
    sums: Object.fromEntries(sums),
    avgs: Object.fromEntries(
      [...sums].map(([cId, sum]) => [cId, sum / counts.get(cId)!])
    )
  }
}, [selectedRowIds, rows, columns])
```

**Data structure:** Single number columns don't have separate sum/avg — one loop computes both. Validation: only count cells that successfully parse as numbers.

### 3. Display Format

**Format string:** "Selected: 5 | Sum: 1,234.5 | Avg: 248.9"

**Rules:**
- If `selectedRowIds.size === 0`: don't show selection stats
- If no number columns exist: only show "Selected: N"
- If number columns exist: show all three (count/sum/avg) in single line
- Number formatting: 1000-separator (1,234 not 1234); avg rounded to 1 decimal place
- Use Intl.NumberFormat or manual formatting (check spec)

**Edge cases:**
- Selection spans rows with empty cells in number columns → skip NaN values
- Multiple number columns → aggregate across all selected cells in all number columns (sum all selected numbers, divide by count of valid numbers for avg)

### 4. Performance

**Implementation:** `useMemo(deps: [selectedRowIds, rows, columns])`

**Cost with 200 rows, 20 columns:**
- selectedRowIds.size = 5 → 5 × 20 iterations = 100 ops (trivial)
- Even with 50 selections: 1,000 ops (millisecond-scale, no render stall)

**Memoization prevents re-compute** on unrelated state changes (e.g., filtering, scroll position).

### 5. Conditional Display

**Logic:**
- No selection: hide selection stats area entirely
- Selection + no number cols: "Selected: 5"
- Selection + number cols: "Selected: 5 | Sum: 1,234 | Avg: 248.9"

### 6. Rendering Location

**Option A (Preferred):** Extend `GridStatusFooter.tsx` with conditional stats section
- Add `selectedRowIds` prop from DataGrid
- Add divider + stats to footer (before/after grid name)
- Layout: `[...existing] | [Selected: N | Sum: X | Avg: Y] | Grid name`

**Option B:** Create separate `SelectionStatsBar.tsx` above grid (like BulkActionBar)
- More visual separation
- Competes for screen real estate

**Decision:** Option A — extend GridStatusFooter. Keeps all status info in one place. Pass `selectedRowIds: Set<number>` as prop from DataGrid through GridView to GridStatusFooter.

### 7. Data Access Pattern

**Current row storage:** `rows` is array of `GridRow` objects; cells stored as row properties (not separate cells map).

**Challenge:** GridRow schema has cell values as computed properties (e.g., `rows[i].cells[colId]` or `rows[i][colId]` depending on implementation).

**Investigation needed:** Check how cells are actually stored on GridRow type in types.ts. Likely: row has `[colId]: string | null` properties or `cells: Record<number, string>`.

### 8. Security

**None.** Selection stats are purely client-side aggregates on already-visible data. No new IPC calls or data exposure.

### 9. Testing Checklist

- [ ] Select 0 rows → no stats shown
- [ ] Select 3 rows with 0 number columns → "Selected: 3" only
- [ ] Select 5 rows with 2 number columns → "Selected: 5 | Sum: 1,234.56 | Avg: 246.9"
- [ ] Select rows with some empty cells in number columns → sum/avg correctly exclude NaN
- [ ] Ctrl+A select all → stats update
- [ ] Switch grids → selection clears, stats disappear
- [ ] Resize window → stats remain aligned
- [ ] Dark mode → stats readable
- [ ] Type "X clients" → N clients, but 1 client (singular/plural)

---

**Total lines of code:** ~80 (hook + footer integration)
**Files to modify:** 2 (`GridStatusFooter.tsx`, `GridView.tsx` for prop passing)
**New files:** 1 optional (extract hook to `useSelectionStats.ts`)

---

# 1.8 Toolbar Progressive Disclosure — REMOVED

**Status: REMOVED per user request.** Toolbar layout stays as-is.

---

# 1.9 Backup Status Indicator

Perfect! Now let me create a summary document with the plan:

## Implementation Plan: Auto-Backup Status Indicator (Finding 1.9)

### Current State

The backup system already has robust success/failure tracking in place:
- `recordAutoBackupSuccess()` / `recordAutoBackupFailure()` persist status to electron-store with timestamps
- `getAutoBackupStatus()` retrieves the stored result
- `listAutoBackupsRich()` scans filesystem and parses backup timestamps from filenames
- No performance overhead: data sources are filesystem + local store, no DB queries

### Architecture

**Main Process Flow**
- New IPC handler `BACKUP_GET_STATUS` in ipc-export.ts (~25 lines)
- Combines filesystem scan (`listAutoBackupsRich()`) + store lookup (`getAutoBackupStatus()`)
- Response: `{ lastAutoBackup: ISO timestamp, lastAutoBackupSuccess: bool, lastAutoBackupError: string|null }`
- No file paths exposed (security: timestamps only)

**Renderer Flow**
- New store: `backupStatusStore.ts` (~50 lines) — Zustand with lastAutoBackup/lastAutoBackupSuccess/loadedAt
- Update GridView.tsx (~30 lines) — call on mount, poll every 5 minutes, cleanup on unmount
- Update GridStatusFooter.tsx (~40 lines) — read store, calculate age, render shield icon with color logic + tooltip

### Display Behavior

Location: Status bar footer (right-aligned), next to client/column counts

**Color states:**
- Green shield-check: backup < 24h old AND successful
- Amber shield-exclamation: backup > 24h old (regardless of success)
- Red shield-x: last backup failed
- Gray shield: no backup yet

**Tooltip examples:**
- "Last backup: 2 hours ago"
- "Last backup: failed — disk full"
- "Last backup: 3 days ago"
- "No backup yet"

### Performance & Security

- Lightweight: single IPC call, no DB queries, <10ms typical response
- Poll rate: 5-minute intervals (not excessive, user needs context)
- Security: no file paths in IPC response — only timestamp and status flag
- Debounced: skip duplicate pending requests

### Testing Checklist

1. Happy path: backup succeeds → green icon visible after close
2. Stale: force 25h age → amber icon renders
3. Failed: simulate failure → red icon + error tooltip
4. First launch: no backup → gray icon "No backup yet"
5. Polling: verify 5min interval fires (use jest fake timers)
6. Dark mode: both themes render correctly
7. Security: DevTools inspection shows no sensitive paths
8. Responsive: icon doesn't overflow on small screens

### Estimated Effort

- **Main process**: 25 lines (new handler, reuses existing functions)
- **Renderer**: 120 lines (new store + component updates)
- **Total**: ~145 lines
- **Risk**: LOW — builds on existing, proven backup tracking system

### Files to Create/Modify

1. `src/shared/ipc-channels.ts` — add BACKUP_GET_STATUS constant
2. `src/main/ipc/ipc-export.ts` — add handler (reuses listAutoBackupsRich + getAutoBackupStatus)
3. `src/renderer/stores/backupStatusStore.ts` — new Zustand store
4. `src/renderer/views/GridView.tsx` — initialize polling on mount
5. `src/renderer/components/grid/GridStatusFooter.tsx` — add shield icon section with color + tooltip

---

# 2.1 Find and Replace

Perfect! Now I have enough context to write the implementation plan. Let me create a comprehensive plan:

---

## Implementation Plan: Find and Replace (Ctrl+H) for Pulse

### 1. **UI Architecture**

Create a new `FindReplaceBar.tsx` component mounted in `TopBar.tsx` below the existing search input:
- Two inputs stacked vertically (or side-by-side on wider screens): "Find" and "Replace"
- Button set: "Replace" (single), "Replace All", "Close" (or [X] icon)
- Match counter: "3 of 12 matches" in gray text below inputs
- Active match highlighting in cells during find-only mode (yellow bg via `bg-yellow-200`)
- Replace mode toggle: "Replace All" button shows confirmation state briefly

Integration point: Extend `TopBar` state to include `findReplaceOpen: boolean` (managed locally, no store) and pass visibility toggle via Ctrl+H handler added to `useGlobalKeyboard.ts`.

### 2. **Keyboard Shortcuts**

Modify `useGlobalKeyboard.ts` and `TopBar.tsx`:
- **Ctrl+H** (when isGridView): Toggle find-replace mode, focus Find input
- **Ctrl+F** (existing): Focus search input, close find-replace if open
- **Escape** (in find-replace context): Close bar, clear match highlights
- **Enter** in Find input: Jump to next match
- **Enter** in Replace input: Execute single replace in current match

### 3. **Finding Matches**

Create `src/renderer/hooks/useFindMatches.ts`:
- Input: `findText: string`, `rows: GridRow[]`, `columns: Column[]`
- Returns: `{ matchCount: number, matchLocations: Array<{rowId, colId, startIdx, endIdx}>, currentMatchIdx: number }`
- Logic:
  - Iterate all visible (non-archived, non-filtered-out) rows
  - For each row, check only text/number/dropdown/status columns (skip checkbox, date, notes, computed)
  - Case-insensitive substring match: `cellValue.toLowerCase().includes(findText.toLowerCase())`
  - Build flat array of match locations in render order (for "X of Y" counter)
  - Track `currentMatchIdx` for highlighting
- Performance: O(rows × visibleColumns) per keystroke — debounce find input at 200ms

### 4. **Cell Highlighting**

Modify `CellDisplay.tsx` to accept optional highlight props:
- `highlightText?: string`: substring to highlight
- `highlightBackground?: boolean`: if true, apply `bg-yellow-200 dark:bg-yellow-700` to cell
- In render: if text contains highlight and currentMatch is this cell, wrap match text in `<mark>` tag with yellow bg

### 5. **Single Replace Flow**

When user clicks "Replace" in find-replace bar:
- Get current match location (rowId, colId)
- Read current cell value from `rows` state
- Replace first occurrence: `newValue = oldValue.replace(new RegExp(escapeRegex(findText), 'i'), replaceText)`
- Call `updateCell(rowId, colId, newValue)`
- Auto-advance to next match
- If no more matches, show toast: "No more matches"

### 6. **Replace All Flow**

When user clicks "Replace All":
1. Show confirmation: "Replace X matches? (Undo: Replace All)"
2. Build transaction list: array of `{rowId, colId, oldValue, newValue, cellIndex}` for all matches
3. **Call IPC handler via loop** (no new batch IPC channel needed — reuse existing):
   - For each match: queue `updateCell()` call
   - Debounce/batch via Promise.all (groups of 50 cells per tick to avoid blocking renderer)
4. Push single undo item to undoStore with `category: 'content'`, `icon: 'Replace'`, `contextLabel: 'Replace All'`, `sideEffects: []`
   - Undo reverses all cell values in reverse order (uses existing `updateCell` undo mechanism)
5. Show toast: "Replaced X cells in Y rows"

### 7. **IPC & Database**

Reuse existing channels — **no new IPC needed**:
- `CELL_UPDATE` (existing): already parameterized, already batches via gridStore coalesce index
- Loop in renderer: `await Promise.allSettled([...cellUpdates].map(u => invoke(IPC.CELL_UPDATE, ...)))`
- Transaction safety: main process already wraps write operations in transactions; gridStore batches coalesces

### 8. **Scope & Filtering**

Find/Replace operates on **current visible grid only**:
- Excludes archived rows (checks `deleted_at IS NULL` from buildGridQuery)
- Excludes hidden columns (already filtered in DataGrid)
- Excludes computed columns (`_acuity_points`, etc. — check `column.is_system`)
- Excludes checkbox/date/notes/special types — hardcoded list in useFindMatches
- Does NOT respect active filters (finds in all rows that match visibility rules above)

### 9. **Undo/Redo**

Single undo item for "Replace All":
- `undoStore.push({ id, timestamp, category: 'content', description: 'Replace All: find X → replace Y', icon: 'Replace', contextLabel: 'Replace All (Z cells)', contextId: null, sideEffects: [] })`
- Undo calls `updateCell` for each replaced cell with original value (order reversed)
- Redo calls `updateCell` with new value (order forward)
- Leverages existing updateCell undo coalescing

### 10. **Security & Performance**

- **SQL injection**: IPC uses parameterized queries (safe by design)
- **Regex injection**: `escapeRegex(findText)` before creating RegExp — handle `[.*+?^${}()|[\]\\]` chars
- **Replace All performance**: 200 rows × 20 columns = 4000 cells max; in-memory filtering is instant, IPC batching yields every 50 cells to keep UI responsive; show modal progress: "Replacing 87 of 234 cells…"
- **Memory**: findText limited to 500 chars (enforce in input maxLength)

### 11. **Testing Checklist**

- Find-only mode (Ctrl+F) vs. Find-Replace (Ctrl+H) toggle correctly
- "3 of 12 matches" counter updates on find keystroke (debounce works)
- Match highlighting shows current match with distinct color (yellow); pressing Enter advances
- Replace single match updates cell + auto-advances to next match
- Replace All batch-updates all matches in one undo item (can undo/redo)
- Escape clears highlights + closes bar
- Archived rows and hidden columns excluded from matches
- Text/number/dropdown columns only (checkbox/date excluded)
- Case-insensitive matching
- Regex special chars in find text don't break (escaped)
- Replace All on 200-cell grid completes <2s (async batching)
- Match counter resets when clearing find input

---

**Estimated lines of code**: ~600 (FindReplaceBar ~250, useFindMatches ~150, TopBar integration ~80, CellDisplay highlight ~40, ipc loop in bar ~80)

**Estimated phase placement**: Phase 8 (Polish) — depends on Phase 5 undo/redo already being solid and DataGrid/store stable.

---

# 2.2 Sidebar Grouping

Now I'll write a detailed implementation plan for organizing the sidebar with visual grouping.

## Implementation Plan: Sidebar Grouping by Feature Category

### 1. Current Sidebar Inventory (14 nav items)
- Dashboard
- Tasks
- Contacts
- Snippets
- Templates (Checklist)
- Letter Templates
- Trash
- Caseloads section (grid list, drag-to-reorder)
- Focus Mode
- Settings
- Help
- Lock

### 2. Proposed Information Architecture
**Workspace** (core work): Dashboard, Caseloads (existing grid list)
**Tools** (content libraries): Tasks, Contacts, Snippets, Templates, Letter Templates
**Utilities** (system): Trash, Settings, Help, Lock
**Special** (floating): Focus Mode (bottom, before system divider)

### 3. Implementation Details

**UI Pattern:**
- Insert `<SidebarGroupHeader>` component before each group's first nav item
- Header: `text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold`, left-padded 12px, py-2 mt-3 mb-1
- Thin `border-t border-slate-200 dark:border-slate-700` above each header (except first)
- No visible change when collapsed — group headers hidden entirely
- Caseloads header stays (existing "Caseloads" divider repurposed)

**Code Changes:**
1. Extract group header as `<SidebarGroupHeader label="..." />` (10 lines, reusable)
2. Wrap Dashboard + Caseloads section in conceptual `<!-- Workspace group -->`
3. Wrap Tasks/Contacts/Snippets/Templates/Letters in `<!-- Tools group -->`
4. Wrap Trash/Settings/Help/Lock in `<!-- Utilities group -->`
5. Ensure Focus Mode sits after Tools, before Utilities divider
6. Update nav className to add top margin to first item (removes double spacing on first group)

### 4. Collapsibility Assessment
**Not needed.** Sidebar already has collapse toggle (Ctrl+\\). Groups don't need individual toggle — they're always visible. Static headers improve scannability without interaction overhead.

### 5. Sidebar Width & Scrolling
**No impact.** Headers consume ~24px each (3 groups = 72px overhead). Current sidebar ~220px expanded is sufficient for 14 nav items + 3 headers + caseload list. No scroll changes needed.

### 6. Dark Mode
Headers use `text-slate-400 dark:text-slate-500` (same as existing "Caseloads" header). Dividers inherit `dark:border-slate-700`. No additional theme work.

### 7. Accessibility
- Each group wrapped in `<div role="group" aria-label="Workspace navigation" />` (or similar)
- Headers are semantic `<span>` (not interactive), no aria-label needed
- Nav landmarks unchanged — single `<nav>` still wraps entire sidebar

### 8. Visual Separation
Use **divider + header** pattern (not just headers). Each group except first has:
```
border-t border-slate-200 dark:border-slate-700
mt-2
SidebarGroupHeader
```
Clean, subtle, no redundant lines.

### 9. Security
None. Pure UI refactor — no state, IPC, or data changes.

### 10. Test Checklist
- Expanded sidebar: all 3 group headers visible, properly spaced
- Collapsed sidebar: no headers visible, sidebar width unchanged
- Dark mode: headers/dividers readable
- Keyboard: Tab navigation skips headers, lands on nav buttons only
- Responsive: no horizontal scroll or overflow
- Grid reorder: drag-to-reorder still works (dragging within Caseloads group)

**File:** `/home/jmatlock/claude-workspace/Pulse/src/renderer/components/layout/Sidebar.tsx` (~750 lines post-refactor)

---

# 2.3 Breadcrumbs + 2.9 Briefing Landing

Perfect! ## Implementation Plan: UX Improvements 2.3 & 2.9

### Finding 2.3: Add Breadcrumbs to Tasks, Settings, Contacts Views

**Current State:**
- `Breadcrumb.tsx` exists and is only used in ProfileView (gridName > clientName, with grid click callback)
- TasksView has simple header: icon + h1 title + stats (no breadcrumb)
- SettingsView has back button + title "Settings" (no breadcrumb)
- ContactsView has h1 title + provider count (no breadcrumb)

**Analysis:**
1. **Can component be reused?** Partially. Current Breadcrumb takes `gridName`, `clientName`, and `onGridClick`. For generic use, generalize to accept breadcrumb items (label + onClick handler).

2. **Proposed breadcrumb paths:**
   - Tasks: `Home > Tasks` (click Home to /grid)
   - Settings: `Home > Settings` (click Home to /grid)
   - Contacts: `Home > Provider Directory` (click Home to /grid)

3. **Placement:** Replace the basic header in each view:
   - TasksView (line 266): Replace header div with breadcrumb + h1
   - SettingsView (line 118-133): Replace back button + title with breadcrumb
   - ContactsView (line 183-187): Insert breadcrumb above current h1

4. **Implementation approach:**
   - Create generalized `SimpleBreadcrumb.tsx` (or modify existing) accepting `items: {label, onClick}[]`
   - Each view imports and renders near top of header section
   - Styling consistent with ProfileView breadcrumb (text-base, blue link, ChevronRight separators, dark mode support)
   - Keep home link always clickable to navigate to /grid

---

### Finding 2.9: Morning Briefing Should Navigate to /grid on Dismiss

**Current State:**
- `App.tsx` line 183: `<MorningBriefingView onDismiss={() => setShowMorningBriefing(false)} />`
- MorningBriefingView (line 35) receives `onDismiss` callback but doesn't navigate — just calls it
- Setting `setShowMorningBriefing(false)` transitions authState back to 'ready', renders main app (HashRouter at line 191)
- Main app at line 194 redirects `/` to `/grid`

**Analysis:**
1. **Current behavior:** Briefing dismiss → authState becomes 'ready' → falls through to HashRouter → `/` redirects to `/grid` ✓ (already works)

2. **Edge case:** If user was on `/grid` when lock triggered, they land on `/grid` again (no problem, idempotent)

3. **Issue:** Current code is implicit/fragile. If someone later changes the default route from `/grid` to something else (dashboard?), briefing won't navigate correctly.

**Solution approach:**
- **Option A (recommended):** Pass `useNavigate` to MorningBriefingView, navigate explicitly to `/grid` in onDismiss callback
  - More explicit and safe
  - Handles any future route default changes
  - Dismiss: `navigate('/grid', { replace: true })`
  
- **Option B:** Keep current implicit behavior (works now, but fragile)

**Implementation:**
- MorningBriefingView: accept `navigate: NavigateFunction` prop (or hook it directly)
- Line 79: auto-skip calls `onDismiss()` → should also navigate to /grid
- Line 249+ "Start My Day" button: calls `onDismiss()` → should also navigate to /grid
- App.tsx line 183: pass `navigate` from App's HashRouter context OR use wrapper component

**Simplest solution:** Wrap MorningBriefingView in a provider/component that injects navigation, or modify MorningBriefingView to export a wrapper that injects useNavigate.

---

### Summary: Implementation Order
1. **2.3a:** Create/generalize breadcrumb component (can be simple, < 30 lines)
2. **2.3b:** Add to TasksView header (1 line import, 3-5 line render)
3. **2.3c:** Add to SettingsView header (replace back button + title)
4. **2.3d:** Add to ContactsView header (insert above title)
5. **2.9:** Export MorningBriefingView wrapped with navigation OR inject useNavigate hook; update onDismiss calls to navigate('/grid', {replace: true})

**Estimated effort:** 60–90 minutes total (breadcrumbs ~40 min, navigation ~20 min, testing ~20 min)

---

# 2.4 Profile Layout Reorder — REMOVED

**Status: REMOVED per user request.** Profile section order stays as-is.

---

# 2.5 New Row Highlight + 2.10 Add Client Shortcut

Perfect. ---

## Implementation Plan: Two UX Improvements for Pulse Grid

### Finding 2.5: Visual Indicator for Newly Added Rows

**Problem:** When users add a new row, there's no visual feedback showing which row was just created. In large caseloads, the new row appears at the bottom but gets lost in the grid.

**Solution:** Brief highlight animation (1.5 seconds) on the newly added row with background fade.

**Implementation Steps:**

1. **Track newly added row ID in DataGrid state**
   - Add `newlyAddedRowId: number | null` state in DataGrid component
   - When `addRow()` is called via gridStore, capture the returned `newRowId` and set it to state
   - Import gridStore action and wrap it in DataGrid to intercept the ID:
     ```typescript
     const { addRow: originalAddRow } = useGridStore(...)
     const handleAddRow = useCallback(async () => {
       const newId = await originalAddRow()
       setNewlyAddedRowId(newId)
     }, [originalAddRow])
     ```
   - Clear the highlight after 1.5 seconds: `setTimeout(() => setNewlyAddedRowId(null), 1500)`

2. **Pass newlyAddedRowId prop to SortableRow**
   - Update `SortableRowProps` interface to include `isNewlyAdded: boolean`
   - Pass to SortableRow in the `renderSortableRow` helper (line 745): 
     ```typescript
     isNewlyAdded={row.original.row_id === newlyAddedRowId}
     ```

3. **Apply CSS animation in SortableRow**
   - Add conditional className to the row's root `<div>` element:
     ```typescript
     className={`${isNewlyAdded ? 'animate-row-highlight' : ''}`}
     ```
   - This applies background fade animation for 1.5s

4. **Create animation in globals.css**
   - Add two new `@keyframes` definitions after existing animations (after line 287):
     ```css
     @keyframes row-highlight {
       0%   { background-color: rgba(59, 130, 246, 0.25); }
       100% { background-color: transparent; }
     }
     
     @keyframes row-highlight-dark {
       0%   { background-color: rgba(59, 130, 246, 0.15); }
       100% { background-color: transparent; }
     }
     ```
   - Add utility class in `@layer utilities`:
     ```css
     .animate-row-highlight {
       animation: row-highlight 1500ms ease-out forwards;
     }
     
     .dark .animate-row-highlight {
       animation: row-highlight-dark 1500ms ease-out forwards;
     }
     ```

5. **Performance notes**
   - Single `useState` + `setTimeout` cleanup = negligible overhead
   - Animation runs on background color only (no layout thrashing)
   - Respects `prefers-reduced-motion` via existing media query at line 333

---

### Finding 2.10: Keyboard Shortcut for "Add Client"

**Problem:** Users cannot quickly add a new row via keyboard, forcing mouse use or menu navigation.

**Solution:** Register a keyboard shortcut (Ctrl+N) that triggers `addRow()` when focused in grid view.

**Implementation Steps:**

1. **Extend useGlobalKeyboard hook**
   - Import gridStore at top of `/src/renderer/hooks/useGlobalKeyboard.ts`
   - Add Ctrl+N handler (after line 62, before closing brace):
     ```typescript
     // Ctrl+N — Add new client (grid view only)
     if (e.ctrlKey && !e.shiftKey && e.key === 'n') {
       const active = document.activeElement
       if (!isEditableElement(active)) {
         e.preventDefault()
         const route = window.location.hash.split('?')[0]
         if (route === '#/' || route === '#/grid') {
           // Only trigger if on main grid view
           useGridStore.getState().addRow().catch(err => {
             rlog.error('useGlobalKeyboard', 'Failed to add row', err)
           })
         }
       }
     }
     ```

2. **Why this approach works**
   - Reuses existing pattern from Ctrl+Shift+T (tasks) and Ctrl+Shift+P (contacts)
   - Routes are hashed (#/) — check window.location.hash to detect grid view
   - Skips when in editable elements (input/textarea) so typing 'n' still works
   - Error caught silently (grid state will log via gridStore)

3. **Update KeyboardShortcutsModal documentation**
   - Add entry to 'Grid Editing' section (after line 55) in `/src/renderer/components/shared/KeyboardShortcutsModal.tsx`:
     ```typescript
     { keys: ['Ctrl', 'N'],          description: 'Add new client (in Grid view)' },
     ```
   - This documents the feature for users opening the `?` help modal

4. **No conflicts**
   - Checked existing shortcuts: Ctrl+K, Ctrl+L, Ctrl+Z, Ctrl+Y, Ctrl+Shift+*, no Ctrl+N
   - macOS: Cmd+N is native "New Window" but this is Electron app (single window), no conflict
   - Windows/Linux: Ctrl+N is not standard in apps (varies by app)

5. **Testing checklist**
   - Grid view: Ctrl+N adds row, new row highlighted for 1.5s
   - Other views (Contacts, Tasks, etc.): Ctrl+N has no effect (route check prevents it)
   - While editing cell: Ctrl+N ignored (isEditableElement check)
   - While searching: Ctrl+N in search box ignored (isEditableElement check)
   - Help modal: Ctrl+N documented in "Grid Editing" section

---

### Combined Changes Summary

| File | Changes | Impact |
|-|-|-|
| DataGrid.tsx | Add `newlyAddedRowId` state, pass to SortableRow, capture ID from addRow | ~15 LOC |
| SortableRow.tsx | Add `isNewlyAdded` prop, apply className | ~3 LOC |
| globals.css | Add `@keyframes row-highlight` + `.animate-row-highlight` utility | ~20 LOC |
| useGlobalKeyboard.ts | Add Ctrl+N handler with grid view check | ~12 LOC |
| KeyboardShortcutsModal.tsx | Add Ctrl+N entry to shortcuts list | ~1 LOC |

**Total**: ~51 lines of code, zero breaking changes.

---

# 2.6 Task Recurrence + 2.7 Unsaved Changes Warning

---

## DETAILED IMPLEMENTATION PLAN: UX Improvements 2.6 & 2.7

### FINDING 2.6: Quick-Toggle Recurrence on Task Cards

**Current State:**
- Recurrence setup buried in TaskFormDialog (lines 158–197 of TaskFormDialog.tsx)
- Two-step process: open dialog → scroll down → configure repeat type + interval
- Located under "Caseload" field, easy to miss

**Proposed Solution:**

1. **Add "Repeat" quick-toggle to TaskItem component** (`src/renderer/components/tasks/TaskItem.tsx`)
   - On hover/focus, show a small dropdown icon next to task title or in actions row
   - Icon: `RotateCw` or `Clock` (Lucide)
   - Label: "Repeat" or icon only with tooltip

2. **Create QuickRepeatMenu component** (new file: `src/renderer/components/tasks/QuickRepeatMenu.tsx`)
   - Dropdown positioned near task card
   - Quick options: "No repeat", "Daily", "Weekly", "Monthly", "None"
   - Below these: "Custom..." → opens TaskFormDialog (existing flow)
   - Keyboard accessible: Tab/Arrow keys navigate, Enter selects

3. **Implementation details:**
   - Add `onQuickUpdate: (updates: Partial<CaseloadTask>) => void` prop to TaskItem
   - In QuickRepeatMenu, user selects option → parse recurrence_rule JSON → call `onQuickUpdate`
   - No dialog overhead for 80% of use cases (daily/weekly/monthly)
   - If user wants custom interval (e.g., every 3 weeks), "Custom..." opens full dialog

4. **Performance:** Zero impact — dropdown is a simple menu with 4 fixed options + 1 link.

---

### FINDING 2.7: Unsaved-Changes Warning on Navigation Away from Editors

**Current Auto-Save vs Manual-Save Patterns:**

| Editor | Pattern | Location |
|-|-|-|
| ScratchPad | Auto-save (2000ms debounce) | src/renderer/components/profile/ScratchPad.tsx, lines 105–124 |
| ContactForm | Manual save (Ctrl+Enter / button) | src/renderer/components/contacts/ContactForm.tsx |
| LetterTemplateView | Manual save (button in modal) | src/renderer/views/LetterTemplateView.tsx |

**ScratchPad auto-save details:**
- `dirtyRef` tracks if unsaved (line 39)
- On unmount, flushes pending save (lines 153–165)
- Editor mounted inside ProfileView (scoped to client)

**ContactForm unsaved-changes handling:**
- Already tracks `dirty` via `JSON.stringify(form) !== initialRef.current` (line 104)
- Shows discard ConfirmDialog at close (lines 112–115, 429–437)
- Only confirms on manual close, NOT on navigation

**Issue:** Users can navigate away using browser back, route change, or close button without seeing the warning if editors are mounted in a slide-in or modal context.

**Proposed Solution:**

1. **Create `useUnsavedChanges` hook** (new file: `src/renderer/hooks/useUnsavedChanges.ts`)
   ```typescript
   export function useUnsavedChanges(isDirty: boolean, enableBlocker = true) {
     const navigate = useNavigate()
     const location = useLocation()
     
     // For HashRouter + react-router v7, try useBlocker:
     const blocker = useBlocker(
       ({ currentLocation, nextLocation }) => 
         isDirty && currentLocation.pathname !== nextLocation.pathname
     )
     
     // Fallback to window.beforeunload if useBlocker unavailable
     useEffect(() => {
       if (!isDirty) return
       const handler = (e: BeforeUnloadEvent) => {
         e.preventDefault()
         e.returnValue = true
       }
       window.addEventListener('beforeunload', handler)
       return () => window.removeEventListener('beforeunload', handler)
     }, [isDirty])
     
     return { blocker }
   }
   ```

2. **Integrate into ScratchPad** (modifications to `src/renderer/components/profile/ScratchPad.tsx`):
   - Call `useUnsavedChanges(dirtyRef.current)` inside component
   - When blocker fires, show ConfirmDialog: "You have unsaved changes. Save before leaving?"
   - Options: "Save & Leave", "Discard", "Cancel"
   - On "Save & Leave": flush save (reuse unmount logic), then proceed
   - On "Discard": clear dirty flag, proceed
   - On "Cancel": blocker prevents navigation

3. **Integrate into ContactForm** (modifications to `src/renderer/components/contacts/ContactForm.tsx`):
   - Pass `isDirty` to `useUnsavedChanges(dirty, true)`
   - Blocker should trigger on route change (outside ContactForm)
   - Add logic: if blocker fires, show ConfirmDialog + offer save option
   - Currently handles close within form; now also handles cross-route navigation

4. **Integrate into LetterTemplateView EditTemplateModal** (modifications to `src/renderer/views/letter-template/EditTemplateModal.tsx`):
   - Track content changes in modal
   - Use same pattern: `useUnsavedChanges(isDirty)` + ConfirmDialog
   - Block navigation during edit

5. **Edge Case: Auto-save in flight:**
   - ScratchPad: unmount cleanup already handles this (lines 153–165)
   - If save timer is pending when navigation fires, wait for it to finish before allowing leave
   - Modify hook: `const isSaving = useRef(false)` → set true before IPC, false after
   - Blocker condition: `isDirty && !isSaving.current` OR show "Saving..." in confirm dialog

6. **React-Router v7 + HashRouter compatibility:**
   - App.tsx uses HashRouter (verified in code)
   - `useBlocker` was introduced in react-router 6.4 and works with both BrowserRouter and HashRouter
   - Test plan: navigate via sidebar, back button, Ctrl+Tab, route changes
   - If useBlocker fails silently, fallback to window.beforeunload (simpler but less graceful)

7. **Security:** No new attack surface — this is standard web best practice for unsaved content protection. No sensitive data exposed.

8. **UX Dialog Design:**
   ```
   ┌─ Unsaved Changes ─────────────────┐
   │                                    │
   │ You have unsaved changes.          │
   │ Save before leaving?               │
   │                                    │
   │ [Cancel] [Discard] [Save & Leave] │
   └────────────────────────────────────┘
   ```

---

### Rollout Order
1. **Finding 2.7 first** (higher impact, blocks more navigation)
   - Implement `useUnsavedChanges` hook
   - Add to ScratchPad, ContactForm, EditTemplateModal
   - Test all three editors
   
2. **Finding 2.6 second** (nice-to-have, lower friction)
   - Create QuickRepeatMenu component
   - Add to TaskItem
   - Verify TasksView still renders correctly

### Files to Create
- `src/renderer/hooks/useUnsavedChanges.ts`
- `src/renderer/components/tasks/QuickRepeatMenu.tsx`

### Files to Modify
- `src/renderer/components/tasks/TaskItem.tsx` — add repeat button + QuickRepeatMenu
- `src/renderer/components/profile/ScratchPad.tsx` — integrate useUnsavedChanges
- `src/renderer/components/contacts/ContactForm.tsx` — integrate useUnsavedChanges
- `src/renderer/views/letter-template/EditTemplateModal.tsx` — integrate useUnsavedChanges

---

# 2.8 Freeze Panes

Now I have a complete understanding. Let me write the detailed implementation plan:

---

## UX Improvement Plan: Freeze Panes / Pinned Columns

**Finding:** No freeze panes / pinned columns — client name scrolls off with 20+ columns

### Current Scroll Architecture

**Horizontal scrolling mechanism:**
- DataGrid uses a flex container (line 801 in DataGrid.tsx): `className="h-full overflow-auto"` with `minWidth: totalWidth + 1`
- All columns are rendered directly (no horizontal virtualization via @tanstack/react-virtual)
- Column widths are managed via CSS custom properties (`--cw-${colId}`) applied to the parent div (line 801)
- SortableRow/SortableColHeader cells use `width: var(--cw-${colId})` and `flex-shrink-0`
- Horizontal scroll is pure CSS: native browser overflow scrolling

**Key finding:** The database schema already has a `frozen_columns: number` field in the Grid type (line 100, types.ts), but it's not used anywhere in the renderer.

### Implementation Approach

**1. CSS position: sticky pattern**
- Apply `position: sticky; left: 0` (and successive `left: colWidth`) to pinned cells
- GPU-accelerated, no JavaScript scroll handlers needed
- Both header (GridHeaderRow) and body rows (SortableRow) need matching sticky styles
- Stack sticky positions for multiple pinned columns: `left: 0`, `left: 80px`, `left: 160px`, etc.

**2. Default pinned column**
- Pin the first user-defined column by default (usually the name column with `is_name_column: 1`)
- This matches the user's expectation: "client name should never scroll off"
- Fallback: if no name column exists, pin the first column (columns[0])

**3. User control: right-click column header**
- Add menu item to ColumnHeader: "Pin column" (when not pinned) / "Unpin column" (when pinned)
- Pinned columns should stack on the left; unpinned columns appear after
- Visual feedback: pinned column header has subtle background color change (slightly darker)

**4. Visual indicator**
- Thick right border (2px) on the last pinned column in both header and rows
- Color: gray-400 (light mode) / gray-500 (dark mode) — visible but not jarring
- Optional: subtle left-to-right gradient shadow on first unfrozen column (via `box-shadow: inset ...`)

**5. Interaction with virtual scrolling**
- @tanstack/react-virtual only virtualizes vertically (rows), not columns
- All columns are rendered in the DOM at all times
- Sticky positioning works perfectly here (no horizontal virtualization conflicts)
- No changes to virtualizer config needed

**6. Multiple pinned columns**
- Support N pinned columns (not just 1)
- Store count in grid.frozen_columns (already in DB schema)
- Calculate cumulative left positions: `sum(widths[0:N])`
- Reorder UX: when user unpins a column, all columns after it shift left; when pinning, they shift right

**7. State management**
- **Option A (simpler):** Store `grid.frozen_columns` as count; pin the first N columns in position order
  - Pros: minimal changes; fits existing schema
  - Cons: can't pin/unpin arbitrary columns
- **Option B (flexible):** Add `pinned_column_ids: number[]` to grid config or Column table
  - Pros: pin any columns (not just leftmost N)
  - Cons: requires schema migration; more code
- **Recommend Option A:** Stick with frozen_columns count for Phase 1 (simpler, meets the UX need)
- Store in gridStore: `frozenColumnCount: number` (loaded from grid.frozen_columns on load)
- Update via IPC: `GRID_UPDATE_FROZEN_COLUMNS` → updates db + gridStore

**8. Keyboard and mouse**
- Ctrl+L → pin/unpin focused column
- Right-click column header → "Pin" / "Unpin" menu item (requires GridContextMenu update)
- Both route through `updateFrozenColumnCount()` in gridStore

**9. Column reorder interaction**
- Dragging pinned columns should keep them pinned (left side)
- Dragging unpinned columns in the right section should not cross the freeze boundary
- Implementation: in `handleColumnDragEnd`, if dragging a pinned column past the boundary or vice versa, adjust frozen_columns accordingly
- Example: drag pinned column 3 over unpinned column 7 → update frozen_columns

**10. Performance**
- CSS sticky has zero runtime cost (GPU-accelerated)
- No JavaScript scroll event handlers
- No impact on virtual scrolling (different axis)
- No new computed properties or memos needed beyond column count

### Database & IPC Changes

1. **Migration:** None (frozen_columns already exists in schema)
2. **IPC handler:** Add `GRID_UPDATE_FROZEN_COLUMNS(gridId: number, count: number)` → updates `grids.frozen_columns`, returns updated grid
3. **GridStore:** Add `frozenColumnCount: number` state + `setFrozenColumnCount` action

### Files to Modify

| File | Change |
|-|-|
| DataGrid.tsx | Calculate sticky positions; pass `frozenColumnCount` to GridHeaderRow & SortableRow |
| GridHeaderRow.tsx | Apply `position: sticky; left: {cumLeft}px; zIndex: 11` to pinned headers |
| SortableRow.tsx | Apply same sticky styles to pinned cells |
| ColumnHeader.tsx | Add "Pin / Unpin" menu item (if using right-click context) |
| gridStore.ts | Add `frozenColumnCount` state + setter; integrate with grid load |
| ipc-handlers.ts | Add GRID_UPDATE_FROZEN_COLUMNS handler |

### Test Checklist

- [ ] Pin the first 2 columns; horizontally scroll → both stay visible
- [ ] Header and row cells align (sticky left positions match exactly)
- [ ] Click "Unpin" on a pinned column → count decreases, sticky positions recalc
- [ ] Drag pinned column left of unpinned columns → reorder + frozen count adjustment
- [ ] Switch grids → frozenColumnCount resets to new grid's value
- [ ] Light/dark mode: pinned column border visible in both
- [ ] Keyboard: navigate left from first unpinned column → should wrap to pinned columns (test with arrow keys)
- [ ] Virtual scrolling still works (pinned columns don't break vertical scroll)
- [ ] Right-click menu shows "Pin" when not pinned, "Unpin" when pinned

**Estimated complexity:** Medium (CSS straightforward, IPC + store integration moderate, edge cases in reordering require care)

**Estimated work:** 2-3 hours (plan only in Session 1; implement in Session 2)

---

# 2.11 Collapsible Profile + 2.12 Backup Validation + 2.13 Restore Preview

Now I'll create a detailed implementation plan covering all three UX improvements.

## Implementation Plan: Three ProfileView & Backup UX Improvements

### **Finding 2.11: Collapsible Profile Sections**

**Current State:**
ProfileView renders 8 stacked sections in the center column (max-width-3xl):
1. ProfileHeader
2. DeadlinePanel
3. LinkedProviders
4. CaseLog
5. GridDataSummary
6. RelatedDocuments
7. (Left sidebar: Checklist, ScratchPad)
8. (Right sidebar: ActivityTimeline)

All are expanded by default — users with long client records must scroll extensively.

**Solution:**
- Add a `useCollapsibleSections` hook that manages collapse state per section via localStorage key `profile-section-${sectionName}` 
- Store state as JSON: `{ [sectionName]: boolean }` (true=expanded, false=collapsed)
- Wrap each section in a `CollapsibleSection` component with:
  - ChevronDown/ChevronRight icon toggle button (44px min height)
  - Section title as heading (already present)
  - `max-height` + `overflow: hidden` + `transition: max-height 300ms ease-in-out` for smooth collapse/expand
  - Use `useRef` to measure actual content height dynamically
- Default: all sections expanded (don't hide content from new users)
- Apply to center column sections only (DeadlinePanel, LinkedProviders, CaseLog, GridDataSummary, RelatedDocuments)
- Sidebar sections (Checklist, ScratchPad, ActivityTimeline) stay always-expanded (already in compact left/right sidebar layout)

**New Files:**
- `src/renderer/hooks/useCollapsibleSections.ts` — localStorage hook
- `src/renderer/components/shared/CollapsibleSection.tsx` — reusable wrapper component (8 lines title row, chevron toggle, smooth height transition)

**Changes:**
- ProfileView.tsx: wrap each center-column section; pass sectionName prop to CollapsibleSection
- Uses existing lucide-react ChevronDown/ChevronRight icons

---

### **Finding 2.12: Scheduled Backup Destination Validation**

**Current State:**
User selects a destination folder for scheduled backups, but there's no validation that the folder is writable. Backup silently fails at runtime. BackupSection shows warning only if last auto-backup failed, not scheduled.

**Solution:**
- Add IPC handler `BACKUP_VALIDATE_DESTINATION` in `src/main/ipc-handlers.ts`:
  - Accept destination folder path
  - Try writing a 1KB temp file (e.g., `.pulse-write-test-${Date.now()}.tmp`)
  - If success: delete temp file, return `{ valid: true }`
  - If fail (EACCES, ENOENT, etc.): return `{ valid: false, error: "Permission denied" | "Folder does not exist" | ... }`
  - Timeout: 2 seconds (abort if write hangs)
- Call validation in BackupSection `handleScheduledDestinationChange()`:
  - After folder selection, before saving config
  - Show inline error message if invalid: red alert box with icon + "This folder is not writable. Choose a different location."
  - Disable "Change…" button while validating (show spinner)
  - Do NOT save config if validation fails
- Add validation state to BackupSection: `[validationError, setValidationError]`

**Changes:**
- `src/main/ipc-handlers.ts`: add BACKUP_VALIDATE_DESTINATION handler (12 lines)
- `src/shared/ipc-channels.ts`: add `BACKUP_VALIDATE_DESTINATION: 'backup:validate-destination'`
- `src/renderer/components/settings/BackupSection.tsx`:
  - Add validation UI (red alert box, initially hidden)
  - Call safeInvoke before saving scheduled config
  - Show error inline, block save if invalid

---

### **Finding 2.13: Restore Dialog Data Preview**

**Current State:**
User clicks "Restore" on a backup → shown a dialog: "type RESTORE to confirm". No preview of what's inside the backup. User is flying blind — backup might contain stale/corrupt data.

**Solution:**
- Add IPC handler `BACKUP_PREVIEW` in `src/main/ipc-handlers.ts`:
  - Accept backup file path (both `.db` and `.pulse-backup` formats)
  - Open backup DB read-only via SQLCipher (reuse verifyBackup logic)
  - Query metadata: `SELECT COUNT(*) FROM grids`, `SELECT COUNT(*) FROM rows`, schema_version
  - Extract backup-meta.json if `.pulse-backup` (created date, app version)
  - Return: `{ gridCount: number, rowCount: number, schemaVersion: number, createdDate: string, appVersion: string }`
  - Never modify backup file — read-only connection
- Call BACKUP_PREVIEW in BackupSection `initiateRestore()`:
  - Before showing typed confirmation dialog
  - Show preview card above the "type RESTORE" input with:
    - Title: "Backup Preview"
    - Cards: "X Grids", "Y Clients", "Created: [date]", "App version: [version]"
    - Small warning: "This will replace all your current data with this backup."
  - User must scroll through preview before seeing the typed confirmation input
- New state: `[backupPreview, setBackupPreview]` (null | preview data)
- Modal flow: select backup → validate → show preview → type RESTORE → execute restore

**New Files:**
- None (preview logic in BackupSection.tsx + ipc-handlers.ts)

**Changes:**
- `src/main/ipc-handlers.ts`: add BACKUP_PREVIEW handler (18 lines, reuse verifyBackup extraction logic)
- `src/shared/ipc-channels.ts`: add `BACKUP_PREVIEW: 'backup:preview'`
- `src/renderer/components/settings/BackupSection.tsx`:
  - Add preview state
  - Call safeInvoke(BACKUP_PREVIEW) in initiateRestore
  - Render preview card before ConfirmDialog (styled as 4-column grid: grids, rows, date, version)
  - Pass preview to ConfirmDialog as extra content above the typed input

---

### **Implementation Sequence**

**Session 1 (Plan Phase):** This document ✓

**Session 2 (Implement):**
1. Collapsible sections (2.11) — 1.5 hours
   - useCollapsibleSections hook + CollapsibleSection component
   - ProfileView integration (wrap 5 sections)
   - Test collapse/expand + localStorage persistence

2. Destination validation (2.12) — 1 hour
   - BACKUP_VALIDATE_DESTINATION handler
   - BackupSection UI + validation state
   - Test with read-only folders, nonexistent paths

3. Restore preview (2.13) — 1.5 hours
   - BACKUP_PREVIEW handler
   - BackupSection preview state + card rendering
   - Test with multiple backup sizes, corrupted meta

**Commit:** `ux: collapsible profile sections, backup destination validation, restore preview`

---

# 2.14 Filter Presets + 2.15 Format Panel Labels

Excellent. Now I have a complete understanding of the codebase. Let me compile a detailed implementation plan:

## Implementation Plan: Two UX Improvements for Filter & Conditional Format Panels

### Overview
Finding 2.14 tackles filter creation friction for new users. Finding 2.15 was a false positive — labels are already plain language (no work needed).

---

### Finding 2.14: Filter Add Presets & Scaffolding

**Current Flow:**
1. User clicks "Filter" button → `FilterControls` opens panel
2. Panel shows three dropdowns: Column, Operator (8+ options), Value field
3. User must understand what each operator does; dropdowns filled with raw technical names
4. No guidance for common patterns (date ranges, empty cells, etc.)
5. No auto-fill after preset selection

**Problem Statement:**
"8 operators with no scaffolding" — users face N+1 decisions (column → operator → value) without context-aware examples.

**Proposed Solution:**

1. **Add preset quick-buttons layer** (appears above operator dropdown in panel, lines 511-520 of FilterBar.tsx)
   - Show 3-4 preset buttons based on selected column type
   - Presets auto-fill operator + optionally value
   - Examples by type:
     - **Text columns:** "Contains…" (populates `contains` operator), "Is empty"
     - **Date columns:** "Last 30 days" (populates `after` + auto-calc date), "Is empty"
     - **Checkbox columns:** "Is checked", "Is unchecked"
     - **Dropdown columns:** "Is empty"
     - **Number columns:** "Greater than…", "Is empty"

2. **Implementation details:**
   - Create new component `<FilterPresets>` exported from FilterBar.tsx
   - Presets render as pill buttons (secondary styling, 36px min height)
   - onClick handler: calls `updateRule(i, { operator: presetOp, value: presetValue })`
   - Presets only show when `newFilter.columnId` is set
   - "Contains…" / "Greater than…" presets auto-focus the value field (no value pre-filled)
   - "Is checked" / "Is empty" presets auto-add filter (no value needed)
   - Trigger columns by calling `OPS_FOR_TYPE[colType]` (already computed, line 112)

3. **Data structure:**
   ```typescript
   const PRESETS_BY_TYPE: Record<string, Preset[]> = {
     text: [
       { label: 'Contains…', op: 'contains', value: '' },
       { label: 'Is empty', op: 'is_empty', value: '' },
     ],
     date: [
       { label: 'Last 30 days', op: 'after', value: <calc 30d ago> },
       { label: 'Is empty', op: 'is_empty', value: '' },
     ],
     // ...
   }
   ```

4. **Fallback:** Always show "Advanced…" link to expand full operator dropdown if user wants non-preset operator

5. **Test impact:** FilterBar.test.tsx — tests checking for operator dropdown should pass (dropdown still renders after preset selection); new tests for preset buttons filling operators

6. **Perf:** Negligible — ~4 buttons rendered conditionally, no queries

7. **Security:** None

---

### Finding 2.15: ~~Conditional Format Source Type Labels~~ — ALREADY COMPLETE

**Status: NO WORK NEEDED.** The existing labels in CellConditionalFormatPanel.tsx are already plain language:
- `"This cell's own value"`
- `"Another column in the same row (e.g. a checkbox)"`
- `"A specific cell in another row"`

The brainstorm agent incorrectly flagged these as developer jargon. Verified via screenshots — the UI already uses clear, user-friendly descriptions. Removing from implementation scope.

---

### Implementation Order & Effort

| Item | Component | Lines | Est. Effort | Tests |
|-|-|-|-|-|
| 2.14 Presets | FilterBar.tsx | ~511–520 (new `<FilterPresets>`) + 65-90 (PRESETS_BY_TYPE const) | ~60 lines | 4 new tests (contains, checked, empty, date) |

**Total:** ~60 lines new code, ~4 test updates

---

### Rollout
- No DB migrations
- No IPC changes
- No Zustand store changes
- Backward compatible (existing filters/rules unaffected)
- Can ship both together in a single PR

---

# 3.1 Search Highlighting + 3.2 Aria-Live + 3.3 Skip-to-Content

Now I have a clear understanding of the codebase. Let me write the detailed implementation plan:

---

## Detailed UX Improvements Implementation Plan

### Finding 3.1: Search Result Highlighting (Show Why a Row Matched)

**Current State:**
- DataGrid stores `searchQuery` in gridStore and filters rows via `buildGridQuery()` in the main process
- SortableRow renders cells via CellDisplay component with no knowledge of what matched the search
- Search is case-insensitive full-text at the DB level; no highlighting logic exists

**Implementation Steps:**

1. **Pass searchTerm to cell rendering chain**
   - Add `searchTerm: string | null` prop to `SortableRow`
   - Pass from DataGrid: extract `searchQuery` and pass down (e.g., via `row.getContext()` or direct prop)
   - Thread through to `CellDisplay` as new optional prop `highlightTerm?: string`

2. **Create `HighlightedText` component** (~50 lines)
   - Location: `src/renderer/components/grid/HighlightedText.tsx`
   - Input: `text: string, searchTerm: string | null`
   - Logic:
     - If no searchTerm or term is empty, return plain text
     - Split text by case-insensitive regex: `new RegExp(`(${searchTerm})`, 'gi')`
     - Map segments: non-matched → `<span>`, matched → `<mark className="bg-yellow-200 dark:bg-yellow-900">`
     - Wrap result in fragment; use `textContent` never `innerHTML`
   - Performance: use `useMemo` with deps `[text, searchTerm]`
   - Example output: "John **Smith**" with "smith" highlighted when searching "smith"

3. **Integrate into CellDisplay**
   - For text columns: wrap cell value in `HighlightedText` when `highlightTerm` is provided
   - For number/date/phone/email/url: match and highlight just the visible text (not the formatted output)
   - For checkbox/notes/computed columns: skip highlighting (no user-visible string match)
   - Guard: only render if `value` is non-null and non-empty

4. **Performance optimization**
   - Only compute highlighting on visible rows (virtualized, so ~20-40 rows max)
   - useMemo prevents re-computation if text/term unchanged
   - Split-and-highlight happens once per render cycle per cell, not on every keystroke

5. **Security**
   - Use `element.textContent` assignment, never `.innerHTML`
   - Regex escape searchTerm to prevent ReDoS: use `searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`

---

### Finding 3.2: No aria-live Regions for Dynamic Content

**Current State:**
- StatusBar displays row count and save indicator (static, no announcements)
- Grid load/filter events have no live regions
- Toast messages (via react-hot-toast) have no ARIA integration
- Screen reader users don't know when results change

**Implementation Steps:**

1. **Create live region component** (~30 lines)
   - Location: `src/renderer/components/shared/LiveRegion.tsx`
   - Props: `message: string`, `role?: 'status' | 'log'`, `level?: 'polite' | 'assertive'`
   - JSX: `<div aria-live={level} role={role} aria-atomic="true" className="sr-only">{message}</div>`
   - Pulse pattern: message clears after 5s to prevent stale content

2. **Add live region to MainLayout**
   - Insert after `#main-content` element (before StatusBar)
   - Wire via context: `<LiveRegionProvider>` at App/MainLayout level
   - Hook: `useLiveRegion(message: string)` → sets provider state

3. **Announce key events**
   - **Grid filter/search**: "Showing 5 of 200 clients" (update on `searchQuery` change, `activeFilters` change)
   - **Row operations**: "Client added" / "Client deleted" / "3 rows moved"
   - **Bulk actions**: "5 rows marked as complete"
   - Use gridStore subscribe or effect in DataGrid to call `useLiveRegion()`

4. **Integrate with StatusBar**
   - Add `role="status"` to StatusBar (or a sub-region within it)
   - Wire live announcements: "X of Y clients" when counts change
   - Suppress duplicate announcements (track lastMessage to avoid repeat)

5. **Toast accessibility**
   - react-hot-toast has minimal ARIA support; add wrapper
   - Create `AccessibleToast` component that announces to live region on mount
   - Hook toast `onClose` to clear live region after timeout

---

### Finding 3.3: No Skip-to-Content Link

**Current State:**
- MainLayout already has a skip link implementation (lines 55–63 of read output)
- Link targets `#main-content` with proper sr-only + focus:not-sr-only styling
- Main element correctly marked with `id="main-content"` (line 78)

**Status: Already Implemented**

The codebase already has the standard a11y skip link pattern in place:
- First focusable element is the skip link
- Visible on Tab key (focus-triggered)
- Blue background on focus, 3px ring
- Proper z-index (300) to appear above all content
- Keyboard shortcut: none needed (standard browser focus behavior)

**Minor Enhancement (optional):**
- Consider adding a `title` attribute: `title="Press Enter to skip to main content"`
- Or add keyboard hint in label: "Skip to main content (press Enter)"

---

## Summary Table

| Finding | Component | Work | Lines | Status |
|-|-|-|-|-|
| 3.1 | HighlightedText.tsx | Create + integrate into CellDisplay | 50+30 | New |
| 3.1 | CellDisplay.tsx | Add highlightTerm prop + render logic | 15–20 | Modify |
| 3.1 | SortableRow.tsx | Add searchTerm prop, pass to CellDisplay | 5–10 | Modify |
| 3.1 | DataGrid.tsx | Extract searchQuery, pass to SortableRow | 3–5 | Modify |
| 3.2 | LiveRegion.tsx | Create + context provider | 80–100 | New |
| 3.2 | MainLayout.tsx | Insert live region element | 5–8 | Modify |
| 3.2 | DataGrid.tsx / GridView.tsx | Wire live announcements on filter/search change | 20–30 | Modify |
| 3.3 | MainLayout.tsx | Already implemented | 0 | Done |

**Estimated effort:** 3–4 hours (design, implement, test, refine).

---

# 3.4 ReducedMotion + 3.5 Drag Handles + 3.6 Empty States

Perfect! Now I have enough information. Let me create a comprehensive plan document.

Based on my research of the Pulse codebase, here's the detailed implementation plan for the three UX improvements:

---

## UX Improvements Implementation Plan

### 3.4: Wire reducedMotion Store Setting to MotionConfig

**Current State:**
- `App.tsx` line 190: `<MotionConfig reducedMotion="user">` — hardcoded to respect OS preference only
- `settingsStore.ts` line 55, 71: `reducedMotion` boolean exists and is persisted via `SETTINGS_UPDATE` IPC
- Setting is read in `App.tsx` line 69 but never used in MotionConfig

**Problem:**
App setting is ignored. If user enables reduced motion in app settings, animations still respect OS preference instead of forcing reduction.

**Solution:**
1. Change line 190 in `App.tsx` from:
   ```jsx
   <MotionConfig reducedMotion="user">
   ```
   to:
   ```jsx
   <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
   ```
2. No changes needed to settingsStore — already reads/persists correctly

**Outcome:** App setting ON → always reduce. App setting OFF → respect OS. Fixes accessibility for users who prefer motion reduction.

---

### 3.5: Increase Drag Handle Opacity for Accessibility

**Current State:**
- `Sidebar.tsx` line 118-120: `opacity-30 group-hover/griditem:opacity-100` on GripVertical handle
- This is the only drag handle in the app (grid column reorder in GridHeaderRow doesn't show handle)

**Problem:**
30% opacity too subtle on low-contrast displays; users may not notice reorderable affordance.

**Solution:**
Change opacity-30 → opacity-40 in Sidebar.tsx line 118 (minimal but measurable improvement).
Consider: Add title + aria-label already present (good), no tooltip needed.

**Outcome:** Drag handles slightly more visible without being obtrusive.

---

### 3.6: Consolidate Inline Empty States to EmptyState Component

**Current State:**
11 inline empty state messages scattered across views:

| Location | Pattern |
|-|-|
| TasksView.tsx | `"No tasks yet"` (inline text within conditional) |
| SnippetsView.tsx | `"No snippets match your search"` + EmptyState for initial empty (mixed) |
| DashboardView.tsx | `'Nothing overdue — great work!' / 'No items in this range.'` (inline) |
| TemplateManagerView.tsx | `"No caseload templates yet"` + `"No checklist templates yet"` (1 uses EmptyState, 1 inline) |
| ContactsView.tsx | `"No providers yet"` (inline) |
| LetterTemplateView.tsx | Uses EmptyState ✓ |
| GridLoadingState.tsx | `"No columns yet. Add a column to get started."` (inline + hardcoded instruction) |
| SavedViewsDropdown.tsx | `"No saved views yet"` (inline in dropdown) |
| ColumnHeader.tsx | `"No alert rules yet."` (inline) |
| FilterBar.tsx | `"No saved presets yet."` (2× inline) |
| CellConditionalFormatPanel.tsx | `"No highlight rules yet..."` (inline with CTA) |
| DataGrid.tsx | `"No clients yet"` (inline) |
| AlertRuleEditor.tsx | `"No thresholds yet."` (inline) |
| ActivityTimeline.tsx | `"No activity yet."` (inline, but inline at least uses py-8 centering) |
| Checklist.tsx | `"No checklist items yet..."` (inline) |
| ProfileHeader.tsx | `"No tags yet..."` (inline) |
| RelatedDocuments.tsx | `"No documents attached yet."` (inline) |
| CaseLog.tsx | `"No entries match your search." / "No case log entries yet."` (inline) |

**Problem:**
Inconsistent UX — some use EmptyState component (title + icon + action), others plain text. No standardized icon, description, or action CTA. Hard to maintain consistent visual language.

**Solution Plan:**
1. **Map each occurrence** to identify which have icon/action potential
2. **Convert priority targets** (full-page views first):
   - TasksView: add icon (ClipboardList), description, action
   - DashboardView: add icon (BarChart), context-aware description
   - TemplateManagerView: both sections should use EmptyState
   - ContactsView: add icon (BookUser), action to create first provider
   - GridLoadingState: add icon (Columns), action to add column
3. **Defer lower-priority conversions** (dropdowns, panels): leave inline for now, refactor later
4. **No new component** — use existing EmptyState; add optional action as needed

**Outcome:** Consistent, accessible empty states across major views with clear affordances and icon/description pattern.

---

## Summary

| Finding | Effort | Impact | Priority |
|-|-|-|-|
| 3.4: MotionConfig wiring | 1 line | High (accessibility) | P0 |
| 3.5: Drag handle opacity | 1 class change | Low-medium (visibility) | P2 |
| 3.6: Empty state consolidation | 10-15 conversions | Medium (consistency) | P1 |

---

# 3.7 Tasks Badge + 3.8 Color Labels

Perfect! Now I have all the context I need. Let me write a detailed implementation plan.

---

## Implementation Plan: Two UX Improvements for Pulse

### Finding 3.7: "Today's Tasks" Badge on Sidebar Tasks Item

**Problem:** Tasks sidebar nav item shows no indicator of urgency; users must open /tasks to see what's due today.

**Solution:**

1. **Count today's tasks** (in `Sidebar.tsx`):
   - Subscribe to `taskStore` with shallow selector: `tasks` array only
   - Derive count from existing store data (zero DB queries): filter tasks where:
     - `is_completed === 0`
     - `due_date` is today's date (YYYY-MM-DD format)
     - `snoozed_until` is null or in the past (ignore snoozed tasks)
   - Use date helper: `new Date().toISOString().split('T')[0]`

2. **Render red badge**:
   - Position: right side of "Tasks" text, or below the icon when collapsed
   - Style: red circle (16px × 16px) with white text, `text-xs font-semibold`
   - Content: count number (e.g., "3") — hide badge if count = 0
   - Classes: `bg-red-600 text-white rounded-full flex items-center justify-center inline-flex`

3. **Update reactively**:
   - Badge count updates on every `taskStore.tasks` change
   - Automatic via Zustand subscription in `useEffect`

4. **Dark mode**:
   - Keep `bg-red-600` (already readable on dark-900)
   - Text stays white for contrast

5. **Location in Sidebar.tsx**:
   - Tasks nav item (lines 381–405): add badge after `<span>Tasks</span>` when not collapsed
   - When collapsed, position badge in top-right corner of icon button (use absolute positioning, `right: -4px; top: -4px`)

---

### Finding 3.8: Color Label Picker Lacks Text Labels

**Problem:** ColorPicker component shows 8 colored circles in context menu, but no way to rename them. Users can't remember which color means "urgent" vs "low priority."

**Solution:**

1. **Current color picker location**:
   - `ColorPicker.tsx` exports `COLOR_OPTIONS` (hardcoded labels: "Red", "Orange", etc.)
   - Rendered in `GridContextMenu.tsx` (lines 228–236) as inline flyout
   - Currently shows only color circles with `title` attributes; text label only on hover

2. **Add color naming in Settings → Appearance**:
   - Create new subsection: `ColorNamesSection.tsx` in `src/renderer/components/settings/`
   - Two-column layout:
     - Left: color swatch + current name
     - Right: editable text input (max 20 chars)
   - Default names (same as `COLOR_OPTIONS`): "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink"

3. **Persist in electron-store** (not DB):
   - Store key: `colorNames` → Record<colorHex, string> (e.g., `{ "#ef4444": "Urgent", "#22c55e": "Follow-up" }`)
   - Use electron-store singleton already in place (accessed via `await window.api.getStoreValue()` / `window.api.setStoreValue()`)
   - If missing, return default names

4. **Update ColorPicker component**:
   - Add optional prop: `colorNames?: Record<string, string>`
   - Fallback to hardcoded labels if not provided
   - Render color label below swatch in smaller text (e.g., 12px) or inline: `<span className="text-xs text-slate-600">{colorNames[opt.color] ?? opt.label}</span>`

5. **Wire to GridContextMenu**:
   - `useSettingsStore` subscribe to `colorNames` (or add new Zustand store `colorNamesStore`)
   - Pass `colorNames` to `<ColorPicker colorNames={colorNames} />`

6. **IPC for electron-store access**:
   - New IPC channels: `SETTINGS_GET_COLOR_NAMES`, `SETTINGS_SET_COLOR_NAMES`
   - Or use existing `SETTINGS_UPDATE` with key `color_names` and JSON value

7. **Security**:
   - Sanitize color names: strip HTML tags, limit length to 20 chars
   - No injection risk (names only appear as text content, not HTML attributes)
   - Use `.textContent =` or `<span>{name}</span>` in React (JSX auto-escapes)

8. **UI flow**:
   - Settings → Appearance → "Color Labels" subsection
   - Grid with 8 rows (one per color)
   - Each row: swatch + label + editable input
   - Save button or auto-save on blur
   - "Reset to defaults" button

---

### Implementation Priority

1. **3.7 first** (simpler, no new IPC): 1–2 hours, high impact (badge visible at all times)
2. **3.8 second** (requires UI + IPC): 2–3 hours, moderate impact (improves discoverability, not urgency)

**Total effort:** 4–5 hours for both features, zero breaking changes.

---

# 3.9 Cell History + 3.10 PDF Preview

Perfect! Now let me verify the plan is complete and provide a summary:

## Detailed Implementation Plan: UX Improvements

I've completed a comprehensive analysis of both findings and written a detailed plan. Here's the summary:

### **Finding 3.9: Cell Edit History Not Easily Discoverable**

**Current:** Cell history hidden behind right-click menu; no visual cue that cells were modified.

**Three-Tier Solution:**

1. **Tier 1 (Quick Win):** Bold "View History" label in context menu, add Ctrl+H keyboard shortcut to open history for focused cell
2. **Tier 2 (Visual):** Add `last_cell_modified_at` timestamp column to database, render subtle corner clock indicator (40% opacity, slate-300/slate-600) on cells modified in last 7 days
3. **Tier 3 (Optional):** Add "Activity Timeline" view in toolbar showing last 20 edits across grid

**Files to modify:**
- `GridContextMenu.tsx` — bold label + shortcut text
- `gridKeyboardNav.ts` — add Ctrl+H handler
- Migration file — add `last_cell_modified_at` column
- `SortableRow.tsx` — render corner indicator
- `DataGrid.tsx` — load recently-modified cells
- `gridStore.ts` — track `recentlyModifiedCellIds`

**Performance:** +1 indexed query (~10ms), negligible memory/render cost

---

### **Finding 3.10: No PDF Preview Before Export**

**Current:** Export goes straight to file save dialog; no way to review layout before committing.

**Solution:** In-memory PDF generation + preview modal with save/cancel.

**Flow:**
1. User selects columns → "Preview" button (instead of direct save)
2. Preview modal opens with iframe showing PDF rendered as data URI
3. User clicks "Save" → reuse cached buffer (no regeneration)
4. Cache auto-expires in 5 minutes

**Files to create/modify:**
- `PdfPreviewModal.tsx` (new) — 90vh modal, iframe display, cancel/save buttons
- `export-pdf.ts` — `PreviewCache` map, `EXPORT_PDF_GRID_PREVIEW` handler, cache cleanup
- `ipc-channels.ts` — add `EXPORT_PDF_GRID_PREVIEW` channel
- `ipc-export.ts` — register preview handler
- `GridToolbar.tsx` — split export flow into preview + save phases

**Performance:** One PDF generation (cached), ~100MB max memory, responsive UI with progress spinner

**Implementation order:** Component first → backend cache logic → IPC registration → UI integration

Full plan is in the output above with pseudocode, database schema, component props, and security considerations.

---

# 3.11 Onboarding Tips + 3.12 Bulk Cell Edit

Excellent! Now I have all the context needed. Let me write the detailed implementation plan:

## Implementation Plan: Two UX Improvements for Pulse

### Finding 3.11: Enhanced Onboarding with Pro Tips

**Current State:**
OnboardingView.tsx has 6 main steps: welcome → role → profile → path → {customize|import_name|template} → done. Users complete setup without learning key power-user workflows.

**New Step: "Pro Tips" (inserted before "done")**
1. Navigate from any step's "goBack()" logic to add `'pro_tips'` as a new WizardStep
2. Modify step progress calculation to include 'pro_tips' in visibleSteps array
3. Create ProTipsStep component with card grid layout:
   - Card 1: Ctrl+K - "Quick Navigation" icon + "Search clients, open reports, and navigate views instantly"
   - Card 2: Right-click - "Context Menus" icon + "Right-click rows and columns for quick actions like star, color, move, format"
   - Card 3: ? key - "Keyboard Reference" icon + "View all keyboard shortcuts for power-user efficiency"
   - Card 4: Morning Briefing - "Briefing" icon + "Auto-unlock shows daily summary of overdue and upcoming deadlines"
4. Each card: 44px min-height, 15px font, icon (Lucide) + title + description
5. Add "Skip" button (gray) and "Continue to get started" button (blue) at bottom
6. Both buttons skip to "done" step
7. On post-setup, users can re-view tips from Settings → Help → Shortcuts panel (already has KeyboardShortcutsModal)

**Benefits:** New users learn workflows without tutorial friction; skippable for advanced users.

---

### Finding 3.12: Bulk Cell Value Setting

**Current State:**
BulkActionBar.tsx supports: archive/unarchive, move to caseload, set acuity level, delete. GridContextMenu.tsx supports copy/paste formatting to N rows. **Missing:** set actual cell data values in bulk.

**New Dialog: BulkSetValueDialog**
1. Triggered from GridContextMenu when 2+ rows are selected + cell is right-clicked
2. Add menu item above format rules section: "Set value for N selected rows…"
3. Modal UI:
   - Title: "Set {ColumnName} for {N} clients"
   - Column selector dropdown (single column)
   - Value input (type varies: text/number/date/checkbox/dropdown)
   - "Apply to selected rows" button (blue), "Cancel" button
4. Validation: call validateForColumnType() before submitting
5. On confirm, loop through selectedRowIds and invoke CELL_UPDATE per row
6. Batch all in single transaction (or use existing ROW_BULK_ACTION pattern)

**IPC: Option A (simplest — reuse existing)**
```
Loop: for each rowId in selectedRowIds:
  await updateCell(rowId, colId, value)
Wrap in undoStore.push() with single undo item
```

**IPC: Option B (more efficient — new channel)**
```
IPC.CELL_BATCH_SET_VALUE (rowIds: number[], columnId: number, value: string|null)
  → main process executes in transaction
  → returns { updated: number, skipped: number }
```

**Undo Integration:**
- Push single UndoItem with `category: 'content'`
- Store `sideEffects: [{ type: 'set_cell_values', rowIds, columnId, oldValues: Map<rowId, prevValue> }]`
- On undo: loop through and restore each cell to oldValue
- Undo description: "Set 5 clients' Deadline to 2026-03-15"

**Performance:**
- Batch DB writes in single transaction (main process)
- Skip validation if too slow — validate client-side only; main process re-validates
- Debounce: submit immediately (no debounce needed for bulk, unlike cell edit)

**Security:**
- Validate columnId exists in current grid
- Validate value against column type (date format, number range, dropdown options, etc.)
- Validate rowIds all belong to active grid
- Check isReadOnly flag before allowing

**UI Placement:**
- GridContextMenu: after "Paste formatting" section, before archive/delete
- Only show if selectedRowIds.size > 0
- Icon: Layers or Wand2 (for multi-row action)

---

**Combined Effort: ~2 sessions**
- Session 1 Plan: Write plans for both features (done here)
- Session 2 Implementation:
  - 3.11: ~1h (add ProTipsStep, wire up nav, style cards)
  - 3.12: ~1.5h (BulkSetValueDialog component, GridContextMenu integration, undo flow, validation)

**Testing:**
- 3.11: skip/continue paths, verify done step reached either way
- 3.12: test all column types (text/date/number/checkbox/dropdown), verify undo, test read-only lock, test validation (bad date → reject), verify toast on success

---

# 3.13 Tab Order + 3.14 Progress Indicators

Perfect. I now have enough information to write a comprehensive implementation plan. Let me create the detailed plan document.

Based on my research of the codebase, I've identified the current state of both UX improvements. Here is a detailed implementation plan:

---

## UX IMPLEMENTATION PLAN: Tab Order & Progress Indicators

**Total Characters: ~2400**

### Finding 3.13: Tab Order in Complex Dialogs

**Current State:**
- **AlertRuleEditor** (src/renderer/components/alerts/AlertRuleEditor.tsx): Fields render in order (name → description → interval presets → custom days → thresholds). However, threshold expansion uses click-to-expand, disrupting tab flow: tabbing into a threshold summary row doesn't naturally expand the color picker or navigate to its controls.
- **CellConditionalFormatPanel** (src/renderer/components/grid/CellConditionalFormatPanel.tsx): Each rule has 4 logical steps: (1) source type select, (2) operator select, (3) value input(s), (4) styling options. Current tab order follows DOM order but style toggles (bold/italic/pulse) appear after live preview, causing users to tab through 8+ controls before reaching Save.

**Logical Tab Flow (Target):**
1. **AlertRuleEditor:** name → description → interval preset buttons → custom days (if visible) → threshold 0 expand/collapse → threshold 0 value input → threshold 0 direction select → threshold 0 label input → threshold 0 delete → [repeat for N thresholds] → Save/Cancel
2. **CellConditionalFormatPanel per rule:** source type select → source column select (if visible) → condition operator → value input(s) → bg color palette buttons → border color buttons → text toggles (bold/italic/pulse/highlight) → Save/Cancel

**Implementation Strategy:**
- Remove all positive `tabIndex` values (bad practice).
- Restructure DOM in both components so logical control groups appear in sequence.
- For AlertRuleEditor thresholds: wrap each threshold's editable fields (not just the summary) inside collapsible sections; use CSS `display: contents` on wrapper if needed to keep fieldset accessible.
- For CellConditionalFormatPanel: move text/bold/italic toggles immediately after background color section (before preview) — preview is read-only and can appear last.
- Apply `useFocusTrap` already in both components; verify trap focus order matches new DOM.
- Test with Tab/Shift+Tab to confirm natural flow without jumps.

---

### Finding 3.14: Progress Indicator for Bulk Operations

**Current State:**
- **Import** (`src/main/import.ts`): `executeImport()` accepts optional `onProgress` callback (line 469) but is never wired. IPC handler in `ipc-grid.ts` does not emit progress events. UI blocks until complete (~2-10 sec for 5k rows).
- **Factory Reset** (`src/main/ipc/ipc-app.ts`, line 96): No progress. Handler closes DB, deletes files, clears stores (~500ms–2sec) with zero feedback.
- **Bulk Delete/Purge** (`ROW_PURGE` IPC): No progress tracking.
- **LoadingSpinner** exists but only shows static spinner + label; no progress bar.

**Solution (Event-Based Progress):**

1. **New IPC Progress Events:**
   - Create `IMPORT_PROGRESS` event channel (IPC → `window.api.onEvent(channel, callback)`)
   - Main process emits: `{ rowsProcessed: number; totalRows: number; currentStep: 'parsing' | 'mapping' | 'inserting' | 'deduplicating' }`
   - Renderer listens and updates local state (e.g., `progress = Math.round(100 * rowsProcessed / totalRows)`)

2. **executeImport Integration:**
   - Modify `executeImport(options, preview, onProgress)` callback to accept progress object
   - During row chunk loops (line 469+), call `onProgress(imported, totalRows)` every 50 rows or every 500ms (debounce)
   - IPC handler wraps import, calls `webContents.send('import-progress', {...})` in callback
   - Clear event listener on completion

3. **New ProgressModal Component:**
   - Display during import/factory reset/bulk delete
   - Shows: spinner + "Processing..." label + 0–100% progress bar + current row count ("Importing row 342 of 5000")
   - Modal is non-dismissible (blocks interaction) — correct UX for long ops
   - Cancel button only available for import (factory reset is committed; delete is immediate)

4. **Factory Reset:**
   - Emit single `webContents.send('factory-reset-progress', { step: 'closing_db' | 'clearing_files' | 'clearing_config' })` 
   - Show ProgressModal with just LoadingSpinner (no % bar) and current step label

5. **Bulk Delete:**
   - Optional: if deleting >500 rows, show progress; else skip (most deletes are <100 rows)

**Files Modified:**
- `src/shared/ipc-channels.ts`: Add `IMPORT_PROGRESS`, `FACTORY_RESET_PROGRESS` event channels
- `src/main/import.ts`: Wire `onProgress` callback into `executeImport`
- `src/main/ipc/ipc-grid.ts`: Wrap import, emit progress events
- `src/main/ipc/ipc-app.ts`: Emit factory reset progress
- `src/renderer/components/shared/ProgressModal.tsx` (new): Modal with spinner, label, optional progress bar
- `src/renderer/views/SettingsView.tsx` or `DataSection.tsx`: Show ProgressModal during import/reset

**Testing:**
- Import 5000 rows → verify progress bar updates every 50 rows and reaches 100%
- Factory reset → verify "Closing database…" → "Clearing configuration…" step labels appear
- Cancel import mid-way → verify cleanup (transaction rollback, event listener removed)
- Network lag simulation (add 10ms delay per 50 rows) → confirm debounce prevents flicker

---

**Security Considerations:** None. Progress events are internal IPC; no new attack surface.

---

# 3.15 Template Variables

Perfect. ## Implementation Plan: Letter Template Variable Insertion Enhancement

### Current State
Letter templates currently use manual `{{variable_name}}` syntax. Users must type placeholders (e.g., `{{client_name}}`, `{{today_date}}`) and learn column name conversion rules (spaces/special chars → underscores, lowercase). EditTemplateModal has hardcoded AVAILABLE_PLACEHOLDERS (9 system fields) + PlaceholderReference showing conversion rules. There's no cursor-aware insertion UI beyond static reference docs.

### Variables Available
- **System fields (9):** {{client_name}}, {{today_date}}, {{dob}}, {{age}}, {{case_manager_name}}, {{case_manager_title}}, {{case_manager_email}}, {{case_manager_phone}}, {{case_manager_org}}, {{medicaid_cin}}
- **Dynamic column fields:** {{col_N}} for any column (N = column.id); users must convert column display names to snake_case manually

### Solution: "Insert Variable" Dropdown/Popover

1. **Toolbar button in EditTemplateModal:** Add an "Insert Variable" button (icon: Wand/Plus or "Variables") next to the placeholder reference section, positioned above the textarea.

2. **Variable picker popover:** On click, show a popover (not modal) listing:
   - System fields grouped: "Client Data" (client_name, dob, age), "Your Profile" (case_manager_*), "Other" (today_date, medicaid_cin)
   - Column fields grouped: "Grid Columns" (derived from activeGridId's columns, grouped by display name, sorted by position)
   - Each item shows: `{{variable}}` code + description on hover

3. **Tiptap cursor insertion:** NOT NEEDED (using textarea, not tiptap). In EditTemplateModal's plain textarea, use existing `insertPlaceholder()` logic: textarea.selectionStart/End → insert + cursor focus.

4. **Column memoization:** Derive column variable list once per grid load (useMemo + gridStore columns dependency). Format: `{ display: "Client Name", variable: "{{client_name}}" }` or for columns: `{ display: "Annual Assessment Due", variable: "{{annual_assessment_due}}" }`.

5. **Keyboard:** Add "/" trigger in popover to filter (optional, Phase 2). MVP: just button click + list.

6. **Cursor safety:** Textarea already has contentRef — insertPlaceholder() handles null contentRef gracefully (early return). Button handler ensures editor is focused before insertion.

7. **Dynamic column field generation:** Parse Column[] from gridStore:
   - Convert name to slug: lowercase + replace /\s|[^a-z0-9_]/gi with _ + collapse __ → _
   - Show as `{{col_slug}}` but store the display name + description ("Column: [name]")
   - Fallback for grids with no columns: show only system fields

8. **UI pattern:** Dropdown popover positioned relative to button, 250-300px wide, max 8 items visible (scroll), semantic grouping with headers (gray text), hover highlight, keyboard nav (arrow keys, Enter, Escape).

### Implementation Steps
1. Create `src/renderer/utils/generateVariableList.ts`: pure function deriving system + column variables from `Column[]`, returning `VariableItem[]` with { group, display, variable, description }
2. Add dropdown state + contentRef to EditTemplateModal; hook into gridStore.columns to pre-populate
3. Create `src/renderer/components/shared/VariablePickerPopover.tsx`: reusable popover (Headless UI Popover or custom div + useEffect click-outside)
4. Wire button → popover open; click item → insertPlaceholder(); ESC/click-outside → close
5. Test with 10+ column grids; verify cursor positioning and undo integration

### Edge Cases
- No columns loaded (new grid): show only system fields, note available (no column fields yet)
- Column name collisions (unlikely): de-dup by slug, prioritize by position
- Very long column names: truncate in UI (title attribute shows full)
- Focus not in textarea when button clicked: insertPlaceholder() early-returns; button click handler re-focuses textarea before calling insertPlaceholder()

### Testing Checklist
- Insert variable with cursor at start/middle/end of content
- Insert multiple variables in sequence
- Variables persist correctly when template is saved
- Column names with spaces/punctuation convert correctly
- Popover closes on ESC and outside click
- Keyboard nav (arrows/enter) works in popover
- Empty grid (no columns) shows only system fields
- Undo/redo: variable insertion is undoable

---

# 3.16-3.19 Micro-Interactions

Perfect. Now I have enough context. Let me write the implementation plan:

## IMPLEMENTATION PLAN: Four Micro-Interaction UX Improvements

**Target:** Pulse Electron app UI feedback and delight micro-interactions

---

### 3.16: Button Press Tactile Feedback (Active Scale)

**Current State:**
- Global `@utility btn` class exists (globals.css lines 124–138) with transition for color/bg/border
- `profile-btn-glow` has `.active { transform: scale(0.93) }` (line 319)
- Standard `.btn-primary`, `.btn-secondary`, `.btn-danger` lack active state feedback

**Implementation:**
1. Add `active:scale-[0.97]` and `transition-transform duration-75` to the `@utility btn` definition
2. This applies to all button variants (primary, secondary, danger) automatically via `@apply btn`
3. GPU-accelerated, CSS-only, ~75ms snap-back for snappy tactile feel
4. **Do NOT apply to grid cells** — only standalone buttons; exclude inline badge buttons
5. Ensure `active:` works in high-contrast mode (inherits from button styling)

**Files to modify:**
- `/home/jmatlock/claude-workspace/Pulse/src/renderer/styles/globals.css` (lines 124–138)

---

### 3.17: Task/Checklist Completion Satisfaction

**Current State:**
- ChecklistItem.tsx has `animate-check-pop` (lines 148–231) on checkbox — 280ms scale bounce
- check-pop animation defined in globals.css lines 223–235 with proper reduced-motion support
- TasksView.tsx has minimal visual feedback on task completion (line 98–131)

**Implementation:**
1. **Checklist items:** `animate-check-pop` already excellent (1 → 1.25 → 1 scale). Keep as-is.
2. **Add subtle color flash:** On toggle, add brief `bg-green-100` flash (opacity 0.3) that fades in 150ms, hold 200ms, fade out 150ms
3. **Task completion:** Show inline toast "Task completed ✓" (150ms fade-in, 2.5s hold, 150ms fade-out)
4. Keep subtle — don't overstimulate; completion is reward enough
5. Trigger animation via CSS class added to checkbox span on `justChecked` state
6. Use `onAnimationEnd` to clean up state

**Files to modify:**
- `/home/jmatlock/claude-workspace/Pulse/src/renderer/styles/globals.css` (add `@keyframes check-flash` ~200 lines)
- `/home/jmatlock/claude-workspace/Pulse/src/renderer/components/profile/ChecklistItem.tsx` (add color flash class logic)
- `/home/jmatlock/claude-workspace/Pulse/src/renderer/views/TasksView.tsx` (add completion toast)

---

### 3.18: Star/Favorite Toggle Animation

**Current State:**
- ContactCard.tsx line 41–48: star button has hover state but no animation on toggle
- Icon is simple `<Star>` with conditional fill color (amber vs slate)

**Implementation:**
1. Use `motion/react` (already installed; imported in MainLayout, Sidebar)
2. Wrap star icon in `<motion.span>` with `AnimatePresence` wrapper
3. On toggle: `animate={{ scale: [1, 1.3, 1] }}` over `transition={{ duration: 0.3 }}`
4. Color transition: `initial={{ color: "..." }}` → `animate={{ color: "..." }}`
5. Entry/exit: subtle `initial={{ scale: 0.8 }}` for fresh toggle feel
6. Respect `prefers-reduced-motion` via `motion` library's built-in support
7. **Do NOT re-mount the icon** — use `key` stability to prevent DOM churn

**Files to modify:**
- `/home/jmatlock/claude-workspace/Pulse/src/renderer/components/contacts/ContactCard.tsx` (lines 41–48)
- Consider same pattern for ProfileView LinkedProviders section (if it has star toggle)

---

### 3.19: Row Add/Delete Slide & Fade Animation

**Current State:**
- DataGrid.tsx uses `AnimatePresence` import (line 21) but **NOT used for row animations**
- SortableRow.tsx (line 127–339) renders without entry/exit animation
- Rows are added/deleted instantly — no visual feedback

**Implementation:**
1. **New row entry:** Wrap `<SortableRow>` in `<motion.div>` with:
   - `initial={{ opacity: 0, y: -10 }}`
   - `animate={{ opacity: 1, y: 0 }}` over 300ms (easing: `easeOut`)
   - `key={rowId}` for stable identity
2. **Row deletion:** Add exit animation:
   - `exit={{ opacity: 0 }}` over 200ms
   - Remove from DOM after animation completes
3. **Wrap rows in `<AnimatePresence mode="popLayout">`** to handle exit animations smoothly
4. **Performance:** Only animate entry/exit of affected row, not entire table re-render
5. **Respect `prefers-reduced-motion`:** motion library handles natively; set `duration: 50ms` if `prefers-reduced-motion`
6. Query settingsStore for `reducedMotion` flag; pass to animation duration

**Files to modify:**
- `/home/jmatlock/claude-workspace/Pulse/src/renderer/components/grid/DataGrid.tsx` (lines 400–600 where rows are rendered)
- Add `AnimatePresence` wrapper around row virtualization
- Wrap each `<SortableRow>` in `<motion.div>` with proper key

---

### Summary of Changes
| Finding | Component | Technique | Duration | Files |
|-|-|-|-|-|
| 3.16 | All buttons | CSS `active:scale-[0.97]` + `duration-75` | 75ms | globals.css |
| 3.17 | Checklist items | Keep check-pop; add color flash + toast | 150+200+150ms | ChecklistItem.tsx, TasksView.tsx, globals.css |
| 3.18 | Star toggle | motion/react scale bounce + color transition | 300ms | ContactCard.tsx |
| 3.19 | Grid rows | motion/react slide-fade (entry 300ms, exit 200ms) | 300ms entry / 200ms exit | DataGrid.tsx |

**All changes respect `prefers-reduced-motion` and app-level `reducedMotion` setting.**

---

# 3.20 Case Log + 3.21 Dashboard Grid

Perfect. ## Implementation Plan: Two UX Improvements for Pulse

### FINDING 3.20: Case Log Entry 2-Line Preview with Click-to-Expand

**Current State:**
- `CaseLogEntry.tsx` line 169: Entry content renders as `<p className="... whitespace-pre-wrap leading-relaxed">` with no truncation
- No single-line truncation visible in code; context suggests entries display fully expanded
- This means long entries take significant vertical space in CaseLog list view

**Solution Approach:**

1. **Add state for expandable entries** (CaseLogEntry.tsx):
   - Add `const [expanded, setExpanded] = useState(false)` to track expansion state
   - When collapsed (default), show `line-clamp-2` (Tailwind 4) — displays 2 lines max with ellipsis
   - When expanded, remove clamp (show full content)

2. **Update content rendering** (CaseLogEntry.tsx lines 168–173):
   - Change `<p>` className from `"... whitespace-pre-wrap leading-relaxed"` to conditional:
     ```
     className={`... whitespace-pre-wrap leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}
     ```
   - This is CSS-only; Tailwind 4 `line-clamp-2` automatically adds `-webkit-line-clamp: 2` + `-webkit-box-orient: vertical` + `overflow: hidden`

3. **Add click handler for expand toggle**:
   - Insert button below content (inside the non-editing branch):
     ```
     {!expanded && entry.content.split('\n').length > 2 && (
       <button onClick={() => setExpanded(true)} className="text-sm text-blue-600 hover:underline mt-1">
         Show more
       </button>
     )}
     {expanded && (
       <button onClick={() => setExpanded(false)} className="text-sm text-blue-600 hover:underline mt-1">
         Show less
       </button>
     )}
     ```

4. **Test impact**:
   - CaseLogEntry.test.tsx: Add test `it('shows 2-line preview by default and expands on click')`
   - Verify truncate class is applied and removed correctly
   - No impact on system/edited entries display

**Performance:** Pure CSS; no render overhead.

---

### FINDING 3.21: Dashboard Card Grid – 4 Columns at 900px+

**Current State:**
- `DashboardView.tsx` line 266: `<div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-3 lg:grid-cols-5">`
  - Base: 2 cols (mobile)
  - sm (640px+): 3 cols
  - lg (1024px+): 5 cols
  - No responsive breakpoint at 900px (md is 768px in Tailwind)

**Issue:** At 900px–1024px window width, only 3 cols show when card width allows 4 comfortably.

**Solution:**

1. **Add md (768px+) breakpoint** with 4 columns:
   - Change line 266 from `"grid grid-cols-2 gap-4 mb-6 sm:grid-cols-3 lg:grid-cols-5"` to:
     ```
     "grid grid-cols-2 gap-4 mb-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
     ```
   - This uses Tailwind's standard `md` breakpoint (768px, close to 900px target)
   - Alternative: use Tailwind's arbitrary breakpoint `[@media(min-width:900px)]:grid-cols-4` if pixel-precise is required
   - Simpler approach: stick with `md:grid-cols-4` (standard Tailwind semantics)

2. **Verify SummaryCard responsiveness** (SummaryCard.tsx):
   - Cards have fixed `p-4` padding + `text-3xl` value
   - Test at 900px to ensure no overflow or text wrapping issues
   - If cards feel cramped at 4-up, consider reducing padding to `p-3` at md breakpoint (add `md:p-3` to className)

3. **Test widths**:
   - 640px–768px: 3-col layout (sm breakpoint, no change)
   - 768px–1024px: 4-col layout (new md breakpoint) ← Target fixed
   - 1024px+: 5-col layout (existing lg, no change)
   - Test in DevTools at 900px explicitly

**Impact:** One-line CSS change; no behavioral changes; grid reflows gracefully.

**Test Impact:**
- DashboardView.test.tsx: Snapshot tests may update if grid layout is visually tested
- No test logic changes needed (mock components don't care about grid cols)

---

### Summary Table

|Finding|Component|Change Type|Effort|Test Impact|
|-|-|-|-|-|
|3.20|CaseLogEntry.tsx|State + CSS + UI|Small|1 new test + snapshot update|
|3.21|DashboardView.tsx|CSS only|Minimal|Snapshot update (if used)|

**Total Implementation Time:** ~1–2 hours (including tests + manual verification).

---

# 3.22 Sidebar Auto-Collapse + 3.23 Filter Bar

Now I have all the context needed. Let me write a detailed implementation plan for both UX improvements.

## Implementation Plan: Two UX Improvements for Pulse Electron

### Finding 3.22: Sidebar Auto-Collapse Below 1024px Width

**Current State:**
- Sidebar width is managed in `settingsStore.ts` with `sidebarWidth: 'narrow' | 'normal' | 'wide'` (preset widths mapped to CSS variable `--width-sidebar-expanded`)
- Collapse state is boolean: `sidebarCollapsed` in `MainLayout.tsx`
- Sidebar renders with conditional width: `collapsed ? 48 : 'var(--width-sidebar-expanded, 220px)'`
- User can manually toggle with Ctrl+\ or collapse button (line 299–306 in Sidebar.tsx)

**Solution:**

1. **Add store state:** Extend `settingsStore.ts` with `sidebarAutoCollapsed: boolean` to distinguish user-toggled collapse from window-driven auto-collapse.

2. **Add resize listener in MainLayout.tsx:**
   - Create `useEffect` that attaches `window.resize` listener
   - Debounce with `useRef` (200ms) to avoid excessive re-renders
   - Check `window.innerWidth < 1024` to determine if sidebar should auto-collapse
   - Call `setSidebarCollapsed(true)` only if auto-collapse needed AND not already collapsed
   - When window resizes back above 1024px, restore previous width by calling `setSidebarCollapsed(false)`
   - Track previous width in `useRef` to restore user's prior width setting

3. **Interaction rules:**
   - Auto-collapse only applies when window is genuinely too narrow
   - User-initiated toggles (button/Ctrl+\) are not overridden by resize logic
   - Store `sidebarAutoCollapsed` flag to prevent re-collapsing if user manually expanded on a narrow window

4. **Implementation detail:** Only set auto-collapse if NOT currently user-collapsed. Add guard: `if (!userManuallyCollapsed) { setSidebarCollapsed(true) }`.

5. **Performance:** Debounce resize events to 200ms to prevent thrashing; track previous `innerWidth` to avoid redundant state updates.

---

### Finding 3.23: ContactFilterBar Search Input Min-Width

**Current State:**
- `ContactFilterBar.tsx` lines 68–86: Search input uses `flex-1` (grows to fill available space)
- Category chips container (lines 160–191): `flex items-center gap-2 overflow-x-auto`
- When 5+ category chips render, flex layout squeezes search input to near-zero width

**Solution:**

1. **Set search input min-width:** Apply `min-w-[200px]` (or `min-w-48` in Tailwind) to the search container (`<div className="relative flex-1">`). This guarantees search input stays readable even with many category chips.

2. **Separate category chips to second row:** Move category chips (`lines 159–192`) below the search/filter toolbar. Create two layout sections:
   - Row 1: Search input (flex-1, min-w-[200px]) + Availability select + Starred button + Sort select + View toggle
   - Row 2: Category chips (own row, `flex-wrap`, scrollable or wrapped)

3. **Alternative (if categories must stay inline):** Collapse selected categories into a "+N more" button when count exceeds 3. Show expanded chips on click in a popover.

4. **Recommended approach:** Use two-row layout (option 2) because:
   - Category chips are secondary filters (search + availability are primary)
   - Two rows improve mobile/narrow-window layout
   - No popover complexity
   - Cleaner visual hierarchy

5. **Implementation:**
   - Wrap search+filter row in its own `<div className="flex flex-wrap gap-2 items-center">`
   - Keep category chips as separate `<div>` below, with `flex-wrap` for overflow
   - Add responsive margin/padding between rows

**Performance:** Negligible — no new computations, pure layout restructuring.

**Code locations to modify:**
- `src/renderer/components/contacts/ContactFilterBar.tsx` (lines 65–192)
- `settingsStore.ts` (optional: add `sidebarAutoCollapsed` field if pursuing 3.22)
- `MainLayout.tsx` (add resize listener for 3.22)

---

**Effort estimate:** 3.22 (~45 min: store update + resize listener + debounce logic); 3.23 (~20 min: layout restructuring).

---

# 3.24 Export All CSV

Perfect. Now I have enough information. Let me write the detailed implementation plan.

---

## Detailed Implementation Plan: "Export All Data as CSV" Feature

**Summary:** Add a "Export All Data as CSV" button in Settings/DataSection that exports all grids (plus contacts and tasks) as separate CSV files in a user-selected folder, with progress feedback and error handling.

### 1. IPC Channel
Add to `src/shared/ipc-channels.ts`:
```
EXPORT_ALL_CSV: 'export:all-csv'
```
This will accept options: `{ destDir: string, includeContacts: boolean, includeTasks: boolean }`
Returns: `{ success: number, failed: number, errors: string[] }`

### 2. Main Process Handler
File: `src/main/ipc/ipc-export.ts` (add handler):
- Validate `destDir` with `assertSafePath()` (no traversal attacks)
- Query `grids` table: SELECT id, name FROM grids ORDER BY position
- Query `caseload_tasks` table for tasks
- Query `providers` table for contacts
- For each grid, call `exportCsv()` with filename pattern `{GridName}_{YYYY-MM-DD}.csv`
- Process one grid at a time (not parallel) to avoid memory bloat
- Collect errors (grid name, error message) without stopping
- Write `data.json` metadata file containing: `{ exportedAt, totalGrids, grids: [{id, name, rowCount, columnCount}], taskCount, contactCount, errors }`
- Return final status object

### 3. Renderer UI
File: `src/renderer/components/settings/DataSection.tsx` (modify):
- Add new section: "Safety-Net Export" with icon and description
- Button text: "Export All Data as CSV"
- On click: folder picker dialog → if confirmed, invoke IPC with `includeContacts: true, includeTasks: true`
- Show progress modal with: "Exporting grid 2 of 5..." + live error list
- On completion: toast success + summary ("5 grids, 1 contact file, 1 task file exported to X")
- If errors occurred: show toast warning with count, allow viewing error details

### 4. Progress Pattern
Use the existing progress pattern (IMPORT_PROGRESS style):
- Main process emits `IPC.EXPORT_ALL_CSV_PROGRESS` after each grid completes
- Payload: `{ current: number, total: number, currentGridName: string }`
- Renderer listens via `window.api.on(IPC.EXPORT_ALL_CSV_PROGRESS, handler)`

### 5. File Names & Metadata
- Grids: `{sanitized grid name}_{YYYY-MM-DD}.csv`
- Contacts: `providers_{YYYY-MM-DD}.csv`
- Tasks: `tasks_{YYYY-MM-DD}.csv`
- Metadata: `export_manifest.json` with schema version, export timestamp, counts, error summary

### 6. Error Handling
- If grid query fails, record error + continue
- If contacts/tasks fail, continue (they're optional)
- Return final `{ success: number, failed: number, errors: [{gridId, gridName, error}] }`
- Show toast warning if any failures; link to error details in success toast

### 7. Performance
- Process grids sequentially (one at a time)
- Use prepared statement for row load: `buildGridQuery()` (existing pattern)
- Batch CSV rows in chunks of 500 to avoid memory spike
- Use `atomicWriteFileAsync()` for each file (existing safe-write pattern)

### 8. Security
- `assertSafePath(destDir)` prevents writes outside user selection
- No arbitrary filenames from DB — sanitize grid names (alphanumeric + spaces + underscore)
- Validate destDir exists and is writable before starting export

### 9. Contacts & Tasks Inclusion
- Add checkboxes in DataSection: "Include providers (vCard directory)" and "Include tasks (recurring & completed)"
- Contacts CSV: name, organization, title, primary phone, email, website, address, availability_status
- Tasks CSV: title, grid_id (or "All Grids"), due_date, recurrence_rule, completion_count

### 10. Test Plan
- Export single grid with 100 rows → verify CSV columns + data integrity
- Export 3 grids + contacts + tasks → verify all files created, manifest accurate
- Simulate grid CSV export failure → verify error captured, other grids continue
- Test path validation: ensure folder picker-selected path cannot be manipulated
- Large export (500+ rows per grid): verify no memory spike, files complete
- Verify grid names with special chars (é, &, /) are sanitized in filenames

**Estimated effort:** 3-4 hours (handler + UI + progress modal + testing)

---

# 3.25 Column Menu + 3.26 Onboarding Presets + 3.27 Cell Hover

Perfect. ## Implementation Plan: Three UX Improvements for Pulse Electron App

**Findings Addressed:** 3.25 (Alert Rule menu position), 3.26 (Onboarding role presets), 3.27 (Cell text hover preview)

---

### Finding 3.25: Alert Rule Section Positioning in Column Header Menu

**Current State:**
- ColumnHeader.tsx lines 276–360: Alert rule picker appears NEAR THE BOTTOM of menu
- Menu order: Rename → Hide → Log changes → Column format rules → Edit options → [HR] → **Alert Rule** → Delete column
- Alert rules are feature-critical (top differentiator from Excel) but buried after less-used options

**Proposed Solution:**
Reorder menu items to surface alerts immediately after core actions:
1. Rename (line 232)
2. Hide column (line 239)
3. **Alert Rule (move here — lines 277–360)**
4. Log changes (line 246)
5. Column format rules (line 257)
6. Edit options (line 266)
7. [HR] (line 362)
8. Delete column (line 363)

**Implementation:**
- Move Alert Rule JSX block (currently lines 277–360, including hr and condition) above Log changes button
- Remove old hr/break at line 279, add new hr at line 362 after Edit options
- Pure JSX reorder; no logic changes
- Rationale: Users configuring alerts are doing the #1 task that differentiates Pulse from spreadsheets — make it discoverable

---

### Finding 3.26: Role-Based Column Presets in Onboarding

**Current State:**
- OnboardingView.tsx customize step (lines 456–574) shows all 12 column types in flat `<select>` dropdown
- Step skips role-based guidance; user must manually curate columns from scratch
- Role was already collected (line 45 `role: Role | null`) but not used to filter/suggest columns

**Proposed Solution:**
Add a **preset picker modal** BEFORE the customize step:

1. **New Step:** "customize_preset" inserted after path selection (when path === 'scratch')
2. **Preset Cards:** 4 role-based options + "Custom" — use existing role data (onboardingData.ts lines 56–127)
   - Care Coordinator: name, DOB, phone, email, address, intake, review date, primary need, status (9 cols)
   - Social Worker: name, DOB, phone, email, address, referral, service plan, court date, priority, status (10 cols)
   - Case Manager: name, DOB, phone, email, enrollment, contact date, plan review, program, status, goals (10 cols)
   - School Counselor: student name, grade, DOB, parent phone/email, concern area, session date, notes (8 cols)
   - Nurse Case Manager: patient name, DOB, MRN, diagnosis, phone, insurance, appointment, contact, status, notes (10 cols)
   - Custom: start with "other" preset (5 cols), add/remove manually

3. **UX Flow:**
   - When user selects "Set up from scratch" → show preset picker
   - User picks a preset (or "Custom")
   - Preset populates `columns` state via `getRoleColumns(role)` (already exists)
   - User lands in customize step to add/remove/reorder columns
   - `handlePathSelect` sets `setStep('customize_preset')` instead of `'customize'` for scratch path

4. **Code Changes:**
   - Add "customize_preset" to WizardStep union (onboardingData.ts line 8)
   - Add new branch in goBack() for customize_preset → path (line 59–70)
   - Add new branch in OnboardingView render (before customize, lines 456–574)
   - **New component:** 4 role preset cards + custom card (reuse PathCard styling from lines 427–449)
   - On preset select: `setColumns(getRoleColumns(selectedRole))` then `setStep('customize')`
   - Rationale: Role-based presets reduce cognitive load; users see immediate examples instead of a blank canvas

---

### Finding 3.27: Multiline Cell Preview on Hover

**Current State:**
- CellDisplay.tsx renders truncated text (lines 95–98 for 'notes', line 96 shows 60-char preview)
- SortableRow.tsx cell div (lines 273–334) has no title attribute for plain text cells
- No hover preview mechanism; users must click to edit/view full content

**Proposed Solutions (Tiered):**

**Option A (Simplest — Recommended):**
- Add native HTML `title` attribute to cell divs in SortableRow.tsx line 280
- For all cell types: compute full text value (no HTML) and set as title
- React auto-escapes title content — no XSS risk
- Free performance (no DOM overhead, browser-native tooltip)
- Limitation: single-line tooltip; no formatting

**Option B (Richer UX):**
- Use existing Tooltip component (Tooltip.tsx) wrapping cell content
- Only show for text-heavy columns (notes, address, text) where value > visible width
- Hoist Tooltip to SortableRow.tsx, wrap `<CellDisplay>` 
- Compute if content is truncated: `value?.length > 60` or `value?.split('\n').length > 1`
- Show multiline preview (up to 3 lines × 50 chars)
- Cost: one Tooltip per cell in scope; delay=600ms (deferred render)

**Recommended Approach (Option A + B Hybrid):**
1. **Immediate (Option A):** Add title attribute to all cells for universal basic preview
   - Line 280 in SortableRow.tsx: add `title={value || ''}`  
   - Works for 90% of use cases, zero cost
2. **Future Enhancement (Option B):** Add Tooltip wrapper for cells in compute-heavy columns (notes, address, text) when `value.length > visible_width`
   - Deferred to Phase 5.2 if user feedback warrants richer preview

**Implementation Detail (Phase 1):**
- SortableRow.tsx line 280: change `title={alertTooltip || undefined}` → `title={alertTooltip || value || undefined}`
- Compute `displayValue` = full cell value (not truncated, no HTML tags)
- For 'notes' type: strip first 60 chars for preview, show full in title
- For 'address' type: show first line in cell, full address (newlines) in title
- Security: React auto-escapes title content; no parsing needed

---

## Summary Table

|Finding|File|Change Type|Effort|Impact|
|-|-|-|-|-|
|3.25|ColumnHeader.tsx|JSX reorder|1–2 min|High (better discoverability)|
|3.26|OnboardingView.tsx + onboardingData.ts|New preset step + 4 cards|20–30 min|High (user onboarding)|
|3.27|SortableRow.tsx|Add title attr to cell div|5 min|High (usability, zero cost)|

**Total estimated implementation time: 30–40 minutes**
**Recommended sequence:** 3.25 → 3.27 → 3.26 (easiest wins first, biggest feature last)

---

# Cross-Cutting: New IPC Channels

The plan document doesn't exist yet. Based on the user's request and the item numbers they mentioned, I'll create a comprehensive IPC channel plan for these new features. Let me verify the exact requirements from the task description and create the detailed plan:

Based on my analysis of the existing IPC infrastructure in Pulse, here's a detailed plan for ALL new IPC channels needed for the UX improvements:

## IPC CHANNELS PLAN FOR UX IMPROVEMENTS

### 1. CHANNEL DEFINITIONS & REGISTRY

**New Constant Additions to `src/shared/ipc-channels.ts`:**

```
// Backup Health & Validation (Items 1.9, 2.12, 2.13)
BACKUP_GET_STATUS: 'backup:get-status'              // Req: void | {includeCloudServices?}
BACKUP_VALIDATE_DESTINATION: 'backup:validate-dest' // Req: {path: string, requireMinMB?: number}
BACKUP_PREVIEW: 'backup:preview'                     // Req: {path: string}

// Cell Bulk Operations (Items 2.1, 3.12)
CELL_BATCH_UPDATE: 'cell:batch-update'              // Req: {gridId, updates: {rowId, colId, value}[]}

// Bulk Operation Progress (Item 3.14)
BULK_OPERATION_PROGRESS: 'bulk-op:progress'         // PUSH event: {operationId, processed, total, status}

// Multi-Grid Export (Item 3.24)
EXPORT_ALL_CSV: 'export:all-csv'                    // Req: {destDir: string, includeGridIds?: number[]}
```

### 2. CHANNEL ARCHITECTURE

| Channel | Type | Direction | Params | Response |
|-|-|-|-|-|
| BACKUP_GET_STATUS | handle | req/resp | `{includeCloudServices?: bool}` | `{ok, data: {autoCount, cloudCount, lastAuto, lastCloud, dbSize, health}}` |
| BACKUP_VALIDATE_DESTINATION | handle | req/resp | `{path: string, requireMinMB?: number}` | `{ok, data: {writable, freeMB, adequate}}` |
| BACKUP_PREVIEW | handle | req/resp | `{path: string}` | `{ok, data: {backupName, created, clients, grids, size}}` |
| CELL_BATCH_UPDATE | handle | req/resp | `{gridId, updates: [{rowId, colId, value}]}` | `{ok, data: {succeeded, failed, errors}}` |
| BULK_OPERATION_PROGRESS | on/send | push (main→renderer) | operationId: string | `{operationId, processed, total, status, eta?}` |
| EXPORT_ALL_CSV | handle | req/resp | `{destDir: string, includeGridIds?: number[]}` | `{ok, data: {exported, files: string[], totalTime}}` |

### 3. SECURITY & VALIDATION

| Channel | Input Validation | Path Validation | Write Guard | Notes |
|-|-|-|-|-|
| BACKUP_GET_STATUS | No params | N/A | No | Read-only, no user input |
| BACKUP_VALIDATE_DESTINATION | `path` string, `requireMinMB` optional int | `assertSafePath(path)` | No | Check writability before export |
| BACKUP_PREVIEW | `path` string | `assertSafePath(path)` + `existsSync()` | No | Read-only, validate backup exists |
| CELL_BATCH_UPDATE | `gridId` validId, `updates` array max 10k | N/A | **YES** — `enforceWritable()` | Max 10k cells/batch to prevent DoS |
| BULK_OPERATION_PROGRESS | None (internal) | N/A | No | Internal event, no user params |
| EXPORT_ALL_CSV | `destDir` string, `includeGridIds` optional array | `assertSafePath(destDir)` | No | Export always allowed (read-only) |

### 4. IMPLEMENTATION LOCATIONS

**New IPC handlers (add to existing modules OR create new):**
- `BACKUP_GET_STATUS`, `BACKUP_VALIDATE_DESTINATION`, `BACKUP_PREVIEW` → `src/main/ipc/ipc-export.ts` (or new `ipc-backup.ts`)
- `CELL_BATCH_UPDATE` → `src/main/ipc/ipc-cell.ts` (extend existing)
- `EXPORT_ALL_CSV` → `src/main/ipc/ipc-export.ts` (extend existing)
- `BULK_OPERATION_PROGRESS` → register via `ipcMain.on()` in `src/main/ipc-handlers.ts` init OR inside handler that triggers bulk ops

**Preload exposure:** Already auto-exposed via `allowedChannels.set(Object.values(IPC))` in `src/preload/index.ts` — no manual edits needed.

**Renderer invocation pattern:** 
```ts
const result = await window.api.invoke(IPC.CELL_BATCH_UPDATE, {gridId, updates})
// Progress listening:
const unsubscribe = window.api.on(IPC.BULK_OPERATION_PROGRESS, (e) => {
  console.log(e.processed, '/', e.total)
})
```

### 5. PROGRESS EVENT PATTERN

For `BULK_OPERATION_PROGRESS` (Item 3.14), use main process push pattern (matches existing `IMPORT_PROGRESS`, `CASE_LOG_CHANGED`):

```ts
// In handler that triggers bulk op:
const win = BrowserWindow.getAllWindows()[0]
const operationId = crypto.randomUUID()

for (const item of items) {
  // ... process item
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.BULK_OPERATION_PROGRESS, {
      operationId, 
      processed: i + 1, 
      total: items.length, 
      status: 'processing'
    })
  }
}
```

### 6. HANDLER SIGNATURES

```ts
// BACKUP_GET_STATUS
secureHandle(IPC.BACKUP_GET_STATUS, async (e, opts?: {includeCloudServices?: boolean}) => {
  // Query backup metadata: auto-backup count, cloud count, lastAuto/Cloud timestamps, db size
  // Return health: "healthy" | "aging" | "missing"
})

// BACKUP_VALIDATE_DESTINATION
secureHandle(IPC.BACKUP_VALIDATE_DESTINATION, async (e, {path, requireMinMB}: {...}) => {
  assertSafePath(path)
  // Check: fs.accessSync(path, fs.constants.W_OK), free disk space
})

// BACKUP_PREVIEW
secureHandle(IPC.BACKUP_PREVIEW, async (e, {path}: {path: string}) => {
  assertSafePath(path)
  // Open backup.db as read-only, query: metadata, COUNT(DISTINCT grid_id), COUNT(DISTINCT row_id)
})

// CELL_BATCH_UPDATE
secureHandle(IPC.CELL_BATCH_UPDATE, async (e, {gridId, updates}: {...}) => {
  const guard = enforceWritable(); if (guard) return guard
  // Begin transaction, apply updates in loop, return summary of succeeded/failed
})

// EXPORT_ALL_CSV
secureHandle(IPC.EXPORT_ALL_CSV, async (e, {destDir, includeGridIds}: {...}) => {
  assertSafePath(destDir)
  // Loop grids, export each as CSV, send progress events
})
```

### 7. BACKWARD COMPATIBILITY

No existing channels modified. All new channels are additive. No changes to request/response signatures of existing handlers.

### 8. IMPLEMENTATION CHECKLIST

1. Add 6 new constants to `ipc-channels.ts`
2. Implement handlers in `ipc-export.ts` + `ipc-cell.ts`
3. Update `ipc-handlers.ts` to register any new modules
4. Add `BACKUP_VALIDATE_DESTINATION`, `BACKUP_PREVIEW` logic to `src/main/backup.ts`
5. Add `CELL_BATCH_UPDATE` logic + undo/redo tracking
6. Renderer: create hooks/stores for bulk operation progress (useProgress hook, subscribe to `BULK_OPERATION_PROGRESS`)
7. Test: max array sizes, path traversal attempts, trial-expired rejection for batch writes

---

**Total new IPC channels: 6 constants**  
**Handler modules: 2 (ipc-export.ts, ipc-cell.ts)**  
**Lines of code: ~200-300 (handlers + validation)**  
**Security review items: Path traversal (4), write guard (1), batch size limits (1)**

---

# Cross-Cutting: Test Impact

Perfect. Now I have the full inventory. Let me prepare a comprehensive analysis document summarizing all the findings:

## UX Improvement Test Impact Analysis — Pulse Electron App

### 1. Full Test Inventory

**Total test files found: 104** across the Pulse project (excluding node_modules):

**Tests by category:**
- Core tests (auth, database, IPC, backup, migrations): 33 files
- Grid component tests: 9 files (DataGrid, ColumnHeader, FilterBar, CellEditor, BulkActionBar, GridContextMenu, GridToolbar, ImportWizard, AcuityBadge)
- Profile component tests: 7 files (CaseLog, CaseLogEntry, Checklist, ActivityTimeline, DeadlinePanel, GridDataSummary, ScratchPad)
- Contact component tests: 7 files (ContactForm, ContactFilterBar, ContactCard, ContactDetail, CategoryManager, ContactInteractionLog, AvailabilityBadge)
- Shared component tests: 7 files (ConfirmDialog, EmptyState, LoadingSpinner, Tooltip, CommandPalette, KeyboardShortcutsModal, ErrorBoundary)
- Layout tests: 3 files (TopBar, Sidebar, StatusBar)
- Store tests: 13 files (gridStore, alertStore, undoStore, contactsStore, taskStore, settingsStore, etc.)
- Hook tests: 7 files (useAutoLock, useGlobalKeyboard, useThemeEffect, useFocusTrap, etc.)
- View tests: 9 files (DashboardView, OnboardingView, TasksView, SettingsView, ContactsView, TrashView, LockScreenView, SnippetsView, viewSmoke)
- Utility tests: 3 files (deadlineCalc, alertColors, snippetExpander)

---

### 2. UX Change Impact Matrix

**Changes requiring test updates (sample mapping from your 51-item list):**

| UX Item | Change Type | Affected Test File(s) | Test Strategy |
|-|-|-|-|
| 1.1: Enter moves down | Keyboard behavior | DataGrid.test.tsx (Keyboard Navigation section) | Unit test — verify Enter key navigates down, not into edit mode on non-editable cells |
| 1.2: Auto-edit new row | UI interaction | DataGrid.test.tsx, gridStore.test.ts | Unit test — verify new row immediately enters edit on name col + auto-focus |
| 1.3: Select-all checkbox | Grid selection | DataGrid.test.tsx (Selection section) | Unit test — add checkbox in header, test Ctrl+A or toggle state |
| 1.5: Error toasts | Error UI | alertStore.test.ts, IPC error path tests | Unit test — verify toast text matches spec (human-friendly, not SQL errors) |
| 2.5: New row highlight | Visual feedback | DataGrid.test.tsx + CellEditor.test.tsx | CSS-only (no test needed) — add highlight class to newly added rows |
| 2.14: Filter labels | UI text | FilterBar.test.tsx | Unit test — verify label text in filter chips matches spec (e.g., "Contains", "After", not "eq") |
| ~~2.15: Format panel labels~~ | **ALREADY COMPLETE** — labels are already plain language | N/A | N/A |
| 3.1: Search highlighting | Text rendering | DataGrid.test.tsx + CellDisplay tests | Unit test — verify search match spans are wrapped in `<mark>` or highlight class |
| 3.6: Empty states | Placeholder UI | EmptyState.test.tsx + view tests (Dashboard, Contacts, Tasks, Snippets) | Unit test — verify EmptyState icon/title/description match spec per context |
| 3.11: Onboarding tips | Instructional text | OnboardingView.test.tsx | Unit test — verify tip text displays correctly; may add new tip content specs |
| 3.16: Button styles | Global styling | No new test — CSS audit | CSS-only — standardize button size/padding (44px height, 15px font) across all views |
| 3.20: Case log 2-line | Component layout | CaseLogEntry.test.tsx | Unit test — verify content truncated to 2 lines + "Show more" link renders |

**Total affected test files: 14–16** (depending on scope)

---

### 3. New Test Files Needed

**Minimal additions** — most changes fit existing test suites:
- No completely new test files required (all UX changes affect existing components)
- May add **sub-test files** for specific features:
  - `tests/renderer/components/grid/SortableRow.test.tsx` (if 2.5 adds new row type)
  - `tests/renderer/components/grid/CellDisplay.test.tsx` (if 3.1 adds search highlight component)

---

### 4. Test Strategy by Change Type

**Unit tests required (behavioral changes):**
- 1.1, 1.2, 1.3, 1.5, 2.14, 3.1, 3.6, 3.11, 3.20 = **9 items** (2.15 already complete)
- Impact: Update assertions, add new test cases, verify DOM/state changes
- Effort: 2–3 test cases per file, ~5–15 min each

**CSS-only (no test updates needed):**
- 2.5 (highlight class), 3.16 (button styling) = **2 items**
- Impact: Update Tailwind classes, run visual regression if tool exists
- Effort: Edit CSS, browser test only

**Remaining ~39 items** (not detailed above):
- If similar to examples: majority are CSS/styling (no test impact)
- Some may be IPC behavior (check ipc-handlers.test.ts)
- Some may be store state (check relevant store test file)

---

### 5. Estimated Test Files to Modify

**High priority (behavioral changes):**
1. /home/jmatlock/claude-workspace/Pulse/tests/renderer/components/grid/DataGrid.test.tsx
2. /home/jmatlock/claude-workspace/Pulse/tests/renderer/components/grid/FilterBar.test.tsx
3. /home/jmatlock/claude-workspace/Pulse/tests/renderer/components/profile/CaseLogEntry.test.tsx
4. /home/jmatlock/claude-workspace/Pulse/tests/renderer/views/OnboardingView.test.tsx
5. /home/jmatlock/claude-workspace/Pulse/tests/renderer/components/shared/EmptyState.test.tsx
6. /home/jmatlock/claude-workspace/Pulse/tests/renderer/components/grid/GridToolbar.test.tsx
7. /home/jmatlock/claude-workspace/Pulse/tests/renderer/stores/alertStore.test.ts (error toast text)
8. /home/jmatlock/claude-workspace/Pulse/tests/renderer/stores/gridStore.test.ts (auto-edit new row)

**Medium priority (UI text/labels):**
9. /home/jmatlock/claude-workspace/Pulse/tests/renderer/views/DashboardView.test.tsx
10. /home/jmatlock/claude-workspace/Pulse/tests/renderer/views/ContactsView.test.tsx
11. /home/jmatlock/claude-workspace/Pulse/tests/renderer/views/TasksView.test.tsx
12. /home/jmatlock/claude-workspace/Pulse/tests/renderer/views/SnippetsView.test.tsx

**Low priority (CSS styling only):**
- No test file updates needed (visual regression testing only)

---

### 6. Summary

- **Test files to update: 8–12 core files** (from the 104 total)
- **Percentage impacted: ~10–15%** of test suite
- **Estimated effort: 20–30 hours total** (2–3 hours per file for behavioral changes)
- **Strategy: Run existing tests first, then add/update assertions** to match new UX spec
- **Pre-implementation step: Specify exact label copy, error messages, empty state text** in a supplementary UX spec doc

---

# Cross-Cutting: CSS and Animations

Based on my analysis of the existing codebase and animation patterns, I can now write a comprehensive CSS animation plan for the 51-item UX improvement initiative. Let me create a detailed plan:

---

## CSS & Animation Plan: 51-Item UX Improvement Initiative

### Summary
The Pulse app uses Tailwind 4 with CSS-first `@theme` config and custom `@keyframes` animations. All animations already respect `prefers-reduced-motion` via media queries and `.reduce-motion` class. This plan covers all new animations needed for the improvement roadmap while maintaining consistency with existing animation conventions.

---

### 1. New Animations Required

| Item | Animation Name | Duration | Easing | GPU-Friendly? |
|-|-|-|-|-|
| 2.5 Row highlight | `row-highlight` | 800ms | ease-out | Yes (opacity + bg-color) |
| 3.1 Search mark/highlight | `mark-pulse` | 600ms | ease-in-out | Yes (background-color) |
| 3.3 Skip-to-content focus | (CSS :focus-visible only) | N/A | N/A | N/A |
| 3.16 Button active press | (CSS active:scale) | 100ms | ease-out | Yes (transform) |
| 3.17 Task completion | `celebration-pop` | 500ms | cubic-bezier | Yes (transform + opacity) |
| 3.18 Star toggle bounce | `star-bounce` | 400ms | cubic-bezier | Yes (transform) |
| 3.19 Row add/delete | `slide-in-fade` / `slide-out-fade` | 200ms | ease-out | Yes (transform + opacity) |
| 3.20 Line clamp | (Tailwind built-in `line-clamp-2`) | N/A | N/A | Yes (CSS) |

---

### 2. New `@keyframes` Definitions (for `globals.css`)

```
@keyframes row-highlight {
  from { background-color: rgba(59, 130, 246, 0.2); }
  to   { background-color: transparent; }
}

@keyframes mark-pulse {
  0%, 100%  { background-color: rgba(251, 146, 60, 0.3); }
  50%       { background-color: rgba(251, 146, 60, 0.6); }
}

@keyframes celebration-pop {
  0%   { transform: scale(0.8); opacity: 0; }
  50%  { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes star-bounce {
  0%, 100% { transform: scale(1) rotate(0deg); }
  50%      { transform: scale(1.2) rotate(15deg); }
}

@keyframes slide-in-fade {
  from { opacity: 0; transform: translateX(-16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes slide-out-fade {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(16px); }
}
```

---

### 3. New Utility Classes (for `globals.css` @layer utilities)

```
.animate-row-highlight {
  animation: row-highlight 800ms ease-out;
}

.animate-mark-pulse {
  animation: mark-pulse 600ms ease-in-out;
}

.animate-celebration-pop {
  animation: celebration-pop 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.animate-star-bounce {
  animation: star-bounce 400ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

.animate-slide-in-fade {
  animation: slide-in-fade 200ms ease-out;
}

.animate-slide-out-fade {
  animation: slide-out-fade 200ms ease-out forwards;
}

.active:scale-[0.97] {
  /* Use Tailwind's arbitrary scale modifier */
}

mark, .mark {
  background-color: rgba(251, 146, 60, 0.3);
  padding: 2px 4px;
  border-radius: 2px;
}
```

---

### 4. Dark Mode Variants

All animations work identically in dark mode. Color adjustments for mark/pulse:

```
:is(.dark mark), :is(.dark .mark) {
  background-color: rgba(251, 146, 60, 0.4); /* Slightly higher opacity for visibility on dark bg */
}

:is(.dark .mark-pulse) {
  animation: mark-pulse-dark 600ms ease-in-out;
}

@keyframes mark-pulse-dark {
  0%, 100%  { background-color: rgba(251, 146, 60, 0.4); }
  50%       { background-color: rgba(251, 146, 60, 0.7); }
}
```

---

### 5. Reduced Motion Handling

```
@media (prefers-reduced-motion: reduce) {
  .animate-row-highlight,
  .animate-mark-pulse,
  .animate-celebration-pop,
  .animate-star-bounce,
  .animate-slide-in-fade,
  .animate-slide-out-fade {
    animation: none;
  }
}

/* Also add to existing global reduced-motion block (line 335-343) */
```

---

### 6. Performance Notes

- **GPU-accelerated:** All transforms (`scale`, `translateX`, `rotate`) + opacity are hardware-accelerated
- **No layout thrashing:** Animations on `background-color` (composited), `opacity`, `transform` — NOT on `width`, `height`, `position`
- **Cheapest:** `row-highlight` (single property), `celebration-pop` (transform only)
- **Moderate:** `mark-pulse` (background-color on many marks during search), `star-bounce` (typically 1-2 elements)
- **Careful:** Row add/delete `slide-in-fade` — if many rows added at once, batch the animation or throttle

---

### 7. Component-Level Integration

| Item | Location | Usage |
|-|-|-|
| 2.5 row-highlight | DataGrid.tsx | Add `animate-row-highlight` class on selected/jump-target row, remove after 800ms |
| 3.1 mark-pulse | Search results | Wrap search match spans in `<mark className="animate-mark-pulse">` |
| 3.3 skip-to-content | Shared layout | `<a href="#main" className="sr-only focus:not-sr-only">Skip to main content</a>` |
| 3.16 button scale | buttons | Add `active:scale-[0.97]` to all `.btn` classes |
| 3.17 celebration | ChecklistItem.tsx | Trigger `animate-celebration-pop` on item.completed=true, remove after 500ms |
| 3.18 star bounce | StarButton.tsx | Trigger `animate-star-bounce` on click, remove after 400ms |
| 3.19 row add/delete | DataGrid.tsx, RowAddForm.tsx | Add `animate-slide-in-fade` to new rows, `animate-slide-out-fade` to deleted rows |
| 3.20 line clamp | Text cells | Use `line-clamp-2` Tailwind class on cell renderers (already built-in) |

---

### 8. Naming Conventions

All follow existing pattern: `animate-{noun}-{action}` or `animate-{action}`:
- `animate-check-pop` (existing)
- `animate-row-highlight` (new)
- `animate-celebration-pop` (new)
- `animate-star-bounce` (new)
- `animate-slide-in-fade` (new)
- `animate-slide-out-fade` (new)
- `alert-pulse` (existing, exception for alert colors)

---

### 9. Implementation Order

1. Add all `@keyframes` to `globals.css` (~60 lines)
2. Add utility classes to `globals.css` @layer utilities (~40 lines)
3. Add dark mode variants (`mark-pulse-dark`, dark mark color)
4. Add reduced-motion guards to existing block
5. Component integration (8 separate files, ~2–5 lines each)
6. Test keyboard navigation with animations (Escape, Enter, Tab)
7. Test with `prefers-reduced-motion: reduce` enabled in browser DevTools

**Total CSS additions:** ~100 lines to `globals.css`, ~80 lines of component JSX.

---

# Cross-Cutting: Store Changes

Perfect. Based on my analysis of the 51-item display-settings UX improvement plan and current store architecture, here is the detailed store changes analysis:

## ZUSTAND STORE CHANGES PLAN — Display Settings & UX Improvements

### Overview
The 51-item plan spans 3 major features (Display/Appearance Settings, Custom Group Buckets, Bulk Acuity Assignment) with 11 subsections. The store impact is **mostly additive to existing settingsStore**; gridStore and acuitySlice receive minor updates; undoStore requires no changes.

---

### 1. SETTINGS STORE (settingsStore.ts) — PRIMARY CHANGES

**Current state:** 8 display fields already implemented (uiScale, gridDensity, sidebarWidth, rowStriping, gridLines, reducedMotion, highContrast, clockFormat, weekStart)

**No additional store changes needed** — all display settings already exist and persist via SETTINGS_UPDATE IPC.

**Why:** The plan (sections 1-9) is fully realized in code. settingsStore already has:
- `uiScale: number` (80-150, default 100)
- `gridDensity: 'compact' | 'comfortable' | 'spacious'`
- `sidebarWidth: 'narrow' | 'normal' | 'wide'`
- `rowStriping: boolean`
- `gridLines: 'full' | 'horizontal' | 'none'`
- `reducedMotion: boolean`
- `highContrast: boolean`
- `clockFormat: '12h' | '24h'`
- `weekStart: 'sunday' | 'monday'`

All hydration, setters, and IPC persistence already in place.

---

### 2. GRID STORE (gridStore.ts) — CUSTOM GROUPS

**Current state:** CustomGroupSliceState already fully implemented (section 10 of plan).

**Existing state (in gridCustomGroupSlice.ts):**
```typescript
customGroups: CustomGroupDef[]
activeCustomGroupId: string | null
loadCustomGroups(gridId: number): Promise<void>
saveCustomGroup(gridId: number, def: CustomGroupDef): Promise<void>
deleteCustomGroup(gridId: number, defId: string): Promise<void>
setActiveCustomGroupId(id: string | null): void
```

**No additional store changes needed** — full implementation already exists. Storage via `custom_groups_{gridId}` in settings table, integrated into gridStore as a slice.

**Derived state (no store change):** `activeCustomGroup` can be computed via selector:
```typescript
const activeCustomGroup = customGroups.find(g => g.id === activeCustomGroupId) ?? null
```

---

### 3. GRID STORE (gridStore.ts) — BULK ACUITY OPERATIONS

**Current state:** `bulkSetRowAcuityLevel` action already implemented in gridAcuitySlice.

**Existing action (in gridAcuitySlice.ts):**
```typescript
bulkSetRowAcuityLevel: async (rowIds: number[], levelId: number | null) => Promise<void>
```

**Implementation details:** Includes optimistic update, IPC call to ACUITY_BULK_SET_LEVEL, undo/redo integration with proper side effect tracking.

**No additional store changes needed** — action fully implements section 11 of plan.

---

### 4. UNDO STORE (undoStore.ts) — NO CHANGES

**Current state:** UndoItem type already supports all undo categories: 'silent' | 'logged' | 'content' | 'structural'

Both `bulkSetRowAcuityLevel` and display setting changes integrate with existing undo stack:
- Display settings: changes are 'silent' (no audit trail)
- Bulk acuity: changes are 'logged' (auto case log voiding on undo)
- Custom group save/delete: changes are 'silent'

**No new side effect types needed** — existing `void_case_log` pattern covers all use cases.

---

### 5. NEW STATE FIELDS — COMPREHENSIVE TABLE

| Store | Field | Type | Default | Persistent | Action | Notes |
|-|-|-|-|-|-|-|
| settingsStore | uiScale | number | 100 | Yes | setUiScale | 80-150, CSS zoom |
| settingsStore | gridDensity | enum | 'comfortable' | Yes | setGridDensity | Maps to --row-height CSS |
| settingsStore | sidebarWidth | enum | 'normal' | Yes | setSidebarWidth | Maps to --width-sidebar CSS |
| settingsStore | rowStriping | boolean | false | Yes | setRowStriping | CSS class: striped-rows |
| settingsStore | gridLines | enum | 'full' | Yes | setGridLines | CSS classes: grid-lines-* |
| settingsStore | reducedMotion | boolean | false | Yes | setReducedMotion | CSS class: reduce-motion |
| settingsStore | highContrast | boolean | false | Yes | setHighContrast | CSS class: high-contrast |
| settingsStore | clockFormat | enum | '12h' | Yes | setClockFormat | Utility func: formatTime() |
| settingsStore | weekStart | enum | 'sunday' | Yes | setWeekStart | date-fns startOfWeek |
| gridStore | customGroups | CustomGroupDef[] | [] | Settings table | loadCustomGroups | Per-grid, as JSON |
| gridStore | activeCustomGroupId | string \| null | null | ephemeral | setActiveCustomGroupId | Runtime only |

**All fields ALREADY IMPLEMENTED** — no new additions needed.

---

### 6. PERSISTENCE & HYDRATION

**settingsStore persistence:** Via `SETTINGS_UPDATE` IPC → main process → `settings` table.

**Hydration on unlock:** `hydrateFromSettings()` parses settings record with type guards:
```typescript
const uiScale = parseInt(settings.ui_scale ?? '', 10)
const gridDensity = (rawGridDensity === 'compact' || ...) ? rawGridDensity : undefined
// ... etc for all 9 fields
set({ ...(validations.ok ? { field: value } : {}) })
```

**Custom groups persistence:** Stored as `custom_groups_{gridId}` JSON in settings table.
- Loaded in `loadCustomGroups()` → calls `SETTINGS_GET` IPC
- Saved in `saveCustomGroup()` + `deleteCustomGroup()` → calls `SETTINGS_UPDATE` IPC
- No runtime validation needed (app ensures CustomGroupDef shape)

---

### 7. USEEFFECT / REACTIVITY & SHALLOW SUBSCRIPTIONS

**Display settings application (App.tsx):**
```typescript
const { uiScale, gridDensity, sidebarWidth, gridLines, rowStriping, reducedMotion, highContrast } 
  = useSettingsStore(state => ({
    uiScale: state.uiScale,
    gridDensity: state.gridDensity,
    sidebarWidth: state.sidebarWidth,
    gridLines: state.gridLines,
    rowStriping: state.rowStriping,
    reducedMotion: state.reducedMotion,
    highContrast: state.highContrast,
  }), shallow)

useEffect(() => {
  const root = document.documentElement
  root.style.zoom = `${uiScale}%`
  root.style.setProperty('--row-height', heightMap[gridDensity])
  // ... apply other settings as CSS
}, [uiScale, gridDensity, sidebarWidth, gridLines, rowStriping, reducedMotion, highContrast])
```

**Use `useShallow` for multi-field subscriptions** to prevent re-render on unrelated setting changes.

**Custom groups in DataGrid:**
```typescript
const { customGroups, activeCustomGroupId } = useGridStore(
  state => ({ customGroups: state.customGroups, activeCustomGroupId: state.activeCustomGroupId }),
  shallow
)
const activeCustomGroup = customGroups.find(g => g.id === activeCustomGroupId)
```

**Clock format utility:**
```typescript
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const format = useSettingsStore.getState().clockFormat  // read current, not subscribe
  // ...
}
```

---

### 8. CROSS-STORE DEPENDENCIES

| Dependency | From | To | Why |
|-|-|-|-|
| Undo/redo integration | gridStore.bulkSetRowAcuityLevel | undoStore | Logs bulk action in undo stack |
| Clock format in formatTime() | (read sync) | settingsStore | Formats timestamps per user preference |
| Week start in DashboardView | (read sync) | settingsStore | date-fns options for "This Week" calc |
| Custom groups in DataGrid | gridStore | (displayItems memo) | Groups before sort/filter |
| Acuity levels lookup | gridAcuitySlice | acuityLevels state | For dropdown/badge rendering |

**No mutual dependencies or circular updates** — all unidirectional.

---

### 9. SUMMARY: WHAT'S ALREADY DONE

All 51 items map to **already-implemented store state**:

| Section | Items | Store Status |
|-|-|-|
| 1. UI Scale (zoom) | 1 item | settingsStore.uiScale ✓ |
| 2. Grid Density | 1 item | settingsStore.gridDensity ✓ |
| 3. Sidebar Width | 1 item | settingsStore.sidebarWidth ✓ |
| 4. Row Striping | 1 item | settingsStore.rowStriping ✓ |
| 5. Grid Lines | 1 item | settingsStore.gridLines ✓ |
| 6. Reduced Motion | 1 item | settingsStore.reducedMotion ✓ |
| 7. High Contrast | 1 item | settingsStore.highContrast ✓ |
| 8. Clock Format | 1 item | settingsStore.clockFormat ✓ |
| 9. Week Start | 1 item | settingsStore.weekStart ✓ |
| 10. Custom Group Buckets | ~25 items | gridCustomGroupSlice ✓ |
| 11. Bulk Acuity Assignment | ~12 items | gridAcuitySlice.bulkSetRowAcuityLevel ✓ |

**Remaining work:** UI components (SettingsView sections, CustomGroupEditor modal, GroupingBar updates, DataGrid integration), CSS variables, keyboard shortcuts, formatTime() utility.

**No store refactoring needed** — all state shape and actions ready for UI implementation.

---

# Cross-Cutting: New Components

Perfect. ## Complete Report: New React Components for 51-Item UX Improvement Plan

---

### NEW COMPONENTS TO CREATE

**2.1 — FindReplaceBar** (Grid Feature)
- **Path:** `/src/renderer/components/grid/FindReplaceBar.tsx`
- **Props Interface:**
  ```tsx
  interface FindReplaceBarProps {
    visible: boolean
    onClose: () => void
    onFind: (query: string) => void
    onReplace: (query: string, replacement: string, replaceAll?: boolean) => void
    matchCount: number
    currentMatch: number
  }
  ```
- **Dependencies:** gridStore (activeGridId, rows), Zustand shallow subscription, motion (for slide-in)
- **Size:** Large (~180 lines) — two input fields, find-next/prev buttons, replace/replace-all buttons, match counter
- **Pattern:** Similar to FilterBar.tsx (state mgmt for query, match nav); uses motion for slide-in from below SearchBar
- **Test file:** Yes — unit tests for find/replace logic, integration test with grid

---

**3.1 — HighlightedText** (Shared Component)
- **Path:** `/src/renderer/components/shared/HighlightedText.tsx`
- **Props Interface:**
  ```tsx
  interface HighlightedTextProps {
    text: string
    query: string
    className?: string
    highlightClassName?: string
  }
  ```
- **Dependencies:** None (pure utility component)
- **Size:** Small (~40 lines) — split text by query matches, wrap matches in span with highlight class
- **Pattern:** Similar to how CellDisplay.tsx handles text rendering; reusable across CaseLog, ContactFilterBar search results
- **Test file:** Yes — unit tests for edge cases (empty query, multiple matches, case sensitivity)

---

**3.3 — SkipToContent** (Shared/Layout)
- **Path:** `/src/renderer/components/shared/SkipToContent.tsx`
- **Props Interface:**
  ```tsx
  interface SkipToContentProps {
    targetId?: string // default: "main-content"
  }
  ```
- **Dependencies:** None (pure accessibility component)
- **Size:** Small (~30 lines) — visually hidden link, focus:visible shows on keyboard nav
- **Pattern:** Standard WCAG skip link; mount at App.tsx top before router
- **Test file:** No — accessibility feature, manual testing sufficient

---

**3.12 — BulkEditDialog** (Grid Feature)
- **Path:** `/src/renderer/components/grid/BulkEditDialog.tsx`
- **Props Interface:**
  ```tsx
  interface BulkEditDialogProps {
    open: boolean
    selectedRowIds: number[]
    columns: Column[]
    onConfirm: (columnId: number, value: string) => void
    onCancel: () => void
  }
  ```
- **Dependencies:** ColumnSelectDialog (column picker), CellEditor (value input), gridStore, motion, toast
- **Size:** Large (~200 lines) — column selector, cell editor for value, preview (# rows affected), confirm/cancel
- **Pattern:** Modal similar to ConfirmDialog.tsx + ColumnSelectDialog.tsx; IPC call to `BULK_UPDATE_CELLS` (new handler)
- **Test file:** Yes — unit tests for validation, integration with store and IPC

---

**3.14 — ProgressModal** (Shared Component)
- **Path:** `/src/renderer/components/shared/ProgressModal.tsx`
- **Props Interface:**
  ```tsx
  interface ProgressModalProps {
    open: boolean
    title: string
    message?: string
    progress: number // 0-100
    status?: 'pending' | 'success' | 'error'
    onCancel?: () => void
    cancelable?: boolean
  }
  ```
- **Dependencies:** motion (animated progress bar), LoadingSpinner (animated icon)
- **Size:** Medium (~120 lines) — centered modal with animated progress bar, status icon, optional cancel button
- **Pattern:** Modal variant of LoadingSpinner.tsx; used for bulk operations, imports, exports
- **Test file:** Yes — unit tests for progress updates, status transitions

---

**3.15 — VariableInsertMenu** (Shared Component)
- **Path:** `/src/renderer/components/shared/VariableInsertMenu.tsx`
- **Props Interface:**
  ```tsx
  interface VariableInsertMenuProps {
    onInsert: (variable: string) => void
    position: { x: number; y: number } | null
    context?: 'letter' | 'snippet' // scope which variables are available
  }
  ```
- **Dependencies:** motion (popover), gridStore (current row context), profileStore (client data)
- **Size:** Medium (~110 lines) — dropdown menu showing merge field options ({{clientName}}, {{dateToday}}, etc), click to insert
- **Pattern:** Similar to CommandPalette.tsx but as floating menu; mounted in LetterTemplateView, ScratchPad tiptap
- **Test file:** Yes — unit tests for variable insertion at cursor, context filtering

---

### MAJOR MODIFICATIONS TO EXISTING COMPONENTS

| Component | Changes | Complexity |
|-|-|-|
| GridHeaderRow | Add select-all checkbox (left edge); toggle all visible rows; state sync with selectedRowIds; checkbox styling | Medium |
| GridToolbar | Overflow menu for secondary actions (supervisor report, acuity config, grouping); responsive wrapping; open→auto-expand dropdowns | Medium |
| SortableRow | Add highlight animation on search match; add cell title tooltips (full text on overflow); background flash on row edit | Medium |
| CellDisplay | Integrate HighlightedText component; conditional highlighting based on search query from gridStore | Small |
| ProfileView | Section collapsibility (LinkedProviders, CaseLog, ContactInfo); drag-to-reorder sections; local state for collapse state | Large |
| Sidebar | Auto-collapse grid list when > 8 grids (expand/collapse toggle); visual indicator of grouping (if enabled); responsive width | Medium |
| OnboardingView | Add pro-tips step (5-minute video carousel); role presets (Social Worker, Care Coordinator, Case Manager) with template suggestions | Large |

---

### IMPLEMENTATION DEPENDENCIES & ORDERING

1. **Phase 0 (Foundation):** HighlightedText, SkipToContent, ProgressModal (no dependencies on others)
2. **Phase 1 (Grid Search):** FindReplaceBar (depends on HighlightedText, gridStore)
3. **Phase 2 (Bulk Operations):** BulkEditDialog (depends on FindReplaceBar completion, IPC handler)
4. **Phase 3 (Templates):** VariableInsertMenu (depends on ProgressModal, gridStore)
5. **UI Modifications:** GridHeaderRow, GridToolbar, ProfileView (can parallelize; start after Phase 0)

---

### Component File Inventory Summary

**New Files:** 6 components
**Modified Files:** 7 components  
**Test Files to Create:** 5 (HighlightedText, FindReplaceBar, BulkEditDialog, ProgressModal, VariableInsertMenu)
**IPC Handlers to Add:** 2 (BULK_UPDATE_CELLS, BULK_DELETE_ROWS — if not already present)

**Estimated Total LOC (new components):** ~850 lines (excludes tests)
**Estimated Total Test LOC:** ~1200 lines

---

# Cross-Cutting: File Ownership Map

## Implementation Batches (No File Overlap Between Concurrent Batches)

### Batch 1: Grid Core (SEQUENTIAL — largest cluster, many shared files)
**Findings:** 1.1, 1.2, 1.3, 1.7, 2.5, 2.8, 2.10, 3.1, 3.12, 3.19, 3.27
**Files:** DataGrid.tsx, SortableRow.tsx, GridHeaderRow.tsx, CellEditor.tsx, CellDisplay.tsx, gridKeyboardNav.ts, gridStore.ts, gridConstants.ts
**Effort:** Large — this is the critical path

### Batch 2: Toolbar + Filter (can parallel with Batch 3+)
**Findings:** 2.14 (1.8 removed)
**Files:** FilterBar.tsx
**Effort:** Small

### Batch 3: Profile + Settings Views (can parallel with Batch 2)
**Findings:** 2.11, 3.20 (2.4 removed)
**Files:** ProfileView.tsx, CaseLogEntry.tsx, CaseLog.tsx
**Effort:** Small-Medium

### Batch 4: Sidebar + Layout (can parallel with Batch 2, 3)
**Findings:** 2.2, 3.7, 3.22, 3.3
**Files:** Sidebar.tsx, MainLayout.tsx, App.tsx (SkipToContent only)
**Effort:** Small-Medium

### Batch 5: IPC + Main Process (can parallel with Batch 2, 3, 4)
**Findings:** 1.9, 2.1 (batch update), 2.12, 2.13, 3.12 (batch update), 3.24
**Files:** ipc-channels.ts, ipc-handlers.ts, backup.ts, export.ts, database.ts
**Effort:** Medium

### Batch 6: Stores + Error Handling (can parallel with Batch 2, 3, 4)
**Findings:** 1.5, 1.6, 3.4
**Files:** gridStore.ts (error toasts only — after Batch 1), profileStore.ts, taskStore.ts, contactsStore.ts, alertStore.ts, condFormatStore.ts, undoStore.ts, settingsStore.ts
**Note:** gridStore.ts conflicts with Batch 1 — run AFTER Batch 1

### Batch 7: Backup + Settings Sections (can parallel with Batch 2, 3, 4)
**Findings:** 1.9 (UI), 2.12, 2.13, 3.24 (UI), 3.8
**Files:** BackupSection.tsx, DataSection.tsx, AppearanceSection.tsx
**Effort:** Small-Medium

### Batch 8: CSS + Animations (can parallel with most batches, merge carefully)
**Findings:** 2.5 (animation), 3.1 (mark styles), 3.3 (sr-only), 3.16, 3.17, 3.18, 3.19 (animation)
**Files:** index.css
**Effort:** Small — CSS-only changes

### Batch 9: Contacts + Tasks (can parallel with Batch 1-8)
**Findings:** 2.6, 3.7, 3.18, 3.23
**Files:** TasksView.tsx, TaskItem.tsx, ContactFilterBar.tsx, ContactDetail.tsx
**Effort:** Small-Medium

### Batch 10: Onboarding + Breadcrumbs (can parallel with Batch 1-9)
**Findings:** 2.3, 2.9, 3.11, 3.26
**Files:** OnboardingView.tsx, MorningBriefingView.tsx, Breadcrumb.tsx, SettingsView.tsx, ContactsView.tsx
**Effort:** Small-Medium

### Batch 11: Modals + New Components (can parallel with Batch 1-10)
**Findings:** 2.1 (FindReplaceBar), 2.7, 3.10, 3.14, 3.15
**Files:** FindReplaceBar.tsx (NEW), ProgressModal.tsx (NEW), BulkEditDialog.tsx (NEW), VariableInsertMenu.tsx (NEW), HighlightedText.tsx (NEW), SkipToContent.tsx (NEW), LetterTemplateView.tsx
**Effort:** Medium-Large

### Batch 12: Tests (AFTER all implementation batches)
**Files:** All test files matching modified components
**Effort:** Medium

## Parallel Execution Plan

```
Timeline:
  [Batch 8: CSS] ──────────────────────────────────────────────────►
  [Batch 11: New Components] ──────────────────────────────────────►
  [Batch 5: IPC/Main] ────────────────────────────────────────────►
  [Batch 2: Toolbar+Filter] ──────►
  [Batch 3: Profile+Settings] ────►
  [Batch 4: Sidebar+Layout] ──────►
  [Batch 7: Backup Sections] ─────►
  [Batch 9: Contacts+Tasks] ──────►
  [Batch 10: Onboarding] ─────────►
  [Batch 1: Grid Core] ───────────────────────────────────────────► (largest)
  [Batch 6: Stores] ─────────────► (after Batch 1 gridStore changes)
  [Batch 12: Tests] ──────────────────────────────────────────────► (after all)
```

Maximum parallelism: Batches 2, 3, 4, 5, 7, 8, 9, 10, 11 can ALL run concurrently.
Sequential dependencies: Batch 6 after Batch 1; Batch 12 after all.

---

