/** Files on one note (W09 §7): listed under it, with a paperclip to attach more. */
import React from 'react'
import { Paperclip } from 'lucide-react'
import { formatBytes, type Attachment } from '../../../shared/attachments'
import { addFilesWithDialog, openAttachment } from '../../utils/attachmentActions'

export function NoteFiles({ rowId, noteId, files, canAttach }: { rowId: number; noteId: number; files: Attachment[]; canAttach: boolean }): React.ReactElement | null {
  if (!files.length && !canAttach) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1 pl-1">
      {files.map(f => (
        <button key={f.id} type="button" onClick={() => void openAttachment(f)} title={`Open ${f.file_name}`}
          className="inline-flex items-center gap-1 px-2 rounded-full bg-slate-100 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-200 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 32 }}>
          <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />{f.file_name} <span className="text-slate-500 dark:text-slate-400">({formatBytes(f.size_bytes)})</span>
        </button>
      ))}
      {canAttach && (
        <button type="button" aria-label="Attach a file to this note" title="Attach a file to this note" onClick={() => void addFilesWithDialog(rowId, { caseLogId: noteId })}
          className="hit-44 inline-flex items-center gap-1 px-2 rounded-sm text-sm text-slate-500 hover:text-blue-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
          <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />Attach
        </button>
      )}
    </div>
  )
}
