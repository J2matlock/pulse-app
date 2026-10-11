/**
 * Report builder (W10 §6.3): pick the list and what to count, narrow it
 * down, group it and choose the values. The steps scroll on the left; the
 * name, the actions and a live preview stay in view on the right.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FileDown, Pin, PinOff, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import {
  DATE_BUCKETS, FN_LABELS, OPERATOR_LABELS, REPORT_LIMITS, SOURCE_LABELS, SOURCE_LABELS_ONE, chartableReport, defaultFilterField, defaultGroupField, defaultValueField,
  explainReport, filterNeedsValue, operatorsFor, suggestReportName,
  type DatePreset, type ReportConfig, type ReportField, type ReportResult, type ReportSource, type SavedReport, type ValueFn,
} from '../../../shared/reports'
import { safeInvoke } from '../../utils/safeInvoke'
import { useGridStore } from '../../stores/gridStore'
import { useFeature } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { loadPinnedReports, setReportPinned } from '../../utils/pinnedReports'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ReportTable } from './ReportTable'
import { ReportChart, chartValues } from './ReportChart'
import { friendlyError } from '../../utils/friendlyError'

export const EMPTY_CONFIG: ReportConfig = { source: 'records', filters: [], groupBy: [], values: [{ fn: 'count' }] }

const PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' }, { value: 'this_year', label: 'This year' }, { value: 'last_year', label: 'Last year' },
]
const BUCKET_LABELS: Record<string, string> = { day: 'by day', week: 'by week', month: 'by month', quarter: 'by quarter', year: 'by year' }

function FieldSelect({ fields, value, onChange, label, allow, placeholder, className = '' }: {
  fields: ReportField[]; value: string | undefined; onChange: (id: string) => void; label: string
  allow?: (f: ReportField) => boolean; placeholder?: string; className?: string
}): React.ReactElement {
  const shown = allow ? fields.filter(allow) : fields
  const groups = [...new Set(shown.map(f => f.group))]
  return (
    <select className={`input min-w-0 ${className}`} aria-label={label} value={value ?? ''} onChange={e => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {groups.map(g => (
        <optgroup key={g} label={g}>
          {shown.filter(f => f.group === g).map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section aria-labelledby={`report-step-${n}`} className="space-y-2 pb-4 border-b border-slate-200 dark:border-slate-700">
      <h3 id={`report-step-${n}`} className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-sm flex items-center justify-center" aria-hidden="true">{n}</span>{title}
      </h3>
      {hint && <p className="text-sm text-slate-500 dark:text-slate-400">{hint}</p>}
      {children}
    </section>
  )
}

/** One filter, grouping or value: its controls on a line, the remove button at the end */
function Row({ children, onRemove, removeLabel }: { children: React.ReactNode; onRemove: () => void; removeLabel: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
      <div className="flex-1 min-w-0 flex flex-wrap gap-1 [&>*]:flex-1 [&>*]:min-w-[8rem]">{children}</div>
      <button type="button" aria-label={removeLabel} className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 flex-shrink-0" onClick={onRemove}>
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

interface Preset { key: string; label: string; config: ReportConfig }

/**
 * Unsaved report changes, kept when someone leaves through the sidebar or the
 * command palette. The app's router can't block that navigation (useBlocker
 * needs a data router), so the changes wait here and come back when the
 * report is opened again.
 */
const drafts = new Map<string, { g: number | null; c: ReportConfig; n: string }>()
const forgotten = new Set<string>()
export function reportDraftKey(report: { id: number } | null): string { return report ? `r${report.id}` : 'new' }
/** The person chose "Leave without saving": don't keep these changes */
export function forgetReportDraft(key: string): void { drafts.delete(key); forgotten.add(key) }

export function ReportBuilder({ initial, onSaved, onDeleted, onDirtyChange }: {
  initial: SavedReport | null
  onSaved: (r: SavedReport) => void
  onDeleted: (id: number) => void
  /** Unsaved changes, so the page can ask before they're thrown away */
  onDirtyChange?: (dirty: boolean) => void
}): React.ReactElement {
  const grids = useGridStore(s => s.grids)
  const activeGridId = useGridStore(s => s.activeGridId)
  const apptsOn = useFeature('appointments')
  const draftKey = reportDraftKey(initial)
  const [restored] = useState(() => drafts.get(draftKey) ?? null)
  const [showRestored, setShowRestored] = useState(restored !== null)
  const [gridId, setGridId] = useState<number | null>(restored ? restored.g : initial?.grid_id ?? activeGridId ?? grids[0]?.id ?? null)
  const [config, setConfig] = useState<ReportConfig>(restored?.c ?? initial?.config ?? EMPTY_CONFIG)
  const [name, setName] = useState(restored?.n ?? initial?.name ?? '')
  const [fields, setFields] = useState<ReportField[]>([])
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Which number the bars show, when a report has more than one
  const [chartValue, setChartValue] = useState<string | undefined>(undefined)
  const { t, f } = useVocab(gridId)
  const fieldsKey = useRef('')
  const ids = { list: useId(), name: useId() }
  // What was last saved (or the blank start), to tell when there are unsaved changes
  const [baseline, setBaseline] = useState(() => JSON.stringify({ g: initial?.grid_id ?? activeGridId ?? grids[0]?.id ?? null, c: initial?.config ?? EMPTY_CONFIG, n: initial?.name ?? '' }))
  const dirty = JSON.stringify({ g: gridId, c: config, n: name }) !== baseline
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  // Keep unsaved changes if this builder goes away without a save or a "Leave without saving"
  const latest = useRef({ dirty, g: gridId, c: config, n: name })
  useEffect(() => { latest.current = { dirty, g: gridId, c: config, n: name } })
  useEffect(() => {
    forgotten.delete(draftKey)
    return () => {
      const s = latest.current
      if (s.dirty && !forgotten.has(draftKey)) drafts.set(draftKey, { g: s.g, c: s.c, n: s.n })
      else drafts.delete(draftKey)
      forgotten.delete(draftKey)
    }
  }, [draftKey])
  function discardRestored() {
    const b = JSON.parse(baseline) as { g: number | null; c: ReportConfig; n: string }
    setGridId(b.g); setConfig(b.c); setName(b.n)
    drafts.delete(draftKey)
    setShowRestored(false)
  }

  useEffect(() => {
    if (gridId === null && grids[0]) {
      setGridId(grids[0].id)
      if (!initial) setBaseline(JSON.stringify({ g: grids[0].id, c: EMPTY_CONFIG, n: '' }))
    }
  }, [grids, gridId, initial])
  useEffect(() => { if (initial) void loadPinnedReports().then(ids => setPinned(ids.includes(initial.id))) }, [initial])

  // Fields for this list and source; settings that name fields it doesn't have are dropped
  useEffect(() => {
    if (gridId === null) return
    const key = `${gridId}:${config.source}`
    let alive = true
    void safeInvoke<ReportField[]>(IPC.REPORT_FIELDS, gridId, config.source).then(r => {
      if (!alive || !r.ok) return
      const have = new Set(r.data.map(x => x.id))
      const kind = new Map(r.data.map(x => [x.id, x.kind]))
      setFields(r.data)
      if (fieldsKey.current && fieldsKey.current !== key) {
        setConfig(c => ({
          ...c,
          filters: c.filters.filter(x => have.has(x.field)),
          groupBy: c.groupBy.filter(x => have.has(x.field)),
          values: c.values.filter(v => v.fn === 'count' || (v.field && ['number', 'currency'].includes(kind.get(v.field) ?? ''))),
          columns: c.columns?.filter(x => have.has(x)),
          dateRange: c.dateRange && have.has(c.dateRange.field) ? c.dateRange : undefined,
          // Group and value columns (g0, v1) and listed fields that still exist keep their sort
          sort: c.sort && (have.has(c.sort.field) || /^[gv]\d+$/.test(c.sort.field)) ? c.sort : undefined,
        }))
      }
      fieldsKey.current = key
    })
    return () => { alive = false }
  }, [gridId, config.source])

  // Live preview
  useEffect(() => {
    if (gridId === null || fields.length === 0) return
    let alive = true
    const timer = setTimeout(() => {
      void safeInvoke<ReportResult>(IPC.REPORT_RUN, gridId, config).then(r => {
        if (!alive) return
        if (r.ok) { setResult(r.data); setError(null) } else { setError(friendlyError(r.error, "This report couldn't be shown. Please try again.")) }
      })
    }, 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [gridId, config, fields])

  const byId = useMemo(() => new Map(fields.map(x => [x.id, x])), [fields])
  const dateFields = (x: ReportField) => x.kind === 'date'
  const numberFields = (x: ReportField) => x.kind === 'number' || x.kind === 'currency'
  const patch = (p: Partial<ReportConfig>) => setConfig(c => ({ ...c, ...p }))
  const words = (s: ReportSource) => f(SOURCE_LABELS[s]).replace(/^./, c => c.toUpperCase())
  const suggested = fields.length ? suggestReportName(config, fields, words(config.source)) : ''
  const nameField = fields.find(x => x.hint === 'name')

  const sources: ReportSource[] = ['records', 'activities', ...(apptsOn ? ['appointments' as const] : []), 'deadlines']

  function chooseSource(s: ReportSource) {
    // Listing deadlines or appointments one by one is the usual want: start with useful columns
    const listing = config.groupBy.length === 0 && !config.columns?.length
    const name = nameField ? [nameField.id] : []
    const columns = !listing ? undefined
      : s === 'deadlines' ? [...name, 'dl:rule', 'dl:state', 'dl:due']
      : s === 'appointments' ? ['appt:date', 'appt:title', ...name, 'appt:status'] : undefined
    patch({ source: s, ...(columns ? { columns } : {}) })
  }

  // Ready-made starting points, in this list's words
  const presets = useMemo((): Preset[] => {
    if (!fields.length || config.source !== 'records') return []
    const stage = fields.find(x => x.hint === 'stage') ?? fields.find(x => x.options?.length && x.id.startsWith('col:'))
    const money = fields.find(x => x.kind === 'currency')
    const rec = words('records'), act = words('activities'), appt = words('appointments')
    const out: Preset[] = []
    if (stage) out.push({ key: 'by-stage', label: `How many ${rec.toLowerCase()} by ${stage.label}`, config: { source: 'records', filters: [], groupBy: [{ field: stage.id }], values: [{ fn: 'count' }], about: `How many ${rec.toLowerCase()} are at each ${stage.label.toLowerCase()}.` } })
    if (stage && money) out.push({ key: 'money', label: `Total ${money.label} by ${stage.label}`, config: { source: 'records', filters: [], groupBy: [{ field: stage.id }], values: [{ fn: 'count' }, { fn: 'sum', field: money.id }], about: `What the ${rec.toLowerCase()} at each ${stage.label.toLowerCase()} are worth.` } })
    out.push({ key: 'added', label: `${rec} added per month`, config: { source: 'records', filters: [], groupBy: [{ field: 'rec:created', bucket: 'month' }], values: [{ fn: 'count' }], dateRange: { field: 'rec:created', preset: 'this_year' }, about: `How many new ${rec.toLowerCase()} came in each month this year.` } })
    out.push({ key: 'notes', label: `${act} per month`, config: { source: 'activities', filters: [], groupBy: [{ field: 'act:date', bucket: 'month' }], values: [{ fn: 'count' }], dateRange: { field: 'act:date', preset: 'this_year' }, about: `How busy each month was, by the ${act.toLowerCase()} written.` } })
    out.push({ key: 'notes-by-type', label: `${act} by kind`, config: { source: 'activities', filters: [], groupBy: [{ field: 'act:type' }], values: [{ fn: 'count' }], dateRange: { field: 'act:date', preset: 'this_year' }, about: `What kinds of ${act.toLowerCase()} you write most this year.` } })
    out.push({ key: 'overdue', label: 'Overdue deadlines', config: { source: 'deadlines', filters: [{ field: 'dl:state', operator: 'equals', value: 'Overdue' }], groupBy: [], values: [{ fn: 'count' }], columns: [...(nameField ? [nameField.id] : []), 'dl:rule', 'dl:due', 'dl:overdue'], sort: { field: 'dl:overdue', dir: 'desc' }, about: 'Everything past due, the longest overdue first.' } })
    out.push({ key: 'deadlines-by', label: 'Deadlines by kind and state', config: { source: 'deadlines', filters: [], groupBy: [{ field: 'dl:rule' }, { field: 'dl:state' }], values: [{ fn: 'count' }], about: 'For each kind of deadline, how many are overdue, coming up or on track.' } })
    if (apptsOn) out.push({ key: 'appts', label: `${appt} this month by status`, config: { source: 'appointments', filters: [], groupBy: [{ field: 'appt:status' }], values: [{ fn: 'count' }], dateRange: { field: 'appt:date', preset: 'this_month' }, about: `How many ${appt.toLowerCase()} this month were kept, missed or cancelled.` } })
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps -- words() reads the same vocabulary as f
  }, [fields, config.source, apptsOn, nameField, f])
  const untouched = !initial && JSON.stringify(config) === JSON.stringify(EMPTY_CONFIG)

  async function save(notify = true): Promise<SavedReport | null> {
    if (gridId === null) return null
    const finalName = name.trim() || suggested || 'Report'
    const r = await safeInvoke<SavedReport>(IPC.REPORT_SAVE, { id: initial?.id, name: finalName, gridId, config })
    if (!r.ok) { toast.error(friendlyError(r.error)); return null }
    toast.success(`Saved "${r.data.name}"`)
    setName(r.data.name)
    setBaseline(JSON.stringify({ g: gridId, c: config, n: r.data.name }))
    if (notify) onSaved(r.data)
    return r.data
  }
  async function exportAs(format: 'csv' | 'pdf') {
    if (gridId === null) return
    const r = await safeInvoke<string | null>(IPC.REPORT_EXPORT, gridId, config, format, name.trim() || suggested || 'Report')
    if (!r.ok) toast.error(friendlyError(r.error))
    else if (r.data) toast.success(format === 'csv' ? 'Saved the CSV' : 'Saved the PDF')
  }
  async function togglePin() {
    // Pinning needs a saved report; save it first (with the suggested name if it has none)
    const savedNow = !(initial && !dirty)
    const report = savedNow ? await save(false) : initial
    if (!report) return
    const ids = await setReportPinned(report.id, !pinned)
    if (!ids) { if (savedNow) onSaved(report); return }
    setPinned(ids.includes(report.id))
    toast.success(ids.includes(report.id) ? 'Pinned to the dashboard' : 'Removed from the dashboard')
    // Tell the page about the save only now, so the reopened report sees it pinned
    if (savedNow) onSaved(report)
  }
  async function remove() {
    setConfirmDelete(false)
    if (!initial) return
    const r = await safeInvoke(IPC.REPORT_DELETE, initial.id)
    if (r.ok) { toast.success(`Deleted "${initial.name}"`); onDeleted(initial.id) } else toast.error(friendlyError(r.error))
  }
  function onSort(field: string) {
    patch({ sort: config.sort?.field === field && config.sort.dir === 'asc' ? { field, dir: 'desc' } : { field, dir: 'asc' } })
  }

  const grouped = config.groupBy.length > 0

  return (
    <div className="h-full min-h-0 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden">
      {/* ── Steps ── */}
      <div className="lg:w-[430px] flex-shrink-0 lg:overflow-y-auto p-4 space-y-4 lg:border-r border-slate-200 dark:border-slate-700">
        {showRestored && dirty && (
          <div role="status" className="rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 p-3 space-y-2">
            <p className="text-base text-amber-900 dark:text-amber-100">Your unsaved changes to this report are back. Save them, or throw them away.</p>
            <button type="button" className="btn-compact-secondary" onClick={discardRestored}>Throw away changes</button>
          </div>
        )}
        {untouched && presets.length > 0 && (
          <section aria-labelledby="report-presets" className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 space-y-2">
            <h3 id="report-presets" className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Sparkles className="w-4 h-4" aria-hidden="true" />Start from a common report</h3>
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button key={p.key} type="button" className="btn-compact-secondary" onClick={() => { setConfig(p.config); setName(p.label) }}>{p.label}</button>
              ))}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">Or build your own below. You can change anything afterwards.</p>
          </section>
        )}

        <Step n={1} title="Which list, and what to count">
          <div>
            <label htmlFor={ids.list} className="block text-base text-slate-700 dark:text-slate-200">{t('list', { cap: true })}</label>
            <select id={ids.list} className="input w-full mt-1" value={gridId ?? ''} onChange={e => setGridId(Number(e.target.value))}>
              {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <fieldset>
            <legend className="text-base text-slate-700 dark:text-slate-200 mb-1">What do you want to count?</legend>
            <div className="grid grid-cols-2 gap-2">
              {sources.map(s => (
                <label key={s} className={`flex items-center gap-2 rounded-lg border-2 px-3 cursor-pointer text-base ${config.source === s ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-700'}`} style={{ minHeight: 44 }}>
                  <input type="radio" name="report-source" className="w-5 h-5" checked={config.source === s} onChange={() => chooseSource(s)} />
                  {words(s)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
            <input type="checkbox" className="w-5 h-5" checked={config.includeArchived === true} onChange={e => patch({ includeArchived: e.target.checked || undefined })} />
            Include archived {t('record', { many: true })}
          </label>
        </Step>

        <Step n={2} title="Only some of them? (optional)" hint={config.filters.length === 0 ? 'Leave this alone to count all of them. Add a filter to narrow it down, e.g. only Done.' : undefined}>
          {config.filters.map((flt, i) => {
            const field = byId.get(flt.field)
            const kind = field?.kind ?? 'text'
            const options = field?.options
            const ops = operatorsFor(kind, !!options?.length)
            const set = (p: Partial<typeof flt>) => patch({ filters: config.filters.map((x, j) => j === i ? { ...x, ...p } : x) })
            const waiting = filterNeedsValue(flt.operator) && flt.value.trim() === ''
            return (
              <div key={i} className="space-y-1">
                <Row removeLabel={`Remove filter ${i + 1}`} onRemove={() => patch({ filters: config.filters.filter((_, j) => j !== i) })}>
                  <FieldSelect fields={fields} label={`Filter ${i + 1} field`} value={flt.field} onChange={id => {
                    const nf = byId.get(id)
                    const nops = operatorsFor(nf?.kind ?? 'text', !!nf?.options?.length)
                    set({ field: id, operator: nops.includes(flt.operator) ? flt.operator : nops[0]!, value: '' })
                  }} />
                  <select className="input" aria-label={`Filter ${i + 1} condition`} value={ops.includes(flt.operator) ? flt.operator : ops[0]} onChange={e => set({ operator: e.target.value as typeof flt.operator })}>
                    {ops.map(o => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
                  </select>
                  {filterNeedsValue(flt.operator) && (options?.length ? (
                    <select className="input" aria-label={`Filter ${i + 1} value`} value={flt.value} onChange={e => set({ value: e.target.value })}>
                      <option value="">Choose…</option>
                      {[...options, ...(flt.value && !options.includes(flt.value) ? [flt.value] : [])].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className="input" aria-label={`Filter ${i + 1} value`} type={kind === 'date' ? 'date' : kind === 'text' ? 'text' : 'number'}
                      value={flt.value} maxLength={500} onChange={e => set({ value: e.target.value })} />
                  ))}
                </Row>
                {waiting && <p className="text-sm text-slate-500 dark:text-slate-400 pl-2">Choose a value to use this filter.</p>}
              </div>
            )
          })}
          {config.filters.length < REPORT_LIMITS.filters && fields.length > 0 && (
            <button type="button" className="btn-compact-secondary" onClick={() => {
              const fld = defaultFilterField(fields)!
              patch({ filters: [...config.filters, { field: fld.id, operator: operatorsFor(fld.kind, !!fld.options?.length)[0]!, value: '' }] })
            }}><Plus className="w-4 h-4" />Add a filter</button>
          )}
          {fields.some(dateFields) && (
            <div className="space-y-1 pt-1">
              <p className="text-base text-slate-700 dark:text-slate-200">Dates</p>
              <div className="flex flex-wrap gap-1 [&>*]:flex-1 [&>*]:min-w-[8rem]">
                <FieldSelect fields={fields} label="Date range field" allow={dateFields} placeholder="Any time" value={config.dateRange?.field}
                  onChange={id => patch({ dateRange: id ? { ...(config.dateRange ?? { preset: 'this_month' as const }), field: id } : undefined })} />
                {config.dateRange && (
                  <select className="input" aria-label="Date range" value={config.dateRange.preset ?? 'custom'}
                    onChange={e => patch({ dateRange: e.target.value === 'custom' ? { field: config.dateRange!.field } : { field: config.dateRange!.field, preset: e.target.value as DatePreset } })}>
                    {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    <option value="custom">Between dates…</option>
                  </select>
                )}
              </div>
              {config.dateRange && !config.dateRange.preset && (
                <div className="flex flex-wrap gap-1 [&>*]:flex-1 [&>*]:min-w-[8rem]">
                  <input type="date" className="input" aria-label="From" value={config.dateRange.from ?? ''} onChange={e => patch({ dateRange: { ...config.dateRange!, from: e.target.value || undefined } })} />
                  <input type="date" className="input" aria-label="To" value={config.dateRange.to ?? ''} onChange={e => patch({ dateRange: { ...config.dateRange!, to: e.target.value || undefined } })} />
                </div>
              )}
            </div>
          )}
        </Step>

        <Step n={3} title="Split into lines by… (optional)" hint={grouped ? undefined : 'Without this you get one total. Split it to get one line per stage, per month, per type…'}>
          {config.groupBy.map((g, i) => {
            const isDate = byId.get(g.field)?.kind === 'date'
            const set = (p: Partial<typeof g>) => patch({ groupBy: config.groupBy.map((x, j) => j === i ? { ...x, ...p } : x) })
            return (
              <Row key={i} removeLabel={`Remove grouping ${i + 1}`} onRemove={() => patch({ groupBy: config.groupBy.filter((_, j) => j !== i), sort: undefined })}>
                <FieldSelect fields={fields} label={`Grouping ${i + 1}`} value={g.field}
                  onChange={id => set({ field: id, bucket: byId.get(id)?.kind === 'date' ? 'month' : undefined })} />
                {isDate && (
                  <select className="input" aria-label={`Grouping ${i + 1} period`} value={g.bucket ?? 'day'} onChange={e => set({ bucket: e.target.value as typeof g.bucket })}>
                    {DATE_BUCKETS.map(b => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}
                  </select>
                )}
              </Row>
            )
          })}
          {config.groupBy.length < REPORT_LIMITS.groupBy && fields.length > 0 && (
            <button type="button" className="btn-compact-secondary" onClick={() => {
              const fld = defaultGroupField(fields, config.source, config.groupBy.map(g => g.field))!
              patch({ groupBy: [...config.groupBy, { field: fld.id, ...(fld.kind === 'date' ? { bucket: 'month' as const } : {}) }], columns: undefined, sort: undefined })
            }}><Plus className="w-4 h-4" />Add a grouping</button>
          )}
          {!grouped && (
            <div className="space-y-1 pt-1">
              <p className="text-base text-slate-700 dark:text-slate-200">Or list each one with these columns:</p>
              <ul className="flex flex-wrap gap-1">
                {(config.columns ?? []).map(id => (
                  <li key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 pl-3 text-base">
                    {byId.get(id)?.label ?? id}
                    <button type="button" aria-label={`Remove column ${byId.get(id)?.label ?? id}`} className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500" onClick={() => patch({ columns: config.columns!.filter(x => x !== id), sort: undefined })}><Trash2 className="w-4 h-4" /></button>
                  </li>
                ))}
              </ul>
              {(config.columns?.length ?? 0) < REPORT_LIMITS.columns && (
                <FieldSelect fields={fields} label="Add a column" placeholder="Add a column…" value="" className="w-full"
                  allow={x => !(config.columns ?? []).includes(x.id)} onChange={id => { if (id) patch({ columns: [...(config.columns ?? []), id] }) }} />
              )}
            </div>
          )}
        </Step>

        {(grouped || !(config.columns?.length)) && (
          <Step n={4} title="Show these numbers" hint="How many is a count. Add a total or average of a money or number column.">
            {config.values.map((v, i) => {
              const set = (p: Partial<typeof v>) => patch({ values: config.values.map((x, j) => j === i ? { ...x, ...p } : x) })
              return (
                <div key={i} className="space-y-1">
                  <Row removeLabel={`Remove value ${i + 1}`} onRemove={() => patch({ values: config.values.filter((_, j) => j !== i), sort: undefined })}>
                    <select className="input" aria-label={`Value ${i + 1}`} value={v.fn} onChange={e => {
                      const fn = e.target.value as ValueFn
                      set(fn === 'count' ? { fn, field: undefined } : { fn, field: v.field ?? defaultValueField(fields)?.id })
                    }}>
                      {(Object.keys(FN_LABELS) as ValueFn[]).filter(fn => fn === 'count' || fields.some(numberFields)).map(fn => <option key={fn} value={fn}>{FN_LABELS[fn]}</option>)}
                    </select>
                    {v.fn !== 'count' && <FieldSelect fields={fields} label={`Value ${i + 1} field`} allow={numberFields} value={v.field} onChange={id => set({ field: id })} />}
                  </Row>
                  <input className="input w-full" aria-label={`Value ${i + 1} heading`} placeholder="Column heading (optional)" maxLength={60} value={v.label ?? ''} onChange={e => set({ label: e.target.value || undefined })} />
                </div>
              )
            })}
            {config.values.length < REPORT_LIMITS.values && (
              <button type="button" className="btn-compact-secondary" onClick={() => {
                const num = defaultValueField(fields)
                patch({ values: [...config.values, num ? { fn: 'sum', field: num.id } : { fn: 'count' }] })
              }}><Plus className="w-4 h-4" />Add a value</button>
            )}
          </Step>
        )}
      </div>

      {/* ── Name, actions and preview ── */}
      <section aria-labelledby="report-preview" className="flex-1 min-w-0 lg:overflow-auto p-4 space-y-3">
        <div className="space-y-2 pb-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[14rem]">
              <label htmlFor={ids.name} className="block text-base text-slate-700 dark:text-slate-200">Report name</label>
              <input id={ids.name} className="input w-full mt-1" value={name} maxLength={100} placeholder={suggested || 'Name this report'} onChange={e => setName(e.target.value)} />
            </div>
            <button type="button" className="btn-primary" onClick={() => void save()}><Save className="w-4 h-4" />{initial ? 'Save changes' : 'Save'}</button>
          </div>
          {dirty && initial && <p className="text-sm text-amber-700 dark:text-amber-300" role="status">You have changes that aren't saved yet.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => void exportAs('pdf')}><FileDown className="w-4 h-4" />Export PDF</button>
            <button type="button" className="btn-secondary" onClick={() => void exportAs('csv')}><FileDown className="w-4 h-4" />Export CSV</button>
            <button type="button" className="btn-secondary" aria-pressed={pinned} onClick={() => void togglePin()}>
              {pinned ? <><PinOff className="w-4 h-4" />Unpin from dashboard</> : <><Pin className="w-4 h-4" />Pin to dashboard</>}
            </button>
            {initial && <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 className="w-4 h-4" />Delete</button>}
          </div>
        </div>
        <h3 id="report-preview" className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Preview{result ? ` · ${result.matched.toLocaleString('en-US')} matched` : ''}
        </h3>
        {config.about && <p className="text-base text-slate-700 dark:text-slate-200">{config.about}</p>}
        {fields.length > 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
            {explainReport(config, fields, { one: f(SOURCE_LABELS_ONE[config.source]), many: words(config.source) }, grids.find(g => g.id === gridId)?.name ?? '', result?.matched ?? null)}
          </p>
        )}
        {error ? <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>
          : result ? (
            <div className="space-y-4">
              {chartableReport(config, result) && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  {chartValues(result).length > 1 && (
                    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      Bars show
                      <select className="input w-auto" value={chartValues(result).some(c => c.key === chartValue) ? chartValue : chartValues(result)[0]!.key} onChange={e => setChartValue(e.target.value)}>
                        {chartValues(result).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </label>
                  )}
                  <ReportChart result={result} valueKey={chartValue} />
                </div>
              )}
              <ReportTable result={result} sort={config.sort} onSort={onSort} caption={name || suggested || 'Report preview'} />
            </div>
          )
          : <p className="text-base text-slate-500 dark:text-slate-400">Working…</p>}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${initial?.name ?? ''}"?`}
        message={pinned ? 'The report also comes off the dashboard. This can’t be undone.' : 'This can’t be undone.'}
        confirmLabel="Delete report"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
