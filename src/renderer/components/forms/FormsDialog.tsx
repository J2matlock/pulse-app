/** A list's forms (W08 §3): make, edit and delete them. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardList, Pencil, Plus, Printer, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { Form } from '../../../shared/forms'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useFormStore } from '../../stores/formStore'
import { deleteWithUndo, onLibraryChanged } from '../../utils/libraryUndo'
import { FormBuilder } from './FormBuilder'
import { friendlyError } from '../../utils/friendlyError'

export function FormsDialog({ gridId, gridName, onClose }: { gridId: number; gridName: string; onClose: () => void }): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [forms, setForms] = useState<Form[]>([])
  const [editing, setEditing] = useState<Form | 'new' | null>(null)

  const load = useCallback(async () => {
    const r = await safeInvoke<Form[]>(IPC.FORM_LIST, gridId)
    if (r.ok) setForms(r.data)
    void useFormStore.getState().load(gridId)
  }, [gridId])
  useEffect(() => { void load() }, [load])
  // An undo or redo of a delete, from the toast or anywhere else
  useEffect(() => onLibraryChanged('form', () => { void load() }), [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editing])

  async function printBlank(f: Form) {
    const r = await safeInvoke<string | null>(IPC.FORM_PRINT, f.id, null)
    if (!r.ok) toast.error(friendlyError(r.error))
    else if (r.data) toast.success('Saved the blank form')
  }

  // Deletes at once with the Undo toast; Undo brings it back under the same id, filled copies untouched (Q4)
  async function remove(f: Form) {
    if (await deleteWithUndo('form', f.id, `"${f.name}"`)) void load()
  }

  return (
    // A stray click outside must not throw away a form being built (its Cancel button is the way out)
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={e => { if (e.target === e.currentTarget && !editing) onClose() }}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="forms-title" onClick={e => e.stopPropagation()}
        className={`w-full ${editing ? 'max-w-6xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4`}>
        <div className="flex items-center justify-between">
          <h2 id="forms-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ClipboardList className="w-5 h-5" aria-hidden="true" />{editing === 'new' ? 'New form' : editing ? `Edit form: ${editing.name}` : `Forms for ${gridName}`}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}
            className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        {editing ? (
          <FormBuilder gridId={gridId} form={editing === 'new' ? undefined : editing}
            onSaved={() => { setEditing(null); void load() }} onCancel={() => setEditing(null)} />
        ) : (
          <>
            {forms.length === 0 && <p className="text-base text-slate-500 dark:text-slate-400">No forms yet. A form is a clean way to add or update one, or a blank to print.</p>}
            <ul className="divide-y divide-slate-100 dark:divide-slate-700" aria-label="Forms">
              {forms.map(f => (
                <li key={f.id} className="flex items-center gap-2 py-2" style={{ minHeight: 44 }}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-base font-medium text-slate-800 dark:text-slate-100 truncate">{f.name}</span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400">
                      {f.fields.filter(x => x.kind !== 'section').length} questions{f.dropped ? ` · ${f.dropped} removed because their column was deleted` : ''}
                    </span>
                  </span>
                  <button type="button" className="btn-compact-secondary" onClick={() => void printBlank(f)}><Printer className="w-4 h-4" />Print blank</button>
                  <button type="button" className="btn-compact-secondary" onClick={() => setEditing(f)}><Pencil className="w-4 h-4" />Edit</button>
                  <button type="button" aria-label={`Delete ${f.name}`} className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600" onClick={() => void remove(f)}><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn-primary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" />New form</button>
          </>
        )}
      </div>
    </div>
  )
}
