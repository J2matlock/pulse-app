/** Attachments (generalization W09): types and limits shared by main and the window. */

export interface Attachment {
  id: number
  row_id: number | null
  case_log_id: number | null
  file_name: string
  mime_type: string
  size_bytes: number
  sha256: string
  description: string | null
  created_at: string
  deleted_at: string | null
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024
export const DEFAULT_LIMIT_MB = 1000
export const LIMIT_MB_RANGE = { min: 100, max: 4000 } as const
/** Images this size or smaller get a thumbnail */
export const PREVIEW_MAX_BYTES = 5 * 1024 * 1024

export const ALLOWED_TYPES_TEXT = 'PDF, pictures (PNG, JPEG, GIF, WebP, HEIC), Word, Excel and PowerPoint files, OpenDocument text and spreadsheets, plain text, CSV and RTF'

export interface AttachmentUsage { count: number; bytes: number; limitBytes: number }

/** "240 KB", "3.1 MB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export const isImage = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime)

/** The "Files" count columns among these (W09 §7) */
export function fileCountColumnIds(columns: Array<{ id: number; column_type: string }>): number[] {
  return columns.filter(c => c.column_type === 'file_count').map(c => Math.trunc(c.id))
}
