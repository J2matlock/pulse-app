import React, { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { BUILTIN_NOTE_FORMATS, MAX_CUSTOM_FORMATS, MAX_FORMAT_FIELDS, type NoteFormat } from '../../../shared/noteFormats'

interface Draft { id: string; name: string; fields: string }

/** Create and edit your own note formats (built-in ones are listed for reference). */
export function NoteFormatsDialog({ formats, onClose }: {
  formats: NoteFormat[]
  onClose: (saved?: NoteFormat[]) => void
}): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [drafts, setDrafts] = useState<Draft[]>(() => formats.map(f => ({ id: f.id, name: f.name, fields: f.fields.join('\n') })))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const update = (i: number, patch: Partial<Draft>) => setDrafts(d => d.map((x, j) => j === i ? { ...x, ...patch } : x))

  async function save() {
    const out: NoteFormat[] = []
    for (const d of drafts) {
      const fields = d.fields.split('\n').map(f => f.trim()).filter(Boolean)
      if (!d.name.trim() && fields.length === 0) continue
      if (!d.name.trim()) { setError('Give each format a name.'); return }
      if (fields.length === 0) { setError(`Add at least one section to "${d.name.trim()}".`); return }
      if (fields.length > MAX_FORMAT_FIELDS) { setError(`"${d.name.trim()}" can have up to ${MAX_FORMAT_FIELDS} sections.`); return }
      out.push({ id: d.id, name: d.name.trim(), fields })
    }
    const res = await safeInvoke(IPC.SETTINGS_UPDATE, 'note_formats', JSON.stringify(out))
    if (!res.ok) { setError("We couldn't save your formats. Try again."); return }
    onClose(out)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={() => onClose()}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="note-formats-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 id="note-formats-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1">Note formats</h2>
          <button type="button" onClick={() => onClose()} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-base text-slate-700 dark:text-slate-200">
            Built in: {BUILTIN_NOTE_FORMATS.map(f => `${f.name} (${f.fields.join(', ')})`).join('; ')}.
          </p>
          <p className="text-base text-slate-700 dark:text-slate-200">Your own formats: one section name per line.</p>
          {drafts.map((d, i) => (
            <fieldset key={d.id} className="rounded-lg border border-slate-300 dark:border-slate-600 p-4 space-y-2">
              <legend className="sr-only">Format {i + 1}</legend>
              <div className="flex items-center gap-2">
                <input className="input flex-1" aria-label="Format name" placeholder="e.g. Home visit"
                  value={d.name} onChange={e => update(i, { name: e.target.value })} />
                <button type="button" aria-label={`Delete ${d.name || 'format'}`} onClick={() => setDrafts(ds => ds.filter((_, j) => j !== i))}
                  className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <textarea className="input w-full" rows={4} aria-label="Sections, one per line"
                placeholder={'Observed\nDiscussed\nNext visit'}
                value={d.fields} onChange={e => update(i, { fields: e.target.value })} />
            </fieldset>
          ))}
          {drafts.length < MAX_CUSTOM_FORMATS && (
            <button type="button" className="btn-compact-secondary"
              onClick={() => setDrafts(d => [...d, { id: `custom-${Date.now()}`, name: '', fields: '' }])}>
              <Plus className="w-4 h-4" aria-hidden="true" />New format
            </button>
          )}
          {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button type="button" className="btn-secondary" onClick={() => onClose()}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  )
}
