/**
 * Profile "Files" (W09 §7): what's attached to this record, stored inside
 * Pulse. Drop files here or use "Add files…"; open, save a copy, describe
 * or remove them. Pictures show a thumbnail.
 */
import toast from 'react-hot-toast'
import React, { useCallback, useEffect, useState } from 'react'
import { FileText, ImageIcon, Paperclip, Pencil, Trash2, ExternalLink, Download, Check, X } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { formatBytes, isImage, PREVIEW_MAX_BYTES, type Attachment } from '../../../shared/attachments'
import { parseDbTimestamp } from '../../../shared/dates'
import { safeInvoke } from '../../utils/safeInvoke'
import { addDroppedFiles, addFilesWithDialog, deleteAttachment, openAttachment, saveAttachmentCopy } from '../../utils/attachmentActions'
import { useVocab } from '../../hooks/useVocab'

const day = (ts: string) => parseDbTimestamp(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function Thumb({ a }: { a: Attachment }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!isImage(a.mime_type) || a.size_bytes > PREVIEW_MAX_BYTES) return
    let alive = true
    void safeInvoke<{ dataUrl: string } | null>(IPC.ATTACHMENT_PREVIEW, a.id).then(r => { if (alive && r.ok && r.data) setUrl(r.data.dataUrl) })
    return () => { alive = false }
  }, [a.id, a.mime_type, a.size_bytes])
  if (url) return <img src={url} alt="" className="w-12 h-12 object-cover rounded-md border border-slate-200 dark:border-slate-600 flex-shrink-0" />
  const Icon = a.mime_type.startsWith('image/') ? ImageIcon : FileText
  return <span className="w-12 h-12 flex items-center justify-center rounded-md bg-slate-100 dark:bg-slate-700 flex-shrink-0"><Icon className="w-6 h-6 text-slate-500" aria-hidden="true" /></span>
}

export function RecordFiles({ rowId, onCount }: { rowId: number; onCount?: (n: number) => void }): React.ReactElement {
  const { t } = useVocab()
  const [files, setFiles] = useState<Attachment[]>([])
  const [over, setOver] = useState(false)
  const [editing, setEditing] = useState<{ id: number; name: string; description: string } | null>(null)

  const load = useCallback(async () => {
    const r = await safeInvoke<Attachment[]>(IPC.ATTACHMENT_LIST, rowId)
    if (r.ok) setFiles(r.data)
  }, [rowId])
  useEffect(() => { void load() }, [load])
  useEffect(() => { onCount?.(files.length) }, [files.length, onCount])
  useEffect(() => window.api.on(IPC.ATTACHMENTS_CHANGED, (changed: unknown) => { if (changed === null || changed === rowId) void load() }), [load, rowId])

  async function saveEdit() {
    if (!editing) return
    if (!editing.name.trim()) { toast.error('A file needs a name'); return }
    const r = await safeInvoke(IPC.ATTACHMENT_DESCRIBE, editing.id, { fileName: editing.name, description: editing.description })
    if (r.ok) setEditing(null)
    else toast.error('We couldn\'t save that file\'s name and description — try again')
  }

  return (
    <div
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void addDroppedFiles(rowId, e.dataTransfer.files) }}
      className={`space-y-2 rounded-lg ${over ? 'ring-3 ring-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-slate-500 dark:text-slate-400">Kept inside Pulse, encrypted like everything else. Drop files here to add them.</p>
        <button type="button" className="btn-compact-secondary" onClick={() => void addFilesWithDialog(rowId)}><Paperclip className="w-4 h-4" />Add files…</button>
      </div>
      {files.length === 0 ? (
        <p className="text-base text-slate-500 dark:text-slate-400">No files yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700" aria-label="Files">
          {files.map(a => (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <Thumb a={a} />
              {editing?.id === a.id ? (
                <div className="flex-1 min-w-0 space-y-1">
                  <input className="input w-full" aria-label="File name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                  <input className="input w-full" aria-label="Description" placeholder="Description (optional)" value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} />
                  <div className="flex gap-1">
                    <button type="button" className="btn-compact-primary" onClick={() => void saveEdit()}><Check className="w-4 h-4" />Save</button>
                    <button type="button" className="btn-compact-secondary" onClick={() => setEditing(null)}><X className="w-4 h-4" />Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className="flex-1 min-w-0 text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm" onClick={() => void openAttachment(a)} title="Open">
                    <span className="block text-base font-medium text-slate-800 dark:text-slate-100 truncate">{a.file_name}</span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400">
                      {formatBytes(a.size_bytes)} · {day(a.created_at)}{a.case_log_id !== null ? ` · with ${t('activity', { article: true })}` : ''}{a.description ? ` · ${a.description}` : ''}
                    </span>
                  </button>
                  <button type="button" aria-label={`Open ${a.file_name}`} className="hit-44 p-2 rounded-sm text-slate-500 hover:text-blue-700" onClick={() => void openAttachment(a)}><ExternalLink className="w-4 h-4" /></button>
                  <button type="button" aria-label={`Save a copy of ${a.file_name}`} className="hit-44 p-2 rounded-sm text-slate-500 hover:text-blue-700" onClick={() => void saveAttachmentCopy(a)}><Download className="w-4 h-4" /></button>
                  <button type="button" aria-label={`Rename or describe ${a.file_name}`} className="hit-44 p-2 rounded-sm text-slate-500 hover:text-blue-700" onClick={() => setEditing({ id: a.id, name: a.file_name, description: a.description ?? '' })}><Pencil className="w-4 h-4" /></button>
                  <button type="button" aria-label={`Remove ${a.file_name}`} className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600" onClick={() => void deleteAttachment(a)}><Trash2 className="w-4 h-4" /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-slate-500 dark:text-slate-400">Files you open are copied outside Pulse while open; close them when you're done.</p>
    </div>
  )
}
