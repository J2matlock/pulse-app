import React, { useEffect, useRef, useState } from 'react'
import { Copy, Check, FileDown, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { LetterTemplate } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { noteUnencryptedExport } from '../../utils/exportNotice'
import { UnknownPlaceholders, type EmptyProfileField } from '../shared/UnknownPlaceholders'

/**
 * A letter for this record (3.6, R-24): pick a template, adjust the text,
 * then copy it or save it as a PDF. With "Note it in the log" ticked,
 * the first copy or save adds "Letter: <template>" to the record's notes.
 */
export function RecordLetterDialog({ rowId, gridId, clientName, onClose }: {
  rowId: number; gridId: number; clientName: string; onClose: () => void
}): React.ReactElement {
  const { t } = useVocab(gridId)
  const [templates, setTemplates] = useState<LetterTemplate[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const [empty, setEmpty] = useState<EmptyProfileField[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [logIt, setLogIt] = useState(true)
  const loggedRef = useRef(false)
  const { copied, copyToClipboard } = useCopyFeedback()
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    void safeInvoke<LetterTemplate[]>(IPC.LETTER_TEMPLATE_GET_ALL).then(r => {
      if (r.ok) { setTemplates(r.data); if (r.data.length > 0) setSelectedId(r.data[0]!.id) }
    }).finally(() => setLoading(false))
  }, [])

  const template = templates.find(x => x.id === selectedId)

  async function generate() {
    if (!selectedId) return
    setGenerating(true)
    try {
      const res = await safeInvoke<{ text: string; unknown: string[]; empty?: EmptyProfileField[] }>(IPC.LETTER_TEMPLATE_GENERATE, selectedId, rowId, gridId)
      if (res.ok) { setText(res.data.text); setUnknown(res.data.unknown); setEmpty(res.data.empty ?? []) }
      else toast.error('We couldn\'t fill in that letter. Check the template and try again.')
    } finally {
      setGenerating(false)
    }
  }

  /** Once per letter: Pulse's own entry in the notes log that it was sent. Not a user note, so it
   *  neither counts toward requirements nor moves date columns that follow notes. */
  async function noteIt() {
    if (!logIt || loggedRef.current || !template) return
    loggedRef.current = true
    const res = await safeInvoke(IPC.CASE_LOG_CREATE, rowId, `Letter: ${template.name}`, 'system', null)
    if (!res.ok) { loggedRef.current = false; toast.error(`We couldn't note the letter on the ${t('activityLog')}.`) }
  }

  async function copy() {
    if (text === null) return
    await copyToClipboard(text)
    await noteIt()
  }

  async function savePdf() {
    if (text === null) return
    const res = await safeInvoke<string | null>(IPC.LETTER_TEMPLATE_EXPORT_PDF, { text })
    if (!res.ok) { toast.error('We couldn\'t save the letter as a PDF. Please try again.'); return }
    if (res.data) { noteUnencryptedExport(); await noteIt() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="record-letter-title"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h2 id="record-letter-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">Letter for {clientName}</h2>
          <button onClick={onClose} className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <p className="text-base text-slate-500">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="text-base text-slate-600 dark:text-slate-300">There are no letter templates yet. Add one under Letters.</p>
          ) : text === null ? (
            <div>
              <label htmlFor="record-letter-template" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">Template</label>
              <select id="record-letter-template" className="input w-full" style={{ minHeight: 44, fontSize: 15 }}
                value={selectedId ?? ''} onChange={e => setSelectedId(Number(e.target.value))}>
                {templates.map(x => <option key={x.id} value={x.id}>{x.name}{x.is_system ? ' (built-in)' : ''}</option>)}
              </select>
              {template?.description && <p className="mt-2 text-base text-slate-500 dark:text-slate-400">{template.description}</p>}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <label htmlFor="record-letter-text" className="text-base font-medium text-slate-700 dark:text-slate-200">The letter (you can change it here)</label>
                <button onClick={() => setText(null)} className="hit-44 text-base text-blue-600 dark:text-blue-400 hover:underline">Change template</button>
              </div>
              <UnknownPlaceholders unknown={unknown} empty={empty} />
              <textarea id="record-letter-text" value={text} onChange={e => setText(e.target.value)} rows={16}
                className="w-full text-base bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg p-4 resize-y focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                style={{ fontSize: 15 }} />
              <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" className="w-5 h-5" checked={logIt} onChange={e => setLogIt(e.target.checked)} />
                Note it on the {t('activityLog')} when I copy or save it
              </label>
            </>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary" style={{ minHeight: 44 }}>Close</button>
          {text === null ? (
            <button onClick={() => void generate()} disabled={!selectedId || generating} className="btn-primary disabled:opacity-50" style={{ minHeight: 44 }}>
              {generating ? 'Filling in…' : 'Fill in letter'}
            </button>
          ) : (
            <>
              <button onClick={() => void savePdf()} className="btn-secondary" style={{ minHeight: 44 }}><FileDown className="w-4 h-4 inline mr-1" aria-hidden="true" />Save as PDF…</button>
              <button onClick={() => void copy()} className="btn-primary" style={{ minHeight: 44 }}>
                {copied ? <Check className="w-4 h-4 inline mr-1" aria-hidden="true" /> : <Copy className="w-4 h-4 inline mr-1" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
