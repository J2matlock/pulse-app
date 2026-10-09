/**
 * Report builder (W10 §6.3): pick the list and what to count, narrow it
 * down, group it and choose the values, with a live preview. Then save,
 * export as PDF or CSV, or pin it to the dashboard.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FileDown, Pin, PinOff, Plus, Save, Trash2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import {
  DATE_BUCKETS, FN_LABELS, OPERATOR_LABELS, REPORT_LIMITS, SOURCE_LABELS, operatorsFor,
  type DatePreset, type ReportConfig, type ReportField, type ReportResult, type ReportSource, type SavedReport, type ValueFn,
} from '../../../shared/reports'
import { safeInvoke } from '../../utils/safeInvoke'
import { useGridStore } from '../../stores/gridStore'
import { useFeature } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { loadPinnedReports, setReportPinned } from '../../utils/pinnedReports'
import { ReportTable } from './ReportTable'

export const EMPTY_CONFIG: ReportConfig = { source: 'records', filters: [], groupBy: [], values: [{ fn: 'count' }] }

const PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' }, { value: 'this_year', label: 'This year' }, { value: 'last_year', label: 'Last year' },
]
const BUCKET_LABELS: Record<string, string> = { day: 'by day', week: 'by week', month: 'by month', quarter: 'by quarter', year: 'by year' }

function FieldSelect({ fields, value, onChange, label, allow, placeholder }: {
  fields: ReportField[]; value: string | undefined; onChange: (id: string) => void; label: string
  allow?: (f: ReportField) => boolean; placeholder?: string
}): React.ReactElement {
  const shown = allow ? fields.filter(allow) : fields
  const groups = [...new Set(shown.map(f => f.group))]
  return (
    <select className="input min-w-0" aria-label={label} value={value ?? ''} onChange={e => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {groups.map(g => (
        <optgroup key={g} label={g}>
          {shown.filter(f => f.group === g).map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section aria-labelledby={`report-step-${n}`} className="space-y-2 pb-4 border-b border-slate-200 dark:border-slate-700">
      <h3 id={`report-step-${n}`} className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-sm flex items-center justify-center" aria-hidden="true">{n}</span>{title}
      </h3>
      {children}
    </section>
  )
}

const removeBtn = 'hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500'

export function ReportBuilder({ initial, onSaved, onDeleted }: {
  initial: SavedReport | null
  onSaved: (r: SavedReport) => void
  onDeleted: (id: number) => void
}): React.ReactElement {
  const grids = useGridStore(s => s.grids)
  const activeGridId = useGridStore(s => s.activeGridId)
  const apptsOn = useFeature('appointments')
  const [gridId, setGridId] = useState<number | null>(initial?.grid_id ?? activeGridId ?? grids[0]?.id ?? null)
  const [config, setConfig] = useState<ReportConfig>(initial?.config ?? EMPTY_CONFIG)
  const [name, setName] = useState(initial?.name ?? '')
  const [fields, setFields] = useState<ReportField[]>([])
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  const { t, f } = useVocab(gridId)
  const fieldsKey = useRef('')

  useEffect(() => { if (gridId === null && grids[0]) setGridId(grids[0].id) }, [grids, gridId])
  useEffect(() => { if (initial) void loadPinnedReports().then(ids => setPinned(ids.includes(initial.id))) }, [initial])

  // Fields for this list and source; settings that name fields it doesn't have are dropped
  useEffect(() => {
    if (gridId === null) return
    const key = `${gridId}:${config.source}`
    let alive = true
    void safeInvoke<ReportField[]>(IPC.REPORT_FIELDS, gridId, config.source).then(r => {
      if (!alive || !r.ok) return
      const ids = new Set(r.data.map(x => x.id))
      const kind = new Map(r.data.map(x => [x.id, x.kind]))
      setFields(r.data)
      if (fieldsKey.current && fieldsKey.current !== key) {
        setConfig(c => ({
          ...c,
          filters: c.filters.filter(x => ids.has(x.field)),
          groupBy: c.groupBy.filter(x => ids.has(x.field)),
          values: c.values.filter(v => v.fn === 'count' || (v.field && ['number', 'currency'].includes(kind.get(v.field) ?? ''))),
          columns: c.columns?.filter(x => ids.has(x)),
          dateRange: c.dateRange && ids.has(c.dateRange.field) ? c.dateRange : undefined,
          sort: undefined,
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
        if (r.ok) { setResult(r.data); setError(null) } else { setError(r.error) }
      })
    }, 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [gridId, config, fields])

  const byId = useMemo(() => new Map(fields.map(x => [x.id, x])), [fields])
  const dateFields = (x: ReportField) => x.kind === 'date'
  const numberFields = (x: ReportField) => x.kind === 'number' || x.kind === 'currency'
  const firstOf = (allow?: (x: ReportField) => boolean) => (allow ? fields.find(allow) : fields[0])?.id
  const patch = (p: Partial<ReportConfig>) => setConfig(c => ({ ...c, ...p }))

  const sources: ReportSource[] = ['records', 'activities', ...(apptsOn ? ['appointments' as const] : []), 'deadlines']

  async function save() {
    if (gridId === null) return
    const r = await safeInvoke<SavedReport>(IPC.REPORT_SAVE, { id: initial?.id, name, gridId, config })
    if (r.ok) { toast.success(`Saved "${r.data.name}"`); onSaved(r.data) } else toast.error(r.error)
  }
  async function exportAs(format: 'csv' | 'pdf') {
    if (gridId === null) return
    const r = await safeInvoke<string | null>(IPC.REPORT_EXPORT, gridId, config, format, name || 'Report')
    if (!r.ok) toast.error(r.error)
    else if (r.data) toast.success(format === 'csv' ? 'Saved the CSV' : 'Saved the PDF')
  }
  async function togglePin() {
    if (!initial) return
    const ids = await setReportPinned(initial.id, !pinned)
    setPinned(ids.includes(initial.id))
    toast.success(ids.includes(initial.id) ? 'Pinned to the dashboard' : 'Removed from the dashboard')
  }
  async function remove() {
    if (!initial) return
    const r = await safeInvoke(IPC.REPORT_DELETE, initial.id)
    if (r.ok) { toast.success(`Deleted "${initial.name}"`); onDeleted(initial.id) } else toast.error(r.error)
  }
  function onSort(field: string) {
    patch({ sort: config.sort?.field === field && config.sort.dir === 'asc' ? { field, dir: 'desc' } : { field, dir: 'asc' } })
  }

  const grouped = config.groupBy.length > 0

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-0">
      <div className="lg:w-[440px] flex-shrink-0 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[12rem] text-base text-slate-700 dark:text-slate-200">
            Report name
            <input className="input w-full mt-1" value={name} maxLength={100} placeholder="Jobs per month" onChange={e => setName(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" onClick={() => void save()}><Save className="w-4 h-4" />Save</button>
        </div>

        <Step n={1} title="What to report on">
          <label className="block text-base text-slate-700 dark:text-slate-200">
            {t('list', { cap: true })}
            <select className="input w-full mt-1" value={gridId ?? ''} onChange={e => setGridId(Number(e.target.value))}>
              {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="text-base text-slate-700 dark:text-slate-200 mb-1">Each line counts</legend>
            <div className="grid grid-cols-2 gap-2">
              {sources.map(s => (
                <label key={s} className={`flex items-center gap-2 rounded-lg border-2 px-3 cursor-pointer text-base ${config.source === s ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-700'}`} style={{ minHeight: 44 }}>
                  <input type="radio" name="report-source" className="w-5 h-5" checked={config.source === s} onChange={() => patch({ source: s })} />
                  {f(SOURCE_LABELS[s]).replace(/^./, c => c.toUpperCase())}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
            <input type="checkbox" className="w-5 h-5" checked={config.includeArchived === true} onChange={e => patch({ includeArchived: e.target.checked || undefined })} />
            Include archived {t('record', { many: true })}
          </label>
        </Step>

        <Step n={2} title="Which ones">
          {config.filters.map((flt, i) => {
            const kind = byId.get(flt.field)?.kind ?? 'text'
            const ops = operatorsFor(kind)
            const set = (p: Partial<typeof flt>) => patch({ filters: config.filters.map((x, j) => j === i ? { ...x, ...p } : x) })
            return (
              <div key={i} className="flex flex-wrap items-center gap-1">
                <FieldSelect fields={fields} label={`Filter ${i + 1} field`} value={flt.field} onChange={id => {
                  const k = byId.get(id)?.kind ?? 'text'
                  set({ field: id, operator: operatorsFor(k).includes(flt.operator) ? flt.operator : operatorsFor(k)[0]!, value: '' })
                }} />
                <select className="input" aria-label={`Filter ${i + 1} condition`} value={flt.operator} onChange={e => set({ operator: e.target.value as typeof flt.operator })}>
                  {ops.map(o => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
                </select>
                {flt.operator !== 'is_empty' && flt.operator !== 'is_not_empty' && (
                  <input className="input w-36" aria-label={`Filter ${i + 1} value`} type={kind === 'date' ? 'date' : kind === 'text' ? 'text' : 'number'}
                    value={flt.value} maxLength={500} onChange={e => set({ value: e.target.value })} />
                )}
                <button type="button" aria-label={`Remove filter ${i + 1}`} className={removeBtn} onClick={() => patch({ filters: config.filters.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></button>
              </div>
            )
          })}
          {config.filters.length < REPORT_LIMITS.filters && fields.length > 0 && (
            <button type="button" className="btn-compact-secondary" onClick={() => {
              const id = firstOf()!
              patch({ filters: [...config.filters, { field: id, operator: operatorsFor(byId.get(id)!.kind)[0]!, value: '' }] })
            }}><Plus className="w-4 h-4" />Add a filter</button>
          )}
          {fields.some(dateFields) && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-base text-slate-700 dark:text-slate-200">Dates:</span>
              <FieldSelect fields={fields} label="Date range field" allow={dateFields} placeholder="Any time" value={config.dateRange?.field}
                onChange={id => patch({ dateRange: id ? { ...(config.dateRange ?? { preset: 'this_month' as const }), field: id } : undefined })} />
              {config.dateRange && (
                <select className="input" aria-label="Date range" value={config.dateRange.preset ?? 'custom'}
                  onChange={e => patch({ dateRange: e.target.value === 'custom' ? { field: config.dateRange!.field } : { field: config.dateRange!.field, preset: e.target.value as DatePreset } })}>
                  {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  <option value="custom">Between dates…</option>
                </select>
              )}
              {config.dateRange && !config.dateRange.preset && (
                <>
                  <input type="date" className="input" aria-label="From" value={config.dateRange.from ?? ''} onChange={e => patch({ dateRange: { ...config.dateRange!, from: e.target.value || undefined } })} />
                  <input type="date" className="input" aria-label="To" value={config.dateRange.to ?? ''} onChange={e => patch({ dateRange: { ...config.dateRange!, to: e.target.value || undefined } })} />
                </>
              )}
            </div>
          )}
        </Step>

        <Step n={3} title="Group by (optional)">
          {config.groupBy.map((g, i) => {
            const isDate = byId.get(g.field)?.kind === 'date'
            const set = (p: Partial<typeof g>) => patch({ groupBy: config.groupBy.map((x, j) => j === i ? { ...x, ...p } : x) })
            return (
              <div key={i} className="flex flex-wrap items-center gap-1">
                <FieldSelect fields={fields} label={`Grouping ${i + 1}`} value={g.field}
                  onChange={id => set({ field: id, bucket: byId.get(id)?.kind === 'date' ? 'month' : undefined })} />
                {isDate && (
                  <select className="input" aria-label={`Grouping ${i + 1} period`} value={g.bucket ?? 'day'} onChange={e => set({ bucket: e.target.value as typeof g.bucket })}>
                    {DATE_BUCKETS.map(b => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}
                  </select>
                )}
                <button type="button" aria-label={`Remove grouping ${i + 1}`} className={removeBtn} onClick={() => patch({ groupBy: config.groupBy.filter((_, j) => j !== i), sort: undefined })}><Trash2 className="w-4 h-4" /></button>
              </div>
            )
          })}
          {config.groupBy.length < REPORT_LIMITS.groupBy && fields.length > 0 && (
            <button type="button" className="btn-compact-secondary" onClick={() => {
              const id = firstOf(x => x.group !== fields[fields.length - 1]!.group || x.kind !== 'text') ?? firstOf()!
              patch({ groupBy: [...config.groupBy, { field: id, ...(byId.get(id)?.kind === 'date' ? { bucket: 'month' as const } : {}) }], sort: undefined })
            }}><Plus className="w-4 h-4" />Add a grouping</button>
          )}
          {!grouped && (
            <div className="space-y-1 pt-1">
              <p className="text-base text-slate-700 dark:text-slate-200">Or list each one with these columns:</p>
              <ul className="flex flex-wrap gap-1">
                {(config.columns ?? []).map(id => (
                  <li key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 pl-3 text-base">
                    {byId.get(id)?.label ?? id}
                    <button type="button" aria-label={`Remove column ${byId.get(id)?.label ?? id}`} className={removeBtn} onClick={() => patch({ columns: config.columns!.filter(x => x !== id), sort: undefined })}><Trash2 className="w-4 h-4" /></button>
                  </li>
                ))}
              </ul>
              {(config.columns?.length ?? 0) < REPORT_LIMITS.columns && (
                <FieldSelect fields={fields} label="Add a column" placeholder="Add a column…" value=""
                  allow={x => !(config.columns ?? []).includes(x.id)} onChange={id => { if (id) patch({ columns: [...(config.columns ?? []), id] }) }} />
              )}
            </div>
          )}
        </Step>

        {(grouped || !(config.columns?.length)) && (
          <Step n={4} title="Values">
            {config.values.map((v, i) => {
              const set = (p: Partial<typeof v>) => patch({ values: config.values.map((x, j) => j === i ? { ...x, ...p } : x) })
              return (
                <div key={i} className="flex flex-wrap items-center gap-1">
                  <select className="input" aria-label={`Value ${i + 1}`} value={v.fn} onChange={e => {
                    const fn = e.target.value as ValueFn
                    set(fn === 'count' ? { fn, field: undefined } : { fn, field: v.field ?? firstOf(numberFields) })
                  }}>
                    {(Object.keys(FN_LABELS) as ValueFn[]).filter(fn => fn === 'count' || fields.some(numberFields)).map(fn => <option key={fn} value={fn}>{FN_LABELS[fn]}</option>)}
                  </select>
                  {v.fn !== 'count' && <FieldSelect fields={fields} label={`Value ${i + 1} field`} allow={numberFields} value={v.field} onChange={id => set({ field: id })} />}
                  <input className="input w-36" aria-label={`Value ${i + 1} heading`} placeholder="Heading (optional)" maxLength={60} value={v.label ?? ''} onChange={e => set({ label: e.target.value || undefined })} />
                  <button type="button" aria-label={`Remove value ${i + 1}`} className={removeBtn} onClick={() => patch({ values: config.values.filter((_, j) => j !== i), sort: undefined })}><Trash2 className="w-4 h-4" /></button>
                </div>
              )
            })}
            {config.values.length < REPORT_LIMITS.values && (
              <button type="button" className="btn-compact-secondary" onClick={() => {
                const num = firstOf(numberFields)
                patch({ values: [...config.values, num ? { fn: 'sum', field: num } : { fn: 'count' }] })
              }}><Plus className="w-4 h-4" />Add a value</button>
            )}
          </Step>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => void exportAs('pdf')}><FileDown className="w-4 h-4" />Export PDF</button>
          <button type="button" className="btn-secondary" onClick={() => void exportAs('csv')}><FileDown className="w-4 h-4" />Export CSV</button>
          {initial && (
            <button type="button" className="btn-secondary" aria-pressed={pinned} onClick={() => void togglePin()}>
              {pinned ? <><PinOff className="w-4 h-4" />Unpin from dashboard</> : <><Pin className="w-4 h-4" />Pin to dashboard</>}
            </button>
          )}
          {initial && <button type="button" className="btn-danger" onClick={() => void remove()}><Trash2 className="w-4 h-4" />Delete</button>}
        </div>
      </div>

      <section aria-labelledby="report-preview" className="flex-1 min-w-0 space-y-2">
        <h3 id="report-preview" className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Preview{result ? ` · ${result.matched.toLocaleString('en-US')} matched` : ''}
        </h3>
        {error ? <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>
          : result ? <ReportTable result={result} sort={config.sort} onSort={onSort} caption={name || 'Report preview'} />
          : <p className="text-base text-slate-500 dark:text-slate-400">Working…</p>}
      </section>
    </div>
  )
}
