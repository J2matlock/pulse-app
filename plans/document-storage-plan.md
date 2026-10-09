# Document Storage (Copy-on-Link) — Implementation Plan

## Problem

Currently, `RelatedDocuments.tsx` stores only file path references. If the original file is moved or deleted, the link breaks. Users see a "Locate File" button but the document is gone. Case workers need their attached documents to be safe regardless of what happens to the original files.

## Solution

When a user attaches a document, copy it into the app's data directory (`pulse-files/documents/{rowId}/`). The stored copy is permanent and independent of the original. This also shares infrastructure with the Reference Board module.

---

## 1. Shared File Storage Module

**New file:** `src/main/file-storage.ts`

This central module serves both profile documents and the Reference Board.

```typescript
export function getFileStorageRoot(): string
  // Returns: `${getPortableDataDir()}/pulse-files`
  // Creates directory if it doesn't exist

export function getDocumentStorageDir(rowId: number): string
  // Returns: `${getFileStorageRoot()}/documents/${rowId}/`
  // Creates directory if it doesn't exist

export function getReferenceStorageDir(): string
  // Returns: `${getFileStorageRoot()}/references/`
  // For Reference Board (separate plan)

export async function storeFile(sourcePath: string, destSubdir: string): Promise<StoredFileResult>
  // 1. **assertSafePath(sourcePath)** — prevent path traversal from renderer
  // 2. Validate source exists (fs.promises.access)
  // 3. Validate file size (reject > MAX_FILE_SIZE)
  // 4. Validate file extension (ALLOWED_EXTENSIONS)
  // 5. Generate UUID filename: `${crypto.randomUUID()}${path.extname(sourcePath)}`
  // 6. Copy file: fs.promises.copyFile(sourcePath, destPath)
  // 7. Verify: stat destination, confirm size matches
  // 8. Return { storedPath, originalName, fileSize }

export function deleteStoredFileSync(storedPath: string): void
  // Sync variant for use within synchronous IPC handlers (ROW_HARD_DELETE, ROW_PURGE)
  // 1. Validate storedPath is inside pulse-files/ using **path.resolve() + startsWith()** on canonical paths (NOT string containment — prevents `pulse-files/../../etc/passwd` traversal)
  // 2. fs.unlinkSync(storedPath)
  // 3. Try fs.rmdirSync parent if empty

export async function deleteStoredFile(storedPath: string): Promise<void>
  // Async variant for use in async handlers (DOCUMENT_REF_DELETE, cleanup timers)
  // Same validation as sync variant
  // 1. Validate storedPath is inside pulse-files/
  // 2. fs.promises.unlink(storedPath)
  // 3. Try rmdir parent if empty

export async function exportStoredFile(storedPath: string, destPath: string): Promise<void>
  // 1. Validate storedPath is inside pulse-files/
  // 2. assertSafePath(destPath)
  // 3. fs.promises.copyFile(storedPath, destPath)

export async function getStorageStats(): Promise<{ totalFiles: number; totalBytes: number }>
  // Walk pulse-files/ directory, count files and sum sizes

export async function migrateExistingRefs(
  db: Database,
  progressCallback?: (current: number, total: number) => void
): Promise<{ migrated: number; failed: number; skipped: number }>
  // For each document_ref where stored_path IS NULL:
  //   1. Resolve file_path (handle relative paths via documents_root)
  //   2. If file exists, storeFile() and UPDATE stored_path + original_name
  //   3. If file doesn't exist, skip
  //   4. Call progressCallback for UI progress
  // **PERFORMANCE:** Process files with concurrency limit of 5 (not sequential)
  // to avoid blocking the main process for minutes with hundreds of large files.
  // Use a simple semaphore pattern or p-limit-style queue.
```

**Constants:**
```typescript
const MAX_FILE_SIZE = 100 * 1024 * 1024  // 100 MB per file
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp',
  '.odt', '.ods', '.odp', '.ppt', '.pptx'
])
```

**Type:**
```typescript
export interface StoredFileResult {
  storedPath: string    // Absolute path to stored copy
  originalName: string  // Original filename
  fileSize: number      // Size in bytes
}
```

---

## 2. Schema Migration

**File:** `src/main/migrations/027_document_storage.ts`

> Note: Migration number may shift based on implementation order with other plans.

```sql
ALTER TABLE document_refs ADD COLUMN stored_path TEXT;
ALTER TABLE document_refs ADD COLUMN original_name TEXT;
ALTER TABLE document_refs ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'reference';
-- storage_mode: 'reference' (legacy path-only) or 'stored' (copied into pulse-files)
```

- `stored_path`: Absolute path to copy inside `pulse-files/documents/{rowId}/`
- `original_name`: Original filename at attachment time
- `storage_mode`: Distinguishes legacy references from stored copies

No data migration in SQL. File copying is handled lazily (see section 6).

---

## 3. Type Updates

**File:** `src/shared/types.ts`

```typescript
export interface DocumentRef {
  id: number
  row_id: number
  file_name: string
  file_path: string          // Original source path (kept for provenance)
  relative_path: string | null
  stored_path: string | null    // NEW: path inside pulse-files/
  original_name: string | null  // NEW: original filename
  storage_mode: string          // NEW: 'reference' | 'stored'
  description: string | null
  category: string | null
  file_size: number | null
  added_at: string
  exists?: boolean
}
```

---

## 4. IPC Channel Additions

**File:** `src/shared/ipc-channels.ts`

```typescript
DOCUMENT_REF_EXPORT: 'document-ref:export',          // Export stored file to user-chosen location
DOCUMENT_REF_RESTORE: 'document-ref:restore',        // Restore deleted doc from .pending-delete (for undo)
DOCUMENT_STORAGE_STATS: 'document-storage:stats',     // Get storage usage stats
DOCUMENT_STORAGE_MIGRATE: 'document-storage:migrate',  // Migrate legacy refs to stored copies
```

---

## 5. IPC Handler Changes

**File:** `src/main/ipc/ipc-tasks.ts`

### 5.1 Modified: `DOCUMENT_REF_CREATE`

```
Current: receive filePath → stat for size → INSERT path into DB
New:     receive filePath → storeFile() → INSERT with stored_path + original_name + storage_mode='stored'
```

1. Import `storeFile`, `getDocumentStorageDir` from `file-storage.ts`
2. After `assertSafePath(filePath)`, call `storeFile(filePath, getDocumentStorageDir(rowId))`
3. If `storeFile` fails, return `fail()` with descriptive message
4. INSERT includes `stored_path`, `original_name`, `storage_mode = 'stored'`
5. `exists` always `true` for newly stored docs

### 5.2 Modified: `DOCUMENT_REF_GET_ALL`

- If `storage_mode === 'stored'`: check `stored_path` existence, set `exists`
- If `storage_mode === 'reference'` (legacy): use existing path resolution logic

### 5.3 Modified: `DOCUMENT_REF_OPEN`

**Signature change:** `(refId: number)` instead of `(filePath: string)`

1. Look up `document_refs WHERE id = refId`
2. If `stored_path` set → open that
3. If legacy → resolve `file_path` as before
4. Safer: avoids renderer passing arbitrary paths

### 5.4 Modified: `DOCUMENT_REF_DELETE`

1. Look up ref first: `SELECT stored_path, storage_mode FROM document_refs WHERE id = ?`
2. If `storage_mode === 'stored'`, move file to `pulse-files/.pending-delete/{uuid}` (for undo)
3. DELETE from DB
4. Startup cleanup: purge `.pending-delete/` contents older than 10 minutes

### 5.5 New: `DOCUMENT_REF_EXPORT`

```typescript
// Args: (refId: number, destPath: string)
// 1. Look up ref by ID
// 2. Use stored_path (or resolved file_path for legacy)
// 3. Copy to destPath via exportStoredFile()
// 4. Return ok({ destPath })
```

Renderer calls `APP_SHOW_SAVE_DIALOG` first to get destination, then calls this.

### 5.6 New: `DOCUMENT_STORAGE_STATS`

Returns `{ totalFiles, totalBytes }` from `getStorageStats()`.

### 5.7 New: `DOCUMENT_STORAGE_MIGRATE`

Calls `migrateExistingRefs(db)`, returns `{ migrated, failed, skipped }`.

---

## 6. Backward Compatibility — Lazy Migration

**Strategy:** Legacy refs continue to work. Migration is opt-in.

- On schema upgrade, only columns are added. No files moved.
- Legacy refs (`storage_mode = 'reference'`) work exactly as before
- "Import Linked Files" button in Settings > Data allows on-demand migration
- On first load after upgrade, if legacy refs exist: one-time toast "Some documents are stored as references. Go to Settings > Data to import them for safe storage."

**Migration flow:**
1. User clicks "Import Linked Files" in Settings > Data
2. Calls `DOCUMENT_STORAGE_MIGRATE`
3. Iterates refs with `storage_mode = 'reference'`
4. For each: resolve path → check exists → `storeFile()` → update DB
5. Returns summary: `{migrated: 15, failed: 2, skipped: 3}`
6. Shows result toast

---

## 7. Client Delete Cleanup — THREE paths

**CRITICAL:** There are three code paths that permanently delete rows. All three must clean up stored files.

### 7a. `ROW_HARD_DELETE` (ipc-row.ts:303-318)

Only allows hard-delete for rows created within the last 60 seconds (undo of accidental add). Add file cleanup here:

```typescript
// Before DELETE FROM rows:
const docs = db.prepare(
  "SELECT stored_path FROM document_refs WHERE row_id = ? AND stored_path IS NOT NULL"
).all(rowId)
// After DB cascade delete:
for (const doc of docs) {
  try { await deleteStoredFile(doc.stored_path) } catch { /* log */ }
}
```

### 7b. `ROW_PURGE` (ipc-row.ts:333-343) — **PRIMARY permanent-delete path**

This is the handler for permanently deleting soft-deleted rows from the trash. **This is the most common path for permanent deletion** and was missing from the original plan. Same file cleanup pattern as above.

### 7c. `purgeExpiredTrash()` (database.ts)

Runs on DB open, deletes rows with `deleted_at > 30 days`. **Current implementation is a single DELETE statement** (line 290-302) with no preceding SELECT. Must restructure to:
1. SELECT row IDs being purged: `SELECT id FROM rows WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')`
2. For each, SELECT stored_paths: `SELECT stored_path FROM document_refs WHERE row_id IN (...) AND stored_path IS NOT NULL`
3. DELETE the rows (CASCADE handles document_refs)
4. Delete the stored files using `deleteStoredFileSync()` (sync, since this runs in a sync context)
5. Clean up empty per-row document directories

---

## 8. UI Changes to RelatedDocuments.tsx

### 8.1 `handleAttach`:
- Show "Copying..." state (`copying` boolean) during file import
- IPC call same (`DOCUMENT_REF_CREATE`) but now returns `storage_mode: 'stored'`

### 8.2 `handleOpen`:
- Change from `safeInvoke(IPC.DOCUMENT_REF_OPEN, ref.file_path)` to `safeInvoke(IPC.DOCUMENT_REF_OPEN, ref.id)`

### 8.3 New `handleExport`:
```typescript
async function handleExport(ref: DocumentRef) {
  const saveRes = await safeInvoke(IPC.APP_SHOW_SAVE_DIALOG, {
    title: 'Save Document As',
    defaultPath: ref.original_name ?? ref.file_name,
    filters: [{ name: 'All Files', extensions: ['*'] }]
  })
  if (saveRes.ok && saveRes.data?.filePath) {
    await safeInvoke(IPC.DOCUMENT_REF_EXPORT, ref.id, saveRes.data.filePath)
  }
}
```

### 8.4 Rendering changes:
- **Stored docs:** No broken link warning. Show "Open" + "Save As" + "Remove" buttons
- **Legacy refs:** Keep existing behavior (exists check, Locate File). Add subtle "Import" button
- Show file size for all docs
- Small badge indicating storage mode

### 8.5 Undo for delete:
- On delete: move stored file to `pulse-files/.pending-delete/` (not immediate delete)
- **Add new IPC channel `DOCUMENT_REF_RESTORE`** — restores file from `.pending-delete/` back to its original storage location. The renderer's undo callback should call this instead of `DOCUMENT_REF_CREATE` with the original `file_path` (which may no longer exist).
- On undo: call `DOCUMENT_REF_RESTORE` which moves file back from `.pending-delete/` and re-inserts DB row
- Startup: purge `.pending-delete/` older than 10 minutes
- **Also add a periodic timer** (every 30 minutes) to purge `.pending-delete/` while the app is running, not just at startup

### 8.6 `handleLocate` (re-linking broken ref):
- Current `handleLocate` does delete+recreate, which would lose `stored_path` data for a stored doc
- Update: when re-locating a stored doc, call `storeFile` on the new path and update `stored_path` in the existing row (UPDATE, not delete+recreate)

### 8.7 Relative path handling:
- **IMPORTANT:** Current renderer (`RelatedDocuments.tsx` line 48-54) strips the `docsRoot` prefix and may pass a relative path to `DOCUMENT_REF_CREATE`. `storeFile()` needs an absolute path.
- **Fix:** In the `DOCUMENT_REF_CREATE` handler, resolve the path against `docsRoot` before calling `storeFile()`. If the path is already absolute, use it as-is. This matches the existing path resolution logic in `DOCUMENT_REF_GET_ALL`.

---

## 9. Settings View Updates

**File:** `src/renderer/views/SettingsView.tsx` — Data tab:

1. **Storage usage:** "Document Storage: X files, Y MB" (calls `DOCUMENT_STORAGE_STATS`)
2. **"Import Linked Files" button:** Triggers `DOCUMENT_STORAGE_MIGRATE` for legacy refs
3. **"Open Storage Folder" button:** Opens `getFileStorageRoot()` in file manager

---

## 10. Backup Integration

**For this plan:** Add `"has_stored_documents": true` flag to backup metadata so future restore logic knows to look for `pulse-files/`.

**Follow-up:** Add Settings option "Include attached documents in backups." When enabled, Layer 2/3 backups zip `pulse-files/` alongside DB. Opt-in due to size increase.

---

## 11. Implementation Sequence

| Step | File | Description |
|-|-|-|
| 1 | `src/main/file-storage.ts` | Create shared file storage module |
| 2 | `src/main/migrations/027_document_storage.ts` | Schema migration: add columns |
| 3 | `src/shared/types.ts` | Update `DocumentRef` interface |
| 4 | `src/shared/ipc-channels.ts` | Add 4 new IPC channels (EXPORT, RESTORE, STATS, MIGRATE) |
| 5 | `src/main/ipc/ipc-tasks.ts` | Modify CREATE/GET_ALL/DELETE/OPEN; add EXPORT/RESTORE/STATS/MIGRATE |
| 6 | `src/main/ipc/ipc-row.ts` | Add stored file cleanup to ROW_HARD_DELETE **and ROW_PURGE** |
| 7 | `src/main/database.ts` | Add stored file cleanup to purgeExpiredTrash |
| 8 | `src/renderer/components/profile/RelatedDocuments.tsx` | UI: copying indicator, Save As, open by ID |
| 9 | `src/renderer/views/SettingsView.tsx` | Storage stats + migrate button in Data tab |
| 10 | `src/main/backup.ts` | Add stored_documents flag to backup metadata |
| 11 | Tests | Unit + integration tests |

---

## 12. Test Scenarios

- [ ] Attach new file: verify copy in `pulse-files/documents/{rowId}/`, DB has `stored_path`, original deletable
- [ ] Open stored document: `shell.openPath` called with stored copy path
- [ ] Export/Save As: file copied to chosen destination with original filename
- [ ] Delete stored document: file moved to pending-delete, DB row deleted
- [ ] Undo delete: document restored from pending-delete
- [ ] Hard delete client: all stored documents cleaned up from disk
- [ ] Purge expired trash: stored documents for purged rows cleaned up
- [ ] Legacy ref backward compat: path-only refs still show exists/broken, Open works, Locate works
- [ ] Migrate legacy refs: Settings "Import Linked Files" copies files and updates DB
- [ ] File size limit: >100MB rejected with clear message
- [ ] File type validation: disallowed extensions rejected
- [ ] Storage stats: Settings shows correct count and size
- [ ] Concurrent access: two quick attaches don't collide (UUID naming)
- [ ] Disk full: graceful error on copy failure

---

## Dependency: Shared with Reference Board

The `file-storage.ts` module is shared infrastructure. **Implement this plan first** (or simultaneously with Reference Board), since both need the same storage functions. The Reference Board plan uses `getReferenceStorageDir()` from this module.

---

## Critical Files

| File | Change |
|-|-|
| `src/main/file-storage.ts` | New: shared storage module |
| `src/main/migrations/027_document_storage.ts` | New: schema migration |
| `src/main/ipc/ipc-tasks.ts` | Modify: 4 handlers + 4 new handlers |
| `src/renderer/components/profile/RelatedDocuments.tsx` | Modify: UI for stored docs |
| `src/shared/types.ts` | Modify: DocumentRef + 3 new fields |
| `src/shared/ipc-channels.ts` | Modify: 4 new channels |
| `src/main/ipc/ipc-row.ts` | Modify: file cleanup on hard delete |
| `src/main/database.ts` | Modify: file cleanup in purgeExpiredTrash |
| `src/renderer/views/SettingsView.tsx` | Modify: storage stats + migrate button |
