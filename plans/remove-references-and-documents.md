# Plan: Remove References and Documents Features

## Goal
Completely remove the Reference Board (nav → Tools → References) and the Documents panel (Profile view → per-client) from the codebase while leaving every other feature intact and the app fully functional.

## Execution Order
Phases must be done in this order. Phases B and C can be done in either order relative to each other, but both must complete before Phase D. Migration (Phase A) must be applied and registered before any cleanup of the backing logic in database.ts / ipc-row.ts (Phase D).

---

## Phase A — New Migration (031)

**File to create:** `src/main/migrations/031_remove_docs_and_refboard.ts`

Drop all three feature tables in dependency order (child tables first). Also update schema_version to 31.

```typescript
import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // reference_items references reference_categories
  db.exec(`DROP TABLE IF EXISTS reference_items`)
  db.exec(`DROP TABLE IF EXISTS reference_categories`)
  // document_refs references rows (CASCADE was on rows→refs, but dropping the dependent table is safe)
  db.exec(`DROP TABLE IF EXISTS document_refs`)
  db.prepare("UPDATE app_meta SET value = '31' WHERE key = 'schema_version'").run()
}
```

**Register in `src/main/database.ts`:**
1. Add import: `import { up as migration031 } from './migrations/031_remove_docs_and_refboard'`
2. Add to migrations array: `{ version: 31, up: migration031 }`

**Do NOT delete the existing migration files** (001, 027, 029, etc.) — they are part of the migration chain for existing databases.

---

## Phase B — Remove Feature 1: Reference Board

### Files to delete entirely
```
src/renderer/views/ReferenceBoardView.tsx
src/renderer/stores/referenceBoardStore.ts
src/main/reference-board.ts
src/main/ipc/ipc-reference-board.ts
src/renderer/components/reference-board/ReferenceCategoryManager.tsx
src/renderer/components/reference-board/ReferenceFilterBar.tsx
src/renderer/components/reference-board/ReferenceItemForm.tsx
src/renderer/components/reference-board/ReferenceItemRow.tsx
src/renderer/components/reference-board/ReferenceItemDetail.tsx
src/renderer/components/reference-board/ReferenceTextEditor.tsx
src/renderer/components/reference-board/ReferenceImagePreview.tsx
```
Also delete the now-empty directory: `src/renderer/components/reference-board/`

### `src/renderer/App.tsx`
- Remove line 20: `import ReferenceBoardView from './views/ReferenceBoardView'`
- Remove the route block (lines ~221–224):
  ```tsx
  path="/reference-board"
  element={…<ReferenceBoardView />…}
  ```

### `src/renderer/components/layout/Sidebar.tsx`
- Remove line ~250: `const isReferenceBoard = location.pathname.startsWith('/reference-board')`
- Remove the entire Reference Board nav button block (lines ~559–582), including the comment `{/* Reference Board link */}`, the `<button>` element, its `onClick`, `className`, `title`, `aria-current`, the active indicator `div`, and the `<span>References</span>`.

### `src/renderer/hooks/useGlobalKeyboard.ts`
- Remove the Ctrl+Shift+B handler block (lines ~35–38):
  ```typescript
  // Ctrl+Shift+B — Reference Board
  …
  window.location.hash = '#/reference-board'
  ```

### `src/main/ipc-handlers.ts`
- Remove line ~27: `import { registerReferenceBoardHandlers } from './ipc/ipc-reference-board'`
- Remove line ~50: `registerReferenceBoardHandlers()`

### `src/shared/ipc-channels.ts`
- Remove all 15 `REF_BOARD_*` entries (lines ~278–292):
  `REF_BOARD_GET_CATEGORIES`, `REF_BOARD_CREATE_CATEGORY`, `REF_BOARD_UPDATE_CATEGORY`, `REF_BOARD_DELETE_CATEGORY`, `REF_BOARD_REORDER_CATEGORIES`, `REF_BOARD_GET_ITEMS`, `REF_BOARD_GET_ITEM`, `REF_BOARD_CREATE_ITEM`, `REF_BOARD_UPDATE_ITEM`, `REF_BOARD_DELETE_ITEM`, `REF_BOARD_REORDER_ITEMS`, `REF_BOARD_IMPORT_FILE`, `REF_BOARD_GET_FILE_PATH`, `REF_BOARD_OPEN_FILE`, `REF_BOARD_GET_STORAGE_STATS`

### `src/shared/types.ts`
- Remove the Reference Board type block (~lines 570–613):
  `ReferenceItemType` type alias, `ReferenceCategory` interface, `ReferenceItem` interface, `RefBoardFilterParams` interface (if present), `CreateRefItemInput` type, `UpdateRefItemInput` type — everything under the `// ── Reference Board ──` comment.

> **Note:** `src/shared/ipc-contract.ts` has NO reference board entries — no changes needed there for Feature 1.

---

## Phase C — Remove Feature 2: Documents

### Files to delete entirely
```
src/renderer/components/profile/RelatedDocuments.tsx
```

### `src/renderer/views/ProfileView.tsx`
- Remove line ~15: `import { RelatedDocuments } from '../components/profile/RelatedDocuments'`
- Remove line ~454: `<RelatedDocuments rowId={rowId} />`
  (the JSX mount inside the profile layout — remove the element and any wrapping container that only exists for it)

### `src/main/ipc/ipc-tasks.ts`
Remove the following entire `secureWrap` handler blocks and their comments:
- `DOCUMENT_REF_GET_ALL` (line ~410)
- `DOCUMENT_REF_CREATE` (line ~437)
- `DOCUMENT_REF_UPDATE` (line ~472)
- `DOCUMENT_REF_DELETE` (line ~482)
- `DOCUMENT_REF_OPEN` (line ~503)
- `DOCUMENT_REF_EXPORT` (line ~578)
- `DOCUMENT_REF_RESTORE` (line ~620)
- `DOCUMENT_STORAGE_STATS` (line ~648)
- `DOCUMENT_STORAGE_MIGRATE` (line ~659)

Also update the import on line ~12 — remove `storeFile, getDocumentStorageDir, moveToPendingDelete, restoreFromPendingDelete, exportStoredFile, getStorageStats, migrateExistingRefs` from the `file-storage` import. Keep `getFileStorageRoot` if it is used elsewhere in ipc-tasks.ts; otherwise remove it too.

Also remove the `documents_root` setting reads throughout ipc-tasks.ts (lines ~416, ~444, ~515, ~540, ~592) — these are all inside the DOCUMENT_REF_* handlers being deleted, so they go away automatically.

### `src/shared/ipc-channels.ts`
- Remove 7 `DOCUMENT_REF_*` entries (lines ~102–108):
  `DOCUMENT_REF_GET_ALL`, `DOCUMENT_REF_CREATE`, `DOCUMENT_REF_UPDATE`, `DOCUMENT_REF_DELETE`, `DOCUMENT_REF_OPEN`, `DOCUMENT_REF_EXPORT`, `DOCUMENT_REF_RESTORE`
- Remove 2 `DOCUMENT_STORAGE_*` entries (lines ~109–110):
  `DOCUMENT_STORAGE_STATS`, `DOCUMENT_STORAGE_MIGRATE`

### `src/shared/ipc-contract.ts`
- Remove `DocumentRef` from the imports on line ~14
- Remove the 5 `document-ref:*` entries (lines ~197–201):
  `document-ref:get-all`, `document-ref:create`, `document-ref:update`, `document-ref:delete`, `document-ref:open`

### `src/shared/types.ts`
- Remove the `DocumentRef` interface and its comment block (~lines 355–375, the `// ── Document References ──` section).

### `src/renderer/components/settings/DataSection.tsx`
Remove two UI sections and their backing logic:

1. **Document storage section** (~lines 82–120): the `<div>` block with heading "Document storage", the stats display showing file count/size, and the "Import existing attachments" button that calls `DOCUMENT_STORAGE_MIGRATE`.

2. **Documents root folder section** (~lines 125–165): the `<div>` block with heading "Documents root folder", the explanation paragraph, the current path display, the "Choose folder" button that calls `saveSetting('documents_root', …)`, and the "Clear" button.

Also remove:
- The `docStats` state variable and its type
- The `docsRoot` state variable and its type  
- The `DOCUMENT_STORAGE_STATS` invocation in the `useEffect` that loads settings (~line 39)
- The `IPC.DOCUMENT_STORAGE_STATS` and `IPC.DOCUMENT_STORAGE_MIGRATE` references

### `src/main/ipc/ipc-settings.ts`
- Remove `'documents_root'` from the allowed settings keys array (~line 11).

---

## Phase D — Shared Infrastructure Cleanup

### `src/main/database.ts`
Remove the document_refs file cleanup block inside the batch-delete transaction (~lines 309–320):
```typescript
// 2. Collect stored file paths before cascade deletes remove document_refs
const docStmt = db.prepare(
  "SELECT stored_path FROM document_refs WHERE row_id = ? AND stored_path IS NOT NULL"
)
for (const row of rows) {
  const docs = docStmt.all(row.id) as Array<{ stored_path: string }>
  for (const doc of docs)
    storedPaths.push(doc.stored_path)
}
```
Also remove the `storedPaths` array, the `deleteStoredFileSync` calls that iterate it, and the `deleteStoredFileSync` import from `./file-storage` — unless `deleteStoredFileSync` is still used elsewhere in database.ts (check the full file).

### `src/main/ipc/ipc-row.ts`
Remove two document_refs cleanup blocks:

1. Hard-delete cleanup (~lines 309–326):
   ```typescript
   const docs = db.prepare(
     "SELECT stored_path FROM document_refs WHERE row_id = ? AND stored_path IS NOT NULL"
   ).all(rowId) as Array<{ stored_path: string }>
   for (const doc of docs) {
     try { deleteStoredFileSync(doc.stored_path) } catch (err) { … }
   }
   ```

2. Purge cleanup (~lines 350–359): same pattern, same removal.

Also remove the `import { deleteStoredFileSync } from '../file-storage'` line (~line 9) — unless `deleteStoredFileSync` is still used elsewhere in ipc-row.ts after the above removals.

### `src/main/file-storage.ts`
After both features are removed, the following exported functions become unused and should be deleted:
- `getDocumentStorageDir()` — only called by DOCUMENT_REF_CREATE handler
- `getReferenceStorageDir()` — only called by reference-board.ts
- `storeFile()` — only called by DOCUMENT_REF_CREATE and reference-board.ts
- `deleteStoredFileSync()` — only called by document cleanup in database.ts and ipc-row.ts (removed in Phase D)
- `deleteStoredFile()` — check for remaining callers; if none, remove
- `exportStoredFile()` — only called by DOCUMENT_REF_EXPORT handler
- `getStorageStats()` — only called by DOCUMENT_STORAGE_STATS and REF_BOARD_GET_STORAGE_STATS handlers
- `moveToPendingDelete()` — only called by DOCUMENT_REF_DELETE handler
- `restoreFromPendingDelete()` — only called by DOCUMENT_REF_RESTORE handler
- `purgePendingDeletes()` — only called by `startPendingDeletePurgeTimer()`
- `startPendingDeletePurgeTimer()` — only called by database.ts on DB open; remove from database.ts too
- `stopPendingDeletePurgeTimer()` — only called by database.ts on DB close; remove from database.ts too
- `migrateExistingRefs()` — only called by DOCUMENT_STORAGE_MIGRATE handler

**Functions to KEEP** (still used by surviving code):
- `getFileStorageRoot()` — used by `src/main/index.ts` (~line 295) for path security validation (assertSafePath logic); keep.
- `sanitizeForFilesystem()` — verify remaining callers; if none remain after the feature removals, remove; otherwise keep.
- `MAX_FILE_SIZE` and `ALLOWED_EXTENSIONS` constants — verify remaining callers; remove if unused.

Also remove from `src/main/database.ts`:
- The `startPendingDeletePurgeTimer` and `stopPendingDeletePurgeTimer` imports from `./file-storage`
- The `startPendingDeletePurgeTimer()` call on DB open (~line 372)
- The `stopPendingDeletePurgeTimer()` call on DB close (~line 381)

If after all removals `file-storage.ts` only exports `getFileStorageRoot()` and nothing else of substance, consider whether to keep the file as a small focused module or inline the one function into `index.ts`. Given the file has security responsibilities (path validation), keeping it as a named module is cleaner.

---

## Phase E — Tests & Verification

### Test files to remove
Search for test files covering these features:
```bash
find src -name "*.test.ts" | xargs grep -l "reference.board\|document.ref\|RelatedDoc\|REF_BOARD\|DOCUMENT_REF" 2>/dev/null
```
Delete any files that test only the removed features. Do not delete test utilities shared with other tests.

### TypeScript check
```bash
npx tsc --noEmit
```
Must pass with zero errors before committing.

### Full test suite
```bash
npm test
```
Must pass. Any tests that reference removed symbols will fail and should be deleted (not fixed to skip).

### Manual smoke test
After `npm run dev`:
1. Sidebar no longer shows "References" item under Tools
2. Ctrl+Shift+B does nothing (or navigates elsewhere — confirm the key is simply unbound)
3. Profile view loads without a Documents section; all other profile sections render correctly
4. Settings → Data tab: "Document storage" and "Documents root folder" sections are gone; all other settings sections work
5. All other nav items (Grid, Dashboard, Tasks, Contacts, Trash) still load and function normally
6. New migration runs cleanly on a fresh DB (no errors on first launch)

---

## Risk & Safety Notes

| Risk | Mitigation |
|-|-|
| Migration 031 drops document_refs while database.ts still has cleanup logic | Phase D removes the cleanup logic; both happen before committing. The table drop is idempotent (IF EXISTS). |
| `deleteStoredFileSync` removed while still imported | Remove import after removing all call sites. TypeScript check will catch any missed import. |
| `documents_root` setting still in ipc-settings.ts allowed list | Removed in Phase C. Leaving it would be harmless (unused key) but clean removal is correct. |
| ipc-contract.ts still imports DocumentRef | Removed in Phase C. TypeScript will error if missed. |
| Removing `startPendingDeletePurgeTimer` from database.ts could leave pending-delete directory accumulating | The pending-delete pattern only exists for documents. With document_refs dropped, no new pending-delete entries are ever created. The existing timer removal is safe; any files already in the pending-delete staging directory are harmless orphans. |
| Reference board migration file (029) still exists | Correct — do NOT delete it. The new migration 031 drops the tables it created. The 029 migration file must stay in the chain. |
| Tests referencing removed types fail to compile | Expected. Delete those test files entirely rather than patching them. |
