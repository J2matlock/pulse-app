/**
 * The form builder (W08 §3): add columns, headings and questions for the
 * note; order them; set labels, help, required and width; name the form
 * and choose whether it logs a note.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Heading, MessageSquarePlus, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { Column } from '../../../shared/types'
import { NOT_FILLABLE, formInputSchema, MAX_FORM_FIELDS, type Form, type FormField } from '../../../shared/forms'
import { safeInvoke } from '../../utils/safeInvoke'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'
import { FieldError, fieldErrorProps } from '../shared/FieldError'

const label = 'block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1'
const small = 'block text-sm text-slate-600 dark:text-slate-300'

/** Each field on the builder gets its own key, so moving one keeps its inputs and focus with it (AUDIT-138) */
let nextFieldKey = 0
type KeyedField = { key: number; f: FormField }
const keyed = (f: FormField): KeyedField => ({ key: ++nextFieldKey, f })

const requiredByColumn = (c: Column) => { try { return (JSON.parse(c.config || '{}') as { required?: boolean }).required === true } catch { return false } }

export function FormBuilder({ gridId, form, onSaved, onCancel }: { gridId: number; form?: Form; onSaved: (f: Form) => void; onCancel: () => void }): React.ReactElement {
  const { t } = useVocab(gridId)
  const { active: noteTypes } = useActivityTypes()
  const [columns, setColumns] = useState<Column[]>([])
  const [name, setName] = useState(form?.name ?? '')
  const [intro, setIntro] = useState(form?.intro ?? '')
  const [logType, setLogType] = useState(form?.log_activity_type ?? '')
  const [items, setItems] = useState<KeyedField[]>(() => (form?.fields ?? []).map(keyed))
  const fields = useMemo(() => items.map(x => x.f), [items])
  const addField = (f: FormField) => setItems(xs => [...xs, keyed(f)])
  // After Move up/down, focus follows the field that moved, not the slot it left
  const pendingFocus = useRef<{ key: number; dir: 'up' | 'down' } | null>(null)
  const [saving, setSaving] = useState(false)
  // A check that failed on save, shown under the box it's about (audit A06-14)
  const [problem, setProblem] = useState<{ key: number | null; text: string } | null>(null)

  useEffect(() => {
    void safeInvoke<{ columns: Column[]; hiddenColumns: Column[] } | null>(IPC.GRID_GET, gridId, false).then(r => {
      if (r.ok && r.data) setColumns([...r.data.columns, ...r.data.hiddenColumns].sort((a, b) => a.position - b.position))
    })
  }, [gridId])

  const colById = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns])
  const onForm = new Set(fields.flatMap(f => (f.kind === 'column' ? [f.columnId] : [])))
  const addable = columns.filter(c => !onForm.has(c.id) && !NOT_FILLABLE.has(c.column_type))
  const full = fields.length >= MAX_FORM_FIELDS

  const patch = (i: number, p: Partial<FormField>) => {
    setProblem(null)
    setItems(xs => xs.map((x, j) => (j === i ? { ...x, f: { ...x.f, ...p } as FormField } : x)))
  }
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= items.length) return
    pendingFocus.current = { key: items[i]!.key, dir: by < 0 ? 'up' : 'down' }
    setItems(xs => {
      const next = [...xs]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }
  useEffect(() => {
    const p = pendingFocus.current
    if (!p) return
    pendingFocus.current = null
    const li = document.querySelector(`[data-field-key="${p.key}"]`)
    const same = li?.querySelector<HTMLButtonElement>(`[data-move="${p.dir}"]`)
    // At the top or bottom now: the other arrow, which still works
    const target = same && !same.disabled ? same : li?.querySelector<HTMLButtonElement>(`[data-move="${p.dir === 'up' ? 'down' : 'up'}"]`)
    target?.focus()
  }, [items])

  async function save() {
    const input = { ...(form ? { id: form.id } : {}), grid_id: gridId, name, intro: intro || null, fields, log_activity_type: logType || null }
    const check = formInputSchema.safeParse(input)
    if (!check.success) {
      const path = check.error.issues[0]?.path ?? []
      const item = path[0] === 'fields' && typeof path[1] === 'number' ? items[path[1]] : undefined
      if (item && item.f.kind !== 'column') {
        const text = item.f.kind === 'section' ? 'Give this heading a title, or remove it.' : 'Type the question, or remove it.'
        setProblem({ key: item.key, text })
        document.getElementById(`form-field-${item.key}-main`)?.focus()
      } else {
        setProblem({ key: null, text: check.error.issues[0]?.message ?? 'Some settings are missing.' })
      }
      return
    }
    setProblem(null)
    setSaving(true)
    try {
      const res = await safeInvoke<Form>(IPC.FORM_SAVE, input)
      if (!res.ok) { toast.error(friendlyError(res.error)); return }
      onSaved(res.data)
    } finally { setSaving(false) }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[14rem_1fr_16rem] gap-4">
      {/* Add */}
      <div className="space-y-2" aria-label="Add to the form" role="group">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Add</h3>
        {addable.map(c => (
          <button key={c.id} type="button" disabled={full} className="w-full text-left flex items-center gap-2 px-2 rounded-lg border border-slate-200 dark:border-slate-600 text-base hover:border-blue-400 disabled:opacity-50"
            style={{ minHeight: 44 }} onClick={() => addField({ kind: 'column', columnId: c.id, ...(requiredByColumn(c) ? { required: true } : {}) })}>
            <Plus className="w-4 h-4 flex-shrink-0" />{c.name}
          </button>
        ))}
        {addable.length === 0 && <p className={small}>Every column is on the form.</p>}
        <button type="button" disabled={full} className="btn-compact-secondary w-full" onClick={() => addField({ kind: 'section', title: 'Section' })}>
          <Heading className="w-4 h-4" />Section heading
        </button>
        <button type="button" disabled={full} className="btn-compact-secondary w-full" onClick={() => addField({ kind: 'note', label: 'Question' })}>
          <MessageSquarePlus className="w-4 h-4" />Question for the {t('activity')}
        </button>
      </div>

      {/* The form */}
      <ol className="space-y-2 min-w-0" aria-label="Fields on the form">
        {fields.length === 0 && <li className="text-base text-slate-500 dark:text-slate-400">Add columns, headings or questions from the left.</li>}
        {items.map(({ key, f }, i) => {
          const c = f.kind === 'column' ? colById.get(f.columnId) : undefined
          const title = f.kind === 'column' ? (c?.name ?? 'Column') : f.kind === 'section' ? 'Section heading' : `Question for the ${t('activity')}`
          return (
            <li key={key} data-field-key={key} className={`rounded-lg border-2 p-2 space-y-2 ${f.kind === 'section' ? 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="flex items-center gap-1">
                <span className="flex-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</span>
                <button type="button" data-move="up" aria-label={`Move ${title} up`} disabled={i === 0} onClick={() => move(i, -1)} className="hit-44 p-1.5 rounded-sm text-slate-500 disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                <button type="button" data-move="down" aria-label={`Move ${title} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)} className="hit-44 p-1.5 rounded-sm text-slate-500 disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                <button type="button" aria-label={`Remove ${title}`} onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
              {f.kind === 'section' ? (
                <>
                  <input id={`form-field-${key}-main`} className="input w-full" aria-label="Heading" value={f.title} onChange={e => patch(i, { title: e.target.value })}
                    {...fieldErrorProps(`form-field-${key}-main`, problem?.key === key && problem.text)} />
                  <FieldError fieldId={`form-field-${key}-main`} error={problem?.key === key && problem.text} />
                  <input className="input w-full" aria-label="Text under the heading" placeholder="Text under the heading (optional)" value={f.text ?? ''} onChange={e => patch(i, { text: e.target.value || undefined })} />
                </>
              ) : (
                <>
                  <input id={`form-field-${key}-main`} className="input w-full" aria-label={`Label for ${title}`} placeholder={c?.name ?? 'Question'} value={f.kind === 'column' ? f.label ?? '' : f.label}
                    onChange={e => patch(i, { label: f.kind === 'note' ? e.target.value : e.target.value || undefined })}
                    {...fieldErrorProps(`form-field-${key}-main`, problem?.key === key && problem.text)} />
                  <FieldError fieldId={`form-field-${key}-main`} error={problem?.key === key && problem.text} />
                  <input className="input w-full" aria-label={`Help for ${title}`} placeholder="Help text (optional)" value={f.help ?? ''} onChange={e => patch(i, { help: e.target.value || undefined })} />
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                      {/* A column the list marks required counts as required unless unticked here,
                          so unticking stores an explicit false (undefined would fall back to the column) */}
                      <input type="checkbox" className="w-5 h-5"
                        checked={f.kind === 'column' ? (f.required ?? (c ? requiredByColumn(c) : false)) : !!f.required}
                        onChange={e => patch(i, { required: f.kind === 'column' ? e.target.checked : e.target.checked || undefined })} />
                      Required
                    </label>
                    {f.kind === 'column' && (
                      <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                        <input type="checkbox" className="w-5 h-5" checked={f.width === 'half'} onChange={e => patch(i, { width: e.target.checked ? 'half' : undefined })} />
                        Half width
                      </label>
                    )}
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ol>

      {/* Settings */}
      <div className="space-y-3">
        <label className="block">
          <span className={label}>Form name</span>
          <input className="input w-full" maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Intake" />
        </label>
        <label className="block">
          <span className={label}>Introduction <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span></span>
          <textarea className="input w-full" rows={3} maxLength={2000} value={intro} onChange={e => setIntro(e.target.value)} placeholder="Shown at the top, and printed" />
        </label>
        <label className="block">
          <span className={label}>Also log {t('activity', { article: true })}</span>
          <select className="input w-full" value={logType} onChange={e => setLogType(e.target.value)}>
            <option value="">No</option>
            {noteTypes.map(nt => <option key={nt.key} value={nt.key}>{nt.label}</option>)}
          </select>
          <span className={small}>With the answers to the questions, and what changed.</span>
        </label>
        {problem && problem.key === null && <p role="alert" className="text-base text-red-700 dark:text-red-400">{problem.text}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={saving || !name.trim() || fields.length === 0} onClick={() => void save()}>Save form</button>
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
