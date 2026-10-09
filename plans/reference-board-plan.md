# Reference Board — Implementation Plan

## File Storage Architecture

**Storage location:** `{getPortableDataDir()}/pulse-files/references/` (subdirectory of shared `pulse-files/` root from `file-storage.ts`)

**File naming:** `{uuid}{originalExtension}` (e.g., `a1b2c3d4-5678-90ab-cdef-1234567890ab.pdf`). UUID avoids collisions; preserving extension lets OS pick the right app for "open externally."

**Supported file types and size limits:**
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` — max 10 MB each
- Documents: `.pdf` — max 25 MB each
- Text: `.txt`, `.md` — max 2 MB each
- Total reference storage cap: warn at 500 MB (informational only, no hard block)

**File lifecycle:** When a reference item with `type='image'` or `type='pdf'` is deleted, the main process deletes the corresponding file. Orphan cleanup runs on app startup (scan dir vs DB, delete orphans).

---

## 1. Schema Design — Migration 029

**File:** `src/main/migrations/029_reference_board.ts`

> Migration 027 = document storage, 028 = checklist groups. This is 029.

```sql
CREATE TABLE IF NOT EXISTS reference_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder',
  color TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reference_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES reference_categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('text', 'image', 'pdf', 'link')),
  content TEXT,               -- rich text (tiptap JSON) for type='text', URL for type='link'
  stored_filename TEXT,       -- UUID-based filename in reference-files/ (for image/pdf)
  original_filename TEXT,     -- original name for display
  file_size INTEGER,          -- bytes
  description TEXT,
  tags TEXT,                  -- comma-separated tags for search
  is_pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ref_items_category ON reference_items(category_id);
CREATE INDEX IF NOT EXISTS idx_ref_items_type ON reference_items(item_type);
CREATE INDEX IF NOT EXISTS idx_ref_items_pinned ON reference_items(is_pinned);

-- Auto-update updated_at on changes (no trigger exists by default for this table)
CREATE TRIGGER IF NOT EXISTS trg_ref_items_updated_at
  AFTER UPDATE ON reference_items
  FOR EACH ROW
  BEGIN
    UPDATE reference_items SET updated_at = datetime('now') WHERE id = OLD.id;
  END;
```

**Default categories seeded on first access (lazy, like alert rules):**
- Process Documents (icon: `file-text`, color: `#3b82f6`)
- Income Thresholds (icon: `dollar-sign`, color: `#10b981`)
- Forms & Templates (icon: `clipboard`, color: `#8b5cf6`)
- Procedures (icon: `list-checks`, color: `#f59e0b`)
- Quick Reference (icon: `bookmark`, color: `#ef4444`)

---

## 2. IPC Channels

**File:** `src/shared/ipc-channels.ts`

```typescript
// ── Reference Board ──
REF_BOARD_GET_CATEGORIES: 'ref-board:get-categories',
REF_BOARD_CREATE_CATEGORY: 'ref-board:create-category',
REF_BOARD_UPDATE_CATEGORY: 'ref-board:update-category',
REF_BOARD_DELETE_CATEGORY: 'ref-board:delete-category',
REF_BOARD_REORDER_CATEGORIES: 'ref-board:reorder-categories',
REF_BOARD_GET_ITEMS: 'ref-board:get-items',
REF_BOARD_GET_ITEM: 'ref-board:get-item',
REF_BOARD_CREATE_ITEM: 'ref-board:create-item',
REF_BOARD_UPDATE_ITEM: 'ref-board:update-item',
REF_BOARD_DELETE_ITEM: 'ref-board:delete-item',
REF_BOARD_REORDER_ITEMS: 'ref-board:reorder-items',
REF_BOARD_IMPORT_FILE: 'ref-board:import-file',
REF_BOARD_GET_FILE_PATH: 'ref-board:get-file-path',
REF_BOARD_OPEN_FILE: 'ref-board:open-file',
REF_BOARD_GET_STORAGE_STATS: 'ref-board:get-storage-stats',
```

**IPC Signatures:**

| Channel | Args | Returns |
|-|-|-|
| `REF_BOARD_GET_CATEGORIES` | none | `ReferenceCategory[]` |
| `REF_BOARD_CREATE_CATEGORY` | `name, icon, color` | `ReferenceCategory` |
| `REF_BOARD_UPDATE_CATEGORY` | `id, data: Partial<{name, icon, color, sort_order}>` | `true` |
| `REF_BOARD_DELETE_CATEGORY` | `id` | `true` |
| `REF_BOARD_REORDER_CATEGORIES` | `orderedIds: number[]` | `true` |
| `REF_BOARD_GET_ITEMS` | `params: RefBoardFilterParams` | `ReferenceItem[]` |
| `REF_BOARD_GET_ITEM` | `id` | `ReferenceItem` |
| `REF_BOARD_CREATE_ITEM` | `data: CreateRefItemInput` | `ReferenceItem` |
| `REF_BOARD_UPDATE_ITEM` | `id, data: Partial<UpdateRefItemInput>` | `ReferenceItem` |
| `REF_BOARD_DELETE_ITEM` | `id` | `true` (deletes file from disk too) |
| `REF_BOARD_REORDER_ITEMS` | `categoryId, orderedIds` | `true` |
| `REF_BOARD_IMPORT_FILE` | `filePath` | `{ storedFilename, originalFilename, fileSize }` |
| `REF_BOARD_GET_FILE_PATH` | `storedFilename` | `string` (absolute path) |
| `REF_BOARD_OPEN_FILE` | `storedFilename` | `true` (shell.openPath) |
| `REF_BOARD_GET_STORAGE_STATS` | none | `{ totalFiles, totalBytes }` |

---

## 3. Shared Types

**File:** `src/shared/types.ts`

```typescript
export type ReferenceItemType = 'text' | 'image' | 'pdf' | 'link'

export interface ReferenceCategory {
  id: number
  name: string
  icon: string
  color: string
  sort_order: number
  created_at: string
  item_count?: number  // computed in GET query
}

export interface ReferenceItem {
  id: number
  category_id: number | null
  title: string
  item_type: ReferenceItemType
  content: string | null
  stored_filename: string | null
  original_filename: string | null
  file_size: number | null
  description: string | null
  tags: string | null
  is_pinned: number
  sort_order: number
  created_at: string
  updated_at: string
  category_name?: string | null
  category_color?: string | null
}

export interface RefBoardFilterParams {
  search?: string
  categoryId?: number | null
  itemType?: ReferenceItemType | null
  pinnedOnly?: boolean
}

export interface CreateRefItemInput {
  category_id?: number | null
  title: string
  item_type: ReferenceItemType
  content?: string | null
  stored_filename?: string | null
  original_filename?: string | null
  file_size?: number | null
  description?: string | null
  tags?: string | null
}

export type UpdateRefItemInput = Partial<Omit<CreateRefItemInput, 'item_type'>> & {
  is_pinned?: number
}
```

---

## 4. Main Process Module

**New file:** `src/main/reference-board.ts`

**IMPORTANT — Shared file storage:** This module must **import and use `file-storage.ts`** from the document storage plan (migration 027), NOT define its own file management functions. Specifically:
- Use `getReferenceStorageDir()` from `file-storage.ts` (returns `pulse-files/references/`) — do NOT create a separate `getRefFilesDir()` or `reference-files/` directory
- Use `storeFile(sourcePath, getReferenceStorageDir())` for imports
- Use `deleteStoredFile(storedPath)` for deletions
- Use the shared `assertSafePath` + canonical path validation from `file-storage.ts`

Key functions (in `reference-board.ts`, using shared infra):
- `importReferenceFile(sourcePath: string)` — thin wrapper: calls `storeFile(sourcePath, getReferenceStorageDir())`, returns `{ storedFilename, originalFilename, fileSize }`
- `cleanupOrphanedReferenceFiles(): void` — called on DB open, scans `references/` subdir vs `reference_items` table. **Uses the same `restore_timestamp` flag in electron-store** as document storage to skip cleanup after backup restore.
- CRUD functions for categories and items following `contacts.ts` pattern (prepared statements, `cachedStmt`)
- `getItems(params: RefBoardFilterParams)` — supports LIKE search on title/description/tags/content, category filter, type filter, sorted by `is_pinned DESC, sort_order ASC`

**Startup cleanup coordination with document storage:** Both `reference-board.ts` and `file-storage.ts` register cleanup in the `openDatabase()` deferred timer. Order: (1) `purgeExpiredTrash` with file cleanup, (2) `cleanupOrphanedReferenceFiles`. Both check the `restore_timestamp` flag before deleting anything.
- CRUD functions for categories and items following `contacts.ts` pattern (prepared statements, `cachedStmt`)
- `getItems(params: RefBoardFilterParams)` — supports LIKE search on title/description/tags/content, category filter, type filter, sorted by `is_pinned DESC, sort_order ASC`

**New file:** `src/main/ipc/ipc-reference-board.ts`
- `registerReferenceBoardHandlers()` — follows `ipc-contacts.ts` pattern: `secureWrap`, `enforceWritable` on writes, `validId` checks

**Update:** `src/main/ipc-handlers.ts` — add `registerReferenceBoardHandlers()` call
**Update:** `src/main/database.ts` — import migration, call `cleanupOrphanedFiles()` after migrations

---

## 5. Zustand Store

**New file:** `src/renderer/stores/referenceBoardStore.ts`

```typescript
interface ReferenceBoardStore {
  // State
  items: ReferenceItem[]
  categories: ReferenceCategory[]
  selectedItemId: number | null
  selectedItem: ReferenceItem | null
  loading: boolean
  initialLoadDone: boolean
  filterParams: RefBoardFilterParams

  // Actions
  loadItems: () => Promise<void>
  loadCategories: () => Promise<void>
  selectItem: (id: number | null) => Promise<void>
  createItem: (data: CreateRefItemInput) => Promise<ReferenceItem | null>
  updateItem: (id: number, data: UpdateRefItemInput) => Promise<void>
  deleteItem: (id: number) => Promise<void>
  togglePin: (id: number) => Promise<void>
  setFilterParams: (params: RefBoardFilterParams) => void

  // Category actions
  createCategory: (name: string, icon: string, color: string) => Promise<ReferenceCategory | null>
  updateCategory: (id: number, data: Partial<{name: string; icon: string; color: string}>) => Promise<void>
  deleteCategory: (id: number) => Promise<void>
  reorderCategories: (orderedIds: number[]) => Promise<void>
}
```

Follows `contactsStore.ts` pattern: `storeInvoke`, undo items via `useUndoStore`, `useShallow` subscriptions.

---

## 6. Renderer UI — List-Detail Layout

**New file:** `src/renderer/views/ReferenceBoardView.tsx`

Follows `ContactsView.tsx` two-panel layout:

### Left Panel (flex-1):
- Header bar: "Reference Board" title, item count, "Categories" button, "Add Item" dropdown (Text Note / Image / PDF / Link)
- Filter bar:
  - Search input (debounced 150ms, searches title + description + tags + content)
  - Category chips (horizontal scroll, click to filter)
  - Type filter dropdown (All / Text / Image / PDF / Link)
  - Pin filter toggle
- Item list with virtual scrolling (`@tanstack/react-virtual`):
  - Each row: 56px height, type icon, title, category color stripe, pin indicator, date
  - Selected item highlighted blue
  - Pinned items always sort to top

### Right Panel (w-[480px]):
- Empty state: clipboard icon + "Select an item to view"
- When item selected, `ReferenceItemDetail` component:
  - **Text items:** Tiptap editor (read mode default, "Edit" toggles edit, auto-save on blur 500ms debounce)
  - **Image items:** Full preview with object-fit contain, max-height constrained. Zoom button opens modal. Shows filename, size, date.
  - **PDF items:** Filename, size. "Open in default app" button (`REF_BOARD_OPEN_FILE`). **Validate against `SAFE_EXTENSIONS` before calling `shell.openPath`** (same pattern as existing document handler in ipc-tasks.ts).
  - **Link items:** Clickable URL (opens external browser via `APP_OPEN_EXTERNAL`). Description field.
  - All types: editable title, description, tags (comma-separated), category selector, pin toggle, delete with ConfirmDialog

### New components (`src/renderer/components/reference-board/`):
- [ ] `ReferenceFilterBar.tsx` — search + category chips + type filter + pin filter
- [ ] `ReferenceItemRow.tsx` — 56px list row with type icon, title, category stripe, pin icon
- [ ] `ReferenceItemDetail.tsx` — right panel detail viewer/editor (switches on item_type)
- [ ] `ReferenceItemForm.tsx` — slide-in panel for creating new items
- [ ] `ReferenceCategoryManager.tsx` — modal for category CRUD (follows `CategoryManager.tsx` pattern)
- [ ] `ReferenceTextEditor.tsx` — tiptap wrapper for text note items (view/edit toggle)
- [ ] `ReferenceImagePreview.tsx` — image display with zoom modal

### Add Item flow:
1. Click "Add Item" dropdown, pick type
2. For text/link: `ReferenceItemForm` slide-in opens
3. For image/pdf: Native file dialog opens, file imported via `REF_BOARD_IMPORT_FILE`, then form opens pre-populated with filename as title
4. On save: `REF_BOARD_CREATE_ITEM`, list refreshes, new item auto-selected

---

## 7. Sidebar Navigation

**File:** `src/renderer/components/layout/Sidebar.tsx`

Add "Reference Board" nav item between Contacts and Snippets:
- Icon: `Bookmark` from lucide-react
- Route: `/reference-board`

**File:** `src/renderer/App.tsx`
- Import `ReferenceBoardView`
- Add `<Route path="/reference-board" element={...} />`

---

## 8. Keyboard Shortcuts

In `ReferenceBoardView.tsx`:
- `/` — focus search input
- `N` — open "Add Item" (when not in input)
- `ArrowUp/Down` — navigate item list
- `Enter` — select focused item
- `Delete` — delete selected (with confirm)
- `P` — toggle pin on selected
- `E` — edit selected text item
- `Escape` — close form / exit edit mode

Global (in `useGlobalKeyboard.ts`):
- `Ctrl+Shift+B` — navigate to Reference Board (**not** `Ctrl+Shift+R` which is already used for "Add Client" in DataGrid)

---

## 9. Backup Considerations

Current backup only backs up `pulse.db`. Reference files in `reference-files/` need to be included in Layer 2/3 backups.

**For MVP:** Document as known limitation — reference items store enough metadata to be useful without files. Users can re-import after restore.

**Follow-up:** Modify `createBackupArchive()` to optionally include `reference-files/` directory. Opt-in in Settings since it increases backup size.

---

## 10. Implementation Sequence

1. [ ] Migration (schema + default categories seed logic)
2. [ ] IPC channels in `ipc-channels.ts`
3. [ ] Shared types in `types.ts`
4. [ ] Main process `reference-board.ts` (CRUD + file management)
5. [ ] IPC handler `ipc/ipc-reference-board.ts` + register in `ipc-handlers.ts`
6. [ ] Zustand store `referenceBoardStore.ts`
7. [ ] UI components (bottom-up): `ReferenceItemRow` → `ReferenceFilterBar` → `ReferenceItemDetail` → `ReferenceTextEditor` → `ReferenceImagePreview` → `ReferenceItemForm` → `ReferenceCategoryManager`
8. [ ] View: `ReferenceBoardView.tsx`
9. [ ] Route in `App.tsx` + sidebar nav in `Sidebar.tsx`
10. [ ] Keyboard shortcuts
11. [ ] Tests
12. [ ] Backup integration (follow-up)

---

## 11. Test Scenarios

- [ ] Category CRUD: create, rename, reorder, delete; items with deleted category get `category_id=NULL`
- [ ] Text item lifecycle: create, edit content, pin, unpin, delete; verify undo
- [ ] Image import: import PNG, verify copy in `reference-files/`, UUID naming, preview renders
- [ ] PDF import: import PDF, verify copy, "Open externally" works
- [ ] Link item: create, verify URL validation, external open
- [ ] Size limits: attempt 15MB image, expect rejection with clear message
- [ ] File cleanup: delete image item, verify file removed from disk
- [ ] Orphan cleanup: manually place file, verify startup cleanup removes it
- [ ] Search: varied titles/tags/descriptions, verify cross-field search
- [ ] Category filter: filter by category, only matching items shown
- [ ] Keyboard navigation: `/` search, `N` add, arrows navigate, `P` pin
- [ ] Virtual scrolling: 200+ items, smooth scroll performance

---

## Critical Files

| File | Change |
|-|-|
| `src/main/reference-board.ts` | New: CRUD + file management |
| `src/main/ipc/ipc-reference-board.ts` | New: IPC handlers |
| `src/renderer/views/ReferenceBoardView.tsx` | New: two-panel view |
| `src/renderer/stores/referenceBoardStore.ts` | New: Zustand store |
| `src/renderer/components/reference-board/*.tsx` | New: 7 components |
| `src/renderer/views/ContactsView.tsx` | Reference: UI pattern to follow |
| `src/main/contacts.ts` | Reference: CRUD pattern to follow |
| `src/main/database.ts` | Update: migration + orphan cleanup |
| `src/shared/ipc-channels.ts` | Update: 16 new channels |
| `src/shared/types.ts` | Update: 6 new types/interfaces |
