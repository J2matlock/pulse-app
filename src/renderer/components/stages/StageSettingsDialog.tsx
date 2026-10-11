/**
 * "Use as the stage" / "Stage settings" (W06 §2): the order of the board's
 * columns, their colors, which count as done, and what happens when a
 * record moves into each.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, Columns3, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { Column } from '../../../shared/types'
import { ACTIVITY_COLORS, type ActivityColor } from '../../../shared/activityTypes'
import { columnOptionLabels, stageConfigOf, DEFAULT_HIDE_DONE_DAYS, type StageConfig, type StageOption } from '../../../shared/stages'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypes, ACTIVITY_SWATCH } from '../../hooks/useActivityTypes'
import { useGridStore } from '../../stores/gridStore'
import { DoneChecklistPicker } from '../grid/DoneChecklistPicker'
import { friendlyError } from '../../utils/friendlyError'

const DONE_WORDS = /^(done|closed|complete|completed|finished|picked up|won|lost|cancel+ed)$/i

/** The stage settings to start from: the saved ones, or the column's options in order */
export function initialStageOptions(column: Column): StageOption[] {
  const saved = stageConfigOf(column)
  if (saved) return saved.options
  return columnOptionLabels(column).map(value => (DONE_WORDS.test(value) ? { value, done: true } : { value }))
}

export function StageSettingsDialog({ column, onClose }: { column: Column; onClose: () => void }): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const { t } = useVocab()
  const { active: noteTypes } = useActivityTypes()
  const columns = useGridStore(s => s.columns)
  const hiddenColumns = useGridStore(s => s.hiddenColumns)
  const dateColumns = useMemo(() => [...columns, ...hiddenColumns].filter(c => c.grid_id === column.grid_id && c.column_type === 'date'), [columns, hiddenColumns, column.grid_id])
  const existing = stageConfigOf(column)
  const [options, setOptions] = useState<StageOption[]>(() => initialStageOptions(column))
  // A checkbox and a number of days; unticked means never hide (0), instead of a 0 nobody understands (S-26)
  const [hideOn, setHideOn] = useState((existing?.hideDoneAfterDays ?? DEFAULT_HIDE_DONE_DAYS) > 0)
  const [hideDays, setHideDays] = useState(String((existing?.hideDoneAfterDays || 0) > 0 ? existing!.hideDoneAfterDays : DEFAULT_HIDE_DONE_DAYS))
  const [open, setOpen] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = (i: number, p: Partial<StageOption>) => setOptions(os => os.map((o, j) => j === i ? { ...o, ...p } : o))
  const patchEnter = (i: number, p: NonNullable<StageOption['onEnter']>) => setOptions(os => os.map((o, j) => {
    if (j !== i) return o
    const onEnter = Object.fromEntries(Object.entries({ ...o.onEnter, ...p }).filter(([, v]) => v !== undefined)) as StageOption['onEnter']
    return { ...o, onEnter: onEnter && Object.keys(onEnter).length ? onEnter : undefined }
  }))
  const move = (i: number, by: -1 | 1) => setOptions(os => {
    const j = i + by
    if (j < 0 || j >= os.length) return os
    const next = [...os]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    return next
  })

  async function save(config: StageConfig | null) {
    setSaving(true)
    try {
      const res = await safeInvoke(IPC.STAGE_CONFIG_SAVE, column.id, config)
      if (!res.ok) { toast.error(friendlyError(res.error)); return }
      const gridId = useGridStore.getState().activeGridId
      if (gridId) await useGridStore.getState().loadGrid(gridId)
      toast.success(config ? `"${column.name}" is now the ${t('stage')}` : `"${column.name}" is no longer the ${t('stage')}`)
      onClose()
    } finally { setSaving(false) }
  }

  const days = hideOn ? Math.max(1, Math.min(3650, parseInt(hideDays, 10) || DEFAULT_HIDE_DONE_DAYS)) : 0

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="stage-settings-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="stage-settings-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Columns3 className="w-5 h-5" aria-hidden="true" />{existing ? `${t('stage', { cap: true })} settings: ${column.name}` : `Use "${column.name}" as the ${t('stage')}`}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}
            className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <p className="text-base text-slate-600 dark:text-slate-300">
          The board shows a column for each {t('stage')}, in this order. Pulse keeps a record of every change to "{column.name}" so it can show how long {t('record', { many: true })} spend in each {t('stage')}.
        </p>

        {options.length === 0 ? (
          <p className="text-base text-amber-700 dark:text-amber-400">"{column.name}" has no options yet. Add its options first.</p>
        ) : (
          <ol className="space-y-2" aria-label={t('stage', { many: true, cap: true })}>
            {options.map((o, i) => (
              <li key={o.value} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex">
                    <button type="button" aria-label={`Move ${o.value} earlier`} disabled={i === 0} onClick={() => move(i, -1)}
                      className="hit-44 p-1.5 rounded-sm text-slate-500 disabled:opacity-30 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"><ArrowUp className="w-4 h-4" /></button>
                    <button type="button" aria-label={`Move ${o.value} later`} disabled={i === options.length - 1} onClick={() => move(i, 1)}
                      className="hit-44 p-1.5 rounded-sm text-slate-500 disabled:opacity-30 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"><ArrowDown className="w-4 h-4" /></button>
                  </div>
                  <span className="flex-1 min-w-[8rem] text-base font-medium text-slate-800 dark:text-slate-100">{o.value}</span>
                  {column.column_type === 'dropdown' && (
                    <select className="input w-32" aria-label={`Color for ${o.value}`} value={o.color ?? ''} onChange={e => patch(i, { color: (e.target.value || undefined) as ActivityColor | undefined })}>
                      <option value="">No color</option>
                      {ACTIVITY_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                  {o.color && (ACTIVITY_COLORS as readonly string[]).includes(o.color) && <span className={`w-4 h-4 rounded-full ${ACTIVITY_SWATCH[o.color as ActivityColor]}`} aria-hidden="true" />}
                  <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                    <input type="checkbox" className="w-5 h-5" checked={!!o.done} onChange={e => patch(i, { done: e.target.checked || undefined })} />
                    Counts as done
                  </label>
                  <button type="button" className="btn-compact-secondary" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                    When moved here{o.onEnter ? ` (${Object.keys(o.onEnter).filter(k => k !== 'restamp').length})` : ''}…
                  </button>
                </div>
                {open === i && (
                  <div className="pl-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <span className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Add a checklist</span>
                      <DoneChecklistPicker value={o.onEnter?.checklistTemplateId ?? null} onChange={id => patchEnter(i, { checklistTemplateId: id ?? undefined })} />
                    </div>
                    <div>
                      <label className="block">
                        <span className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Fill in today's date in</span>
                        <select className="input w-full" value={o.onEnter?.stampColumnId ?? ''}
                          onChange={e => patchEnter(i, { stampColumnId: Number(e.target.value) || undefined, ...(Number(e.target.value) ? {} : { restamp: undefined }) })}>
                          <option value="">Nothing</option>
                          {dateColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </label>
                      {o.onEnter?.stampColumnId !== undefined && (
                        <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                          <input type="checkbox" className="w-5 h-5" checked={!!o.onEnter?.restamp} onChange={e => patchEnter(i, { restamp: e.target.checked || undefined })} />
                          Even if it already has a date
                        </label>
                      )}
                    </div>
                    <label className="block">
                      <span className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Log a note</span>
                      <select className="input w-full" value={o.onEnter?.activityTypeKey ?? ''} onChange={e => patchEnter(i, { activityTypeKey: e.target.value || undefined })}>
                        <option value="">No note</option>
                        {noteTypes.map(nt => <option key={nt.key} value={nt.key}>{nt.label}</option>)}
                      </select>
                    </label>
                    <p className="sm:col-span-3 text-sm text-slate-600 dark:text-slate-300">
                      Moving back here again won't add checklist items that are still open, or change a date that's already filled in.
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        <label className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-200">
          <input type="checkbox" className="w-5 h-5" checked={hideOn} onChange={e => setHideOn(e.target.checked)} aria-label={`Hide finished ${t('record', { many: true })} on the board`} />
          Hide finished {t('record', { many: true })} on the board after
          <input type="number" min={1} max={3650} className="input w-24" value={hideDays} disabled={!hideOn} aria-label="Days" onChange={e => setHideDays(e.target.value)} />
          days
        </label>

        <div className="flex flex-wrap justify-between gap-2">
          {existing ? <button type="button" className="btn-secondary" disabled={saving} onClick={() => void save(null)}>Stop using as the {t('stage')}</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" disabled={saving || options.length === 0}
              onClick={() => void save({ options, hideDoneAfterDays: days })}>
              {existing ? 'Save' : `Use as the ${t('stage')}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
