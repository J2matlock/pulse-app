import React, { useState } from 'react'
import { Calendar } from 'lucide-react'
import type { Column, GridRow, ParsedAlertRule } from '../../../shared/types'
import { computeDaysUntil, computeEffectiveDeadline, getAlertThreshold, evaluateRuleForRow } from '../../utils/deadlineCalc'
import { takesDeadlineRule } from '../../../shared/types'
import { engineRuleFrom, referencedColumns, meterInfo, sequenceAnchor, sequenceStepDue, type DeadlineResult, type SequenceConfig } from '../../../shared/deadlineEngine'
import { useGridStore } from '../../stores/gridStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { completeDeadlines, isOneOffDeadline } from '../../views/dashboard/completeDeadline'
import { OneOffDoneDialog, type OneOffChoice } from '../../views/dashboard/OneOffDoneDialog'
import { ExtendDeadlineDialog } from '../../views/dashboard/ExtendDeadlineDialog'
import { MeterReadingDialog } from '../../views/dashboard/MeterReadingDialog'
import { getClientName } from '../../utils/clientName'
import { safeInvoke } from '../../utils/safeInvoke'
import { IPC } from '../../../shared/ipc-channels'
import { extendDeadline, removeExtension } from '../../views/dashboard/extendDeadline'
import { localDateString } from '../../../shared/dates'
import { hasInterval, toRuleInterval } from '../../../shared/ruleInterval'

/** Maps a bgClass to a solid (full-opacity) hex color for borders / progress bars. */
function solidColor(bgClass: string): string {
  const map: Record<string, string> = {
    'alert-green': '#22c55e',
    'alert-yellow': '#eab308',
    'alert-orange': '#f97316',
    'alert-red': '#ef4444',
    'alert-pulse': '#dc2626',
    'alert-pulse-dark': '#b91c1c',
  }
  if (bgClass in map) return map[bgClass]!
  if (bgClass.startsWith('#')) return bgClass
  return '#94a3b8'
}

/** Maps a bgClass to a semi-transparent background for card tinting. */
function cardBg(bgClass: string): React.CSSProperties {
  const map: Record<string, string> = {
    'alert-green': 'rgba(34,197,94,0.08)',
    'alert-yellow': 'rgba(234,179,8,0.08)',
    'alert-orange': 'rgba(249,115,22,0.10)',
    'alert-red': 'rgba(239,68,68,0.10)',
    'alert-pulse': 'rgba(220,38,38,0.12)',
    'alert-pulse-dark': 'rgba(185,28,28,0.15)',
  }
  if (bgClass in map) return { backgroundColor: map[bgClass] }
  if (bgClass.startsWith('#')) {
    const h = bgClass.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return { backgroundColor: `rgba(${r},${g},${b},0.10)` }
  }
  return {}
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatUrgency(daysUntil: number): string {
  if (daysUntil < 0) {
    const n = Math.abs(daysUntil)
    return `${n} day${n === 1 ? '' : 's'} overdue`
  }
  if (daysUntil === 0) return 'Due today'
  if (daysUntil === 1) return 'Due tomorrow'
  if (daysUntil <= 30) return `Due in ${daysUntil} days`
  const weeks = Math.floor(daysUntil / 7)
  if (daysUntil <= 90) return `Due in ${weeks} week${weeks === 1 ? '' : 's'}`
  const months = Math.floor(daysUntil / 30)
  return `Due in about ${months} month${months === 1 ? '' : 's'}`
}

/**
 * Fraction of cycle elapsed (0–100), used for the progress bar.
 * With interval_days: shows how far through the full cycle we are.
 * With thresholds only: scales against the outermost threshold window.
 */
function computeProgress(daysUntil: number, rule: ParsedAlertRule | undefined, rawValue: string | null): number | null {
  if (!rule) return null
  // Cycle length in days, from the stored date to its due date (handles month/year rules)
  const iv = toRuleInterval(rule)
  if (hasInterval(iv) && rawValue) {
    const start = computeEffectiveDeadline(rawValue, 0)
    const due = computeEffectiveDeadline(rawValue, iv)
    const cycle = start && due ? Math.round((due.getTime() - start.getTime()) / 86_400_000) : 0
    if (cycle > 0) return Math.max(0, Math.min(100, ((cycle - daysUntil) / cycle) * 100))
  }
  // Fall back to outermost threshold as the scale
  const outermost = [...rule.thresholds].sort((a, b) => b.daysBefore - a.daysBefore)[0]?.daysBefore
  if (!outermost || outermost <= 0) return null
  return Math.max(0, Math.min(100, ((outermost - daysUntil) / outermost) * 100))
}

// Date input value (YYYY-MM-DD) from a stored date string
function toInputDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`)
  if (isNaN(d.getTime())) return dateStr
  return localDateString(d)
}

interface DateDeadline {
  col: Column
  rawValue: string | null
  rule: ParsedAlertRule | undefined
  daysUntil: number | null
  bgClass: string | null
  urgencyScore: number  // lower = more urgent; Infinity for empty dates
  /** The engine's result (W05), for kinds that aren't "date + interval" */
  result: DeadlineResult | null
  /** The engine's due date and state, for Done and Extend on every card */
  engine: DeadlineResult | null
}

export interface DeadlinePanelProps {
  row: GridRow
  columns: Column[]
  alertRules: ParsedAlertRule[]
  onDateSave: (columnId: number, value: string | null) => Promise<void>
}

export function DeadlinePanel({
  row,
  columns,
  alertRules,
  onDateSave,
}: DeadlinePanelProps): React.ReactElement | null {
  const [editingColId, setEditingColId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const progressContext = useGridStore(s => s.deadlineContext.progress)
  const extensionsContext = useGridStore(s => s.deadlineContext.extensions)
  const [stepBusy, setStepBusy] = useState(false)
  const [extendingCol, setExtendingCol] = useState<{ col: Column; due: string | null } | null>(null)
  const [doneBusy, setDoneBusy] = useState<number | null>(null)
  const [askReading, setAskReading] = useState<{ col: Column; rawValue: string | null; rule: ParsedAlertRule } | null>(null)
  const [askOneOff, setAskOneOff] = useState<{ col: Column; rawValue: string | null; rule: ParsedAlertRule; due: string | null } | null>(null)
  const refreshContext = () => useGridStore.getState().refreshDeadlineContext()

  const deadlines: DateDeadline[] = columns
    .filter(c => {
      if (!takesDeadlineRule(c.column_type)) return false
      // Only show date columns that have an alert rule configured
      try {
        const cfg = JSON.parse(c.config || '{}') as { alert_rule_id?: number }
        return cfg.alert_rule_id != null
      } catch { return false }
    })
    .map((col): DateDeadline => {
      const rawValue = (row[`col_${col.id}` as `col_${number}`] ?? null) as string | null

      let alertRuleId: number | undefined
      try {
        const cfg = JSON.parse(col.config || '{}') as { alert_rule_id?: number }
        alertRuleId = cfg.alert_rule_id
      } catch { /* malformed config — ignore */ }

      const rule = alertRuleId != null ? alertRules.find(r => r.id === alertRuleId) : undefined

      // Other kinds than "date + interval" (W05) can be due with this cell empty: the engine decides
      if (rule && rule.kind && rule.kind !== 'interval') {
        const result = evaluateRuleForRow(rule, rawValue, row as unknown as Record<string, unknown>, col.id)
        const d = result.daysUntil
        const threshold = d !== null ? getAlertThreshold(d, rule) : null
        return { col, rawValue, rule, daysUntil: d, bgClass: threshold?.bgClass ?? null, urgencyScore: d ?? Infinity, result, engine: result }
      }

      if (!rawValue) {
        return { col, rawValue: null, rule, daysUntil: null, bgClass: null, urgencyScore: Infinity, result: null, engine: null }
      }

      // The engine too, so an extension (W05) moves the date here as everywhere else
      const engineResult = rule ? evaluateRuleForRow(rule, rawValue, row as unknown as Record<string, unknown>, col.id) : null
      const daysUntil = engineResult ? engineResult.daysUntil : computeDaysUntil(rawValue, toRuleInterval(rule))
      // Unparseable date: no color, sort with the empties instead of as "due today"
      if (daysUntil === null) {
        return { col, rawValue, rule, daysUntil: null, bgClass: null, urgencyScore: Infinity, result: null, engine: null }
      }
      const threshold = getAlertThreshold(daysUntil, rule)
      return {
        col,
        rawValue,
        rule,
        daysUntil,
        bgClass: threshold?.bgClass ?? null,
        urgencyScore: daysUntil,
        // Only extended interval deadlines need the engine's text; the rest keep their own display
        result: engineResult?.extended ? engineResult : null,
        engine: engineResult,
      }
    })
    .sort((a, b) => a.urgencyScore - b.urgencyScore)

  if (deadlines.length === 0) return null

  /** Steps of a sequence rule with ✓ for the ones done for the current anchor date */
  function stepsFor(rule: ParsedAlertRule, col: Column, rawValue: string | null): Array<{ label: string; due: string; done: boolean; index: number }> {
    const engineRule = engineRuleFrom(rule)
    if (engineRule.kind !== 'sequence' || !engineRule.config) return []
    const cfg = engineRule.config as SequenceConfig
    const values: Record<number, string | null> = {}
    if (cfg.anchorColumnId !== 'self') values[cfg.anchorColumnId] = (row[`col_${cfg.anchorColumnId}` as `col_${number}`] ?? null) as string | null
    const anchor = sequenceAnchor(engineRule, rawValue, values)
    if (!anchor) return []
    const done = new Set((progressContext[`${row.row_id}:${col.id}`] ?? []).filter(p => p.anchor === anchor).map(p => p.step))
    const cal = useWorkspaceStore.getState().calendar
    return cfg.steps.map((st, i) => ({
      label: st.label, index: i, done: done.has(i),
      due: sequenceStepDue(cfg, anchor, i, { holidays: new Set(cal?.holidays ?? []), weekend: cal?.weekend ?? [0, 6] })?.due ?? '',
    }))
  }

  async function markStep(col: Column, rawValue: string | null, step: number) {
    setStepBusy(true)
    try {
      await completeDeadlines([{ rowId: row.row_id, columnId: col.id, columnName: col.name, clientName: '', dateValue: rawValue ?? '', ruleKind: 'sequence', step }],
        { onUndone: () => useGridStore.getState().refreshDeadlineContext() })
      await useGridStore.getState().refreshDeadlineContext()
    } finally {
      setStepBusy(false)
    }
  }

  /** Read the record back after Done (or its undo), so this page shows the new date */
  async function refreshRow() {
    const gridId = useGridStore.getState().activeGridId
    if (gridId) {
      const res = await safeInvoke<GridRow>(IPC.ROW_GET, gridId, row.row_id)
      if (res.ok && res.data) useGridStore.setState(s => ({ rows: s.rows.map(r => r.row_id === row.row_id ? { ...r, ...res.data } : r) }))
    }
    await useGridStore.getState().refreshDeadlineContext()
  }

  /** Done, the same as on the dashboard: a repeating date starts its next cycle, a one-off is renewed or finished (R-04, D-22) */
  async function markDone(col: Column, rawValue: string | null, rule: ParsedAlertRule, reading?: number, oneOff?: OneOffChoice) {
    setDoneBusy(col.id)
    try {
      let checklistTemplateId: number | null = null
      try { checklistTemplateId = (JSON.parse(col.config || '{}') as { done_checklist_id?: number }).done_checklist_id ?? null } catch { /* none */ }
      const done = await completeDeadlines([{
        rowId: row.row_id, columnId: col.id, columnName: col.name, clientName: getClientName(row, columns),
        dateValue: rawValue ?? '', interval: toRuleInterval(rule), checklistTemplateId, ruleKind: rule.kind ?? 'interval', reading, oneOff,
      }], { onUndone: refreshRow })
      if (done.length > 0) await refreshRow()
    } finally {
      setDoneBusy(null)
    }
  }

  function startEdit(col: Column, currentValue: string | null) {
    setEditingColId(col.id)
    setEditValue(toInputDate(currentValue))
  }

  async function commitEdit() {
    if (editingColId == null || isSaving) return
    setIsSaving(true)
    try {
      await onDateSave(editingColId, editValue || null)
    } finally {
      setIsSaving(false)
      setEditingColId(null)
    }
  }

  function cancelEdit() {
    setEditingColId(null)
    setEditValue('')
  }

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
      <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        Deadlines
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {deadlines.map(({ col, rawValue, rule, daysUntil, bgClass, result, engine }) => {
          const isEditing = editingColId === col.id
          const accentColor = bgClass ? solidColor(bgClass) : '#94a3b8'
          const bgStyle = bgClass ? cardBg(bgClass) : {}
          const progress = daysUntil !== null ? computeProgress(daysUntil, rule, rawValue) : null
          // Urgency text uses fixed high-contrast colors; the rule's accent color
          // (often yellow) stays on the border and progress bar, where it's legible.
          const urgencyClass =
            daysUntil !== null && daysUntil <= 0 ? 'text-red-700 dark:text-red-300'
              : 'text-slate-700 dark:text-slate-200'
          const interval = toRuleInterval(rule)
          const nextDue = rawValue && hasInterval(interval) ? computeEffectiveDeadline(rawValue, interval) : null
          // The stored date is when it was last done for repeating and worked-out rules; for a plain date it's the due date (R-23)
          const storedIsLastDone = !!rule && ((rule.kind ?? 'interval') !== 'interval' || hasInterval(interval))
          const kind = rule?.kind ?? 'interval'
          const canMarkDone = !!rule && kind !== 'quota' && kind !== 'sequence' && !!engine?.due && engine.state !== 'done' && engine.state !== 'paused'

          return (
            <div
              key={col.id}
              className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
              style={{ ...bgStyle, borderLeft: `4px solid ${accentColor}` }}
            >
              <div className="p-3">
                {/* Column name */}
                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">
                  {col.name}
                </div>

                {result && (
                  <div className="mb-1" style={{ fontSize: 15 }}>
                    <div className={`font-medium ${urgencyClass}`}>
                      {result.state === 'done' ? 'Done' : result.state === 'paused' ? 'Paused' : result.due && daysUntil !== null ? formatUrgency(daysUntil) : 'Nothing due yet'}
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-300">{result.detail || (rule?.kind === 'quota' ? 'Enter the start, end and how many are allowed' : '')}</div>
                    {result.extended && (() => {
                      const ext = (extensionsContext[`${row.row_id}:${col.id}`] ?? [])[0]
                      return ext ? (
                        <button type="button" onClick={() => void removeExtension(ext.id, col.name, refreshContext)}
                          className="hit-44 mt-1 text-sm text-blue-700 dark:text-blue-300 underline">Remove extension</button>
                      ) : null
                    })()}
                    {rule && stepsFor(rule, col, rawValue).length > 0 && (
                      <ol className="mt-2 space-y-1" aria-label={`Steps for ${col.name}`}>
                        {stepsFor(rule, col, rawValue).map(st => (
                          <li key={st.index} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                            <span aria-hidden="true" className={st.done ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}>{st.done ? '✓' : '○'}</span>
                            <span className={st.done ? 'line-through text-slate-500 dark:text-slate-400' : ''}>{st.label}</span>
                            {st.due && <span className="text-slate-500 dark:text-slate-400">· {formatDate(st.due)}</span>}
                            <span className="sr-only">{st.done ? '(done)' : '(not done)'}</span>
                            {!st.done && result.step === st.index && (
                              <button type="button" disabled={stepBusy} onClick={() => void markStep(col, rawValue, st.index)}
                                className="hit-44 ml-auto px-2 py-0.5 rounded-sm bg-green-100 hover:bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-200 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-green-500">
                                Mark done
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                {col.column_type === 'deadline' ? null : isEditing ? (
                  /* ── Edit mode ── */
                  <div
                    className="flex items-center gap-2 flex-wrap"
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="date"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void commitEdit()
                        if (e.key === 'Escape') cancelEdit()
                      }}
                      onBlur={() => {
                        // Short delay so clicking Save doesn't trigger a race
                        setTimeout(() => {
                          if (editingColId === col.id) void commitEdit()
                        }, 150)
                      }}
                      autoFocus
                      disabled={isSaving}
                      className="text-sm border border-blue-400 rounded-sm px-2 py-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                      style={{ fontSize: 15 }}
                    />
                    <button
                      onMouseDown={e => e.preventDefault()} // prevent onBlur from firing first
                      onClick={() => void commitEdit()}
                      disabled={isSaving}
                      className="hit-44 px-2 py-1 text-base bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                      style={{ minHeight: 32, fontSize: 15 }}
                    >
                      {isSaving ? '…' : 'Save'}
                    </button>
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={cancelEdit}
                      className="hit-44 px-2 py-1 text-base text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                      style={{ minHeight: 32, fontSize: 15 }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : rawValue ? (
                  /* ── Display mode (has value) ── */
                  <button
                    onClick={() => startEdit(col, rawValue)}
                    className="hit-44 w-full text-left group focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                    title="Click to edit date"
                  >
                    <div
                      className="font-medium text-slate-900 dark:text-slate-100 group-hover:underline decoration-dotted"
                      style={{ fontSize: 15 }}
                    >
                      {storedIsLastDone ? `Last done ${formatDate(rawValue)}` : formatDate(rawValue)}
                    </div>
                    {daysUntil !== null && !result && (
                      <div className={`mt-0.5 font-medium ${urgencyClass}`} style={{ fontSize: 15 }}>
                        {nextDue
                          ? `Next due ${nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatUrgency(daysUntil).replace(/^Due /, '')}`
                          : formatUrgency(daysUntil)}
                      </div>
                    )}
                  </button>
                ) : (
                  /* ── Display mode (no value) ── */
                  <button
                    onClick={() => startEdit(col, null)}
                    className="hit-44 text-left text-slate-500 dark:text-slate-400 italic hover:text-slate-600 dark:hover:text-slate-400 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                    style={{ fontSize: 15 }}
                  >
                    No date set — click to add
                  </button>
                )}

                {!isEditing && (canMarkDone || (rule && daysUntil !== null && !result?.extended)) && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {canMarkDone && (
                      <button type="button" disabled={doneBusy === col.id}
                        onClick={() => {
                          if (kind === 'meter') setAskReading({ col, rawValue, rule: rule! })
                          else if (isOneOffDeadline({ ruleKind: kind, interval })) setAskOneOff({ col, rawValue, rule: rule!, due: engine?.due ?? null })
                          else void markDone(col, rawValue, rule!)
                        }}
                        title={kind === 'meter' ? 'Mark done: asks for the current reading'
                          : kind !== 'interval' || hasInterval(interval) ? 'Mark done: records today as the day it was done'
                          : 'Mark done: asks whether it was renewed (a new date) or finished'}
                        className="hit-44 px-3 py-1 rounded-lg bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-800 dark:text-green-200 text-base font-medium focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-green-500 disabled:opacity-50"
                        style={{ minHeight: 36 }}>
                        Done
                      </button>
                    )}
                    {rule && daysUntil !== null && !result?.extended && (
                      <button type="button" onClick={() => setExtendingCol({ col, due: engine?.due ?? null })}
                        className="hit-44 text-sm text-blue-700 dark:text-blue-300 underline">Extend…</button>
                    )}
                  </div>
                )}

                {/* Progress bar (only when we have a value and a rule) */}
                {progress !== null && !isEditing && (
                  <div className="mt-2 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${progress}%`, backgroundColor: accentColor }}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {extendingCol && (
        <ExtendDeadlineDialog title={extendingCol.col.name} currentDue={extendingCol.due} onClose={() => setExtendingCol(null)}
          onSave={(newDue, reason) => {
            const target = extendingCol.col
            setExtendingCol(null)
            void extendDeadline(row.row_id, target.id, target.name, newDue, reason, refreshContext)
          }} />
      )}
      {askOneOff && (
        <OneOffDoneDialog title={askOneOff.col.name} currentDue={askOneOff.due} onClose={() => setAskOneOff(null)}
          onSave={choice => { const a = askOneOff; setAskOneOff(null); void markDone(a.col, a.rawValue, a.rule, undefined, choice) }} />
      )}
      {askReading && (
        <MeterReadingDialog title={askReading.col.name} onClose={() => setAskReading(null)}
          info={(() => {
            const r = engineRuleFrom(askReading.rule)
            const values: Record<number, string | null> = {}
            for (const id of referencedColumns(r)) values[id] = (row[`col_${id}` as `col_${number}`] ?? null) as string | null
            return meterInfo(r, values)
          })()}
          onSave={reading => { const a = askReading; setAskReading(null); void markDone(a.col, a.rawValue, a.rule, reading) }} />
      )}
    </section>
  )
}
