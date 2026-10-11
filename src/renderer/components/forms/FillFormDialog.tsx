/**
 * Filling in a form (W08 §4): large fields with the right input for each
 * column, required ones marked and checked, errors listed at the top. Adds
 * a record, or updates one (prefilled). One undo step puts it back.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPen, Printer, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { Column, GridRow } from '../../../shared/types'
import type { Form, FormChange } from '../../../shared/forms'
import { parseLinkValue, type LinkChip, type LinkedRecord } from '../../../shared/links'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { noteUnencryptedExport } from '../../utils/exportNotice'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useUndoStore } from '../../stores/undoStore'
import { useGridStore } from '../../stores/gridStore'
import { useLinkStore } from '../../stores/linkStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { friendlyError } from '../../utils/friendlyError'
import { tagText } from '../../../shared/tagValue'

type Value = string | number[]

const optionsOf = (c: Column): string[] => {
  try {
    const opts = (JSON.parse(c.config || '{}') as { options?: Array<string | { label?: string }> }).options ?? []
    return opts.map(o => (typeof o === 'string' ? o : o.label ?? '')).filter(Boolean)
  } catch { return [] }
}
const requiredByColumn = (c: Column) => { try { return (JSON.parse(c.config || '{}') as { required?: boolean }).required === true } catch { return false } }

/** Picking linked records on a form; nothing is saved until the form is */
function LinkField({ id, column, value, onChange }: { id: string; column: Column; value: LinkChip[]; onChange: (v: LinkChip[]) => void }): React.ReactElement {
  const cfg = (() => { try { return JSON.parse(column.config || '{}') as { link_type_id?: number; direction?: 'forward' | 'backward' } } catch { return {} } })()
  const type = useLinkStore(s => s.types.find(t => t.id === cfg.link_type_id))
  const loaded = useLinkStore(s => s.isLoaded)
  useEffect(() => { if (!loaded) void useLinkStore.getState().load() }, [loaded])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<LinkedRecord[]>([])
  const single = type ? (cfg.direction === 'backward' ? type.cardinality === 'one_to_one' : type.cardinality !== 'many_to_many') : true
  useEffect(() => {
    if (!cfg.link_type_id || !q.trim()) { setResults([]); return }
    const timer = setTimeout(() => {
      void safeInvoke<LinkedRecord[]>(IPC.RECORD_LINK_SEARCH, cfg.link_type_id, cfg.direction ?? 'forward', q).then(r => setResults(r.ok ? r.data.slice(0, 8) : []))
    }, 150)
    return () => clearTimeout(timer)
  }, [q, cfg.link_type_id, cfg.direction])
  return (
    <div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1 mb-1">
          {value.map(c => (
            <li key={c.rowId} className="flex items-center gap-1 pl-2.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-base text-blue-800 dark:text-blue-200">
              {c.name}
              <button type="button" aria-label={`Remove ${c.name}`} onClick={() => onChange(value.filter(x => x.rowId !== c.rowId))} className="hit-44 p-1.5 rounded-full"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {(!single || value.length === 0) && (
        <input id={id} type="search" className="input w-full" value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" />
      )}
      {results.length > 0 && (
        <ul className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
          {results.filter(r => !value.some(v => v.rowId === r.row_id)).map(r => (
            <li key={r.row_id}>
              <button type="button" className="w-full text-left px-3 text-base hover:bg-slate-50 dark:hover:bg-slate-700" style={{ minHeight: 44 }}
                onClick={() => { onChange(single ? [{ rowId: r.row_id, name: r.display_name }] : [...value, { rowId: r.row_id, name: r.display_name }]); setQ('') }}>
                {r.display_name || '(unnamed)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function FillFormDialog({ form, columns, row, onClose, onDone }: {
  form: Form
  /** The list's columns (visible and hidden) */
  columns: Column[]
  /** Updating this record; otherwise adding one */
  row?: GridRow
  onClose: () => void
  onDone?: (rowId: number) => void
}): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const { t } = useVocab(form.grid_id)
  const colById = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns])
  const [values, setValues] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {}
    for (const f of form.fields) {
      if (f.kind !== 'column' || !row) continue
      const raw = (row[`col_${f.columnId}`] as string | null) ?? ''
      // Tags are stored as a JSON array; the box shows "urgent, spanish"
      out[f.columnId] = colById.get(f.columnId)?.column_type === 'tag' ? tagText(raw) : raw
    }
    return out
  })
  const [links, setLinks] = useState<Record<number, LinkChip[]>>(() => {
    const out: Record<number, LinkChip[]> = {}
    for (const f of form.fields) if (f.kind === 'column' && colById.get(f.columnId)?.column_type === 'link') out[f.columnId] = row ? parseLinkValue(row[`col_${f.columnId}`]) : []
    return out
  })
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)

  // A stray click outside or Escape must not throw away a filled-in form (1.37)
  const [initialAnswers] = useState(() => JSON.stringify([values, links]))
  const changed = JSON.stringify([values, links]) !== initialAnswers || Object.values(notes).some(v => v.trim() !== '')
  const [askDiscard, setAskDiscard] = useState(false)
  const requestClose = () => { if (changed) setAskDiscard(true); else onClose() }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose
  const askDiscardRef = useRef(askDiscard)
  askDiscardRef.current = askDiscard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      // The discard question handles its own Escape ("keep filling in")
      if (!askDiscardRef.current) requestCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function missing(): string[] {
    const out: string[] = []
    form.fields.forEach((f, i) => {
      if (f.kind === 'section') return
      if (f.kind === 'note') { if (f.required && !(notes[i] ?? '').trim()) out.push(f.label); return }
      const c = colById.get(f.columnId)
      if (!c || !(f.required ?? requiredByColumn(c))) return
      const empty = c.column_type === 'link' ? (links[f.columnId] ?? []).length === 0
        : c.column_type === 'checkbox' ? values[f.columnId] !== 'true' : !(values[f.columnId] ?? '').trim()
      if (empty) out.push(f.label || c.name)
    })
    return out
  }

  async function submit() {
    if (await save()) onClose()
  }

  /** Saves the answers; true when they were saved (the dialog stays open). */
  async function save(): Promise<boolean> {
    const m = missing()
    if (m.length) {
      setErrors([`Please fill in: ${m.join(', ')}.`])
      setTimeout(() => errorRef.current?.focus(), 0)
      return false
    }
    const payload: Record<string, Value | null> = {}
    for (const f of form.fields) {
      if (f.kind !== 'column') continue
      const c = colById.get(f.columnId)
      if (!c) continue
      if (c.column_type === 'link') payload[f.columnId] = (links[f.columnId] ?? []).map(x => x.rowId)
      else if (row || (values[f.columnId] ?? '') !== '') payload[f.columnId] = values[f.columnId] ?? ''
    }
    const noteAnswers = Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim()))
    setSaving(true)
    try {
      const res = await safeInvoke<FormChange>(IPC.FORM_SUBMIT, form.id, row?.row_id ?? null, payload, noteAnswers)
      if (!res.ok) { setErrors([res.error]); setTimeout(() => errorRef.current?.focus(), 0); return false }
      let change = res.data
      const refresh = async () => {
        const grid = useGridStore.getState()
        if (grid.activeGridId === form.grid_id) await grid.loadGrid(form.grid_id)
      }
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(), timestamp: Date.now(), category: 'logged', icon: 'clipboard',
        description: change.created ? `Added with "${form.name}"` : `Updated with "${form.name}"`,
        undo: async () => { await mustInvoke(IPC.FORM_UNDO, change); await refresh() },
        redo: async () => {
          // A record this form made comes back from the Trash, with anything added to it since
          if (change.created) {
            const back = await mustInvoke<boolean>(IPC.FORM_REDO, change)
            if (back.data) { await refresh(); return }
          }
          const again = await mustInvoke<FormChange>(IPC.FORM_SUBMIT, form.id, row?.row_id ?? null, payload, noteAnswers)
          if (again.ok) change = again.data
          await refresh()
        },
      })
      await refresh()
      toast.success(change.created ? `Added ${t('record', { article: true })}` : 'Saved')
      onDone?.(change.rowId)
      return true
    } finally { setSaving(false) }
  }

  async function print() {
    // "Print filled" prints the saved answers, so save what's on screen first
    if (row && changed) {
      if (!await save()) return
      onClose()
    }
    const res = await safeInvoke<string | null>(IPC.FORM_PRINT, form.id, row?.row_id ?? null)
    if (!res.ok) { toast.error(friendlyError(res.error)); return }
    if (res.data) { toast.success('Saved the PDF'); noteUnencryptedExport() }
  }

  const input = (id: string, c: Column) => {
    const v = values[c.id] ?? ''
    const set = (nv: string) => setValues(s => ({ ...s, [c.id]: nv }))
    switch (c.column_type) {
      case 'date': return <input id={id} type="date" className="input w-auto" value={v} onChange={e => set(e.target.value)} />
      case 'number': case 'currency': return <input id={id} type="text" inputMode="decimal" className="input w-48" value={v} onChange={e => set(e.target.value)} />
      case 'checkbox': return <input id={id} type="checkbox" className="w-6 h-6" checked={v === 'true' || v === '1'} onChange={e => set(e.target.checked ? 'true' : 'false')} />
      case 'dropdown': case 'status': return (
        <select id={id} className="input w-full" value={v} onChange={e => set(e.target.value)}>
          <option value="">—</option>
          {optionsOf(c).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
      case 'notes': case 'address': return <textarea id={id} className="input w-full" rows={3} value={v} onChange={e => set(e.target.value)} />
      case 'phone': return <input id={id} type="tel" className="input w-full" value={v} onChange={e => set(e.target.value)} />
      case 'email': return <input id={id} type="email" className="input w-full" value={v} onChange={e => set(e.target.value)} />
      case 'url': return <input id={id} type="url" className="input w-full" value={v} onChange={e => set(e.target.value)} />
      case 'tag': return <input id={id} type="text" className="input w-full" value={v} onChange={e => set(e.target.value)} placeholder="Separate tags with commas" />
      case 'link': return <LinkField id={id} column={c} value={links[c.id] ?? []} onChange={nv => setLinks(s => ({ ...s, [c.id]: nv }))} />
      default: return <input id={id} type="text" className="input w-full" value={v} onChange={e => set(e.target.value)} />
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={requestClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="fill-form-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="fill-form-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ClipboardPen className="w-5 h-5" aria-hidden="true" />{form.name}
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-compact-secondary" disabled={saving} onClick={() => void print()} title={row ? (changed ? 'Save your answers, then print them for signing' : 'Print with the saved answers, for signing') : 'A blank to fill on paper'}>
              <Printer className="w-4 h-4" />{row ? (changed ? 'Save and print' : 'Print filled') : 'Print blank'}
            </button>
            <button type="button" aria-label="Close" onClick={requestClose}
              className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
        </div>
        {form.intro && <p className="text-base text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{form.intro}</p>}
        {errors.length > 0 && (
          <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-base text-red-800 dark:text-red-200 focus:outline-hidden focus:ring-3 focus:ring-red-400">
            {errors.map(e => <p key={e}>{e}</p>)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          {form.fields.map((f, i) => {
            if (f.kind === 'section') return (
              <div key={i} className="col-span-2 pt-2 border-t-2 border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{f.title}</h3>
                {f.text && <p className="text-base text-slate-600 dark:text-slate-300">{f.text}</p>}
              </div>
            )
            const id = `form-field-${i}`
            if (f.kind === 'note') return (
              <div key={i} className="col-span-2">
                <label htmlFor={id} className="block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">{f.label}{f.required && <span className="text-red-600" aria-label="required"> *</span>}</label>
                {f.help && <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{f.help}</p>}
                <textarea id={id} className="input w-full" rows={3} value={notes[i] ?? ''} onChange={e => setNotes(s => ({ ...s, [i]: e.target.value }))} />
              </div>
            )
            const c = colById.get(f.columnId)
            if (!c) return null
            const required = f.required ?? requiredByColumn(c)
            return (
              <div key={i} className={f.width === 'half' ? 'col-span-2 sm:col-span-1' : 'col-span-2'}>
                <label htmlFor={id} className="block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">{f.label || c.name}{required && <span className="text-red-600" aria-label="required"> *</span>}</label>
                {f.help && <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{f.help}</p>}
                {input(id, c)}
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={requestClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void submit()}>{row ? 'Save' : `Add ${t('record')}`}</button>
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={askDiscard}
      title="Discard your answers?"
      message="What you've filled in on this form hasn't been saved."
      confirmLabel="Discard answers"
      onConfirm={() => { setAskDiscard(false); onClose() }}
      onCancel={() => setAskDiscard(false)}
    />
    </>
  )
}
