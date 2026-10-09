# W09. Attachments

Size: M–L (7 days). Phase: P5. Depends on W01 (feature `attachments`). Decision A4: files are stored inside the encrypted database.

## 1. User stories
1. *As a guardian*, I attach the court order and signed care plan to the ward's record.
2. *As a shop owner*, I attach the photo of the damage and the signed estimate to the job.
3. *As a credential tracker*, I attach the scanned CPR card to the staff member's record or to the note logging the renewal.
4. *As anyone*, attachments are as protected as everything else, and they come with backups and moves.

## 2. Why inside the database
- **Encryption** comes for free (SQLCipher).
- **One file to back up and move** (C4 wizard, `.pulse-backup`).
- **No stray decrypted files on disk** except short-lived temp copies when opening.
- **The previous approach** (`document_refs`, migration 031 removed) linked to files on disk, which left the files unprotected and broke when they moved. This design replaces it.
- **Cost:** a bigger database and slower backups. This is mitigated by limits, a separate blob table, and the UI showing sizes.

## 3. Data (migration 042)
```sql
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER REFERENCES rows(id) ON DELETE CASCADE,
  case_log_id INTEGER REFERENCES case_log(id) ON DELETE SET NULL,   -- attached to a note (still belongs to the row)
  file_name TEXT NOT NULL,                 -- sanitized basename, ≤ 200 chars
  mime_type TEXT NOT NULL,                 -- sniffed from content, not trusted from the extension
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT                          -- soft delete (trash), purged after 30 days like rows
);
CREATE TABLE IF NOT EXISTS attachment_blobs (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_row ON attachments(row_id, deleted_at);
```
Blobs live in their own table so grid, profile and report queries never touch them.

## 4. Limits and types
- **Size:** 15 MB per file; 1 GB total (settings key `attachments_max_mb`, editable 100–4,000).
- **Allowed** (sniffed by magic bytes in main): PDF, PNG, JPEG, GIF, WebP, HEIC (shown as download-only), DOCX/XLSX/PPTX (zip signature + content types check), ODT/ODS, TXT/CSV, RTF.
- **Rejected:** executables, scripts, archives, HTML/SVG (script risk), anything unrecognized. A clear message lists the types that are allowed.
- **Duplicates** (same sha256 on the same record): the user is asked "This file is already attached on Mar 3. Attach again?".

## 5. Main: `src/main/attachments.ts`
```ts
addAttachments(rowId: number, filePaths: string[], opts?: { caseLogId?: number; description?: string }): Attachment[]   // reads via fs in main, assertSafePath, size/type checks, one transaction
listAttachments(rowId: number, opts?: { includeDeleted?: boolean }): Attachment[]
openAttachment(id: number): void              // decrypt to app temp dir → shell.openPath; temp name = random + original extension
saveAttachmentAs(id: number): string | null   // save dialog → write a copy (warns: the copy is not encrypted)
previewAttachment(id: number): { dataUrl: string } | null   // images ≤ 5 MB only; PDFs and documents open in the OS viewer
deleteAttachment(id), restoreAttachment(id), purgeDeletedAttachments(olderThanDays = 30)
usage(): { count: number; bytes: number; limitBytes: number }
```
- **Temp folder:** `<dataDir>/tmp-open/`. It's wiped on lock, quit and startup, and files there are deleted 10 minutes after opening when possible (Windows keeps open files locked; then they're deleted at the next wipe).
- **Note:** "Files you open are copied outside Pulse while open; close them when you're done."

## 6. IPC
`ATTACHMENT_ADD` (rowId, {caseLogId?, description?}): main shows the open dialog itself (multi-select), so the renderer never passes paths. Drag and drop sends the dropped paths through a preload helper; main still validates them with `assertSafePath` and checks they are regular files.

Also: `ATTACHMENT_LIST`, `ATTACHMENT_OPEN`, `ATTACHMENT_SAVE_AS`, `ATTACHMENT_PREVIEW`, `ATTACHMENT_DELETE`, `ATTACHMENT_RESTORE`, `ATTACHMENT_USAGE`.

## 7. Renderer
- **Profile** "Files" section (feature `attachments`): list with icon, name, size, date, description, and the note it came with. Actions: Open, Save a copy, Rename/describe, Delete. Supports a drop zone and "Add files…". Images show thumbnails (`data:` URLs are already allowed by the CSP `img-src 'self' data:`).
- **Note composer:** paperclip button; attachments listed on the entry.
- **Grid:** optional "Files" count column (virtual, computed in the pivot query like link columns: `(SELECT COUNT(*) FROM attachments a WHERE a.row_id = r.id AND a.deleted_at IS NULL)`).
- **Settings → Data:** storage usage bar, limit, "Remove files in the trash now".
- **Trash view:** deleted attachments section.

## 8. Everything else that must know about attachments
| Area | Change |
|-|-|
| Backups (`backup.ts`) | No code change (inside the DB). Show the DB size in Backup settings and the move wizard; warn when a backup will exceed 500 MB |
| Audit trail | "File added: court-order.pdf (240 KB)", "File removed", "File restored" |
| Handoff / record packet | Lists files; option "Include PDFs and images as pages" (images scaled onto pages; PDFs listed only, since jsPDF can't merge PDFs; saved alongside as a ZIP option later) |
| Export all (CSV) | Not included; the export notice says files aren't included |
| Free tier | Not counted |
| Security docs | Update data-flow and temp-file handling in `plans/security-review/*` and the in-app security summary |
| Factory reset | Wipes the tmp-open folder too |
| Database integrity check | `PRAGMA integrity_check` already covers blobs; add a size check to the security checkup ("Files are using 640 MB of 1 GB") |

## 9. Tests
- Type sniffing (spoofed extensions rejected), size limits, the total limit, duplicate detection.
- Add/list/delete/restore/purge.
- Open writes the temp file and the wipe removes it; save-as writes the exact bytes (hash check).
- Backup/restore round trip with attachments; move wizard size display.
- Performance: a DB with 500 MB of blobs opens and loads a 500-row grid in the normal budget.
- Audit entries; handoff packet with images.

## 10. Commits
1. Migration 042 + `attachments.ts` (add/list/delete/usage) + IPC + tests.
2. Open/save-as/temp folder lifecycle + preview.
3. Profile Files section + drop zone + note composer paperclip.
4. Settings usage, trash, grid count column.
5. Audit trail, handoff packet, security docs and checkup.
