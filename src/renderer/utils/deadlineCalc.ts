/**
 * deadlineCalc.ts — Pure deadline computation utilities.
 * No side effects, no store access. Can be used on main or renderer.
 */

import type { AlertThreshold, ParsedAlertRule } from '../../shared/types'
import { toRuleInterval, type RuleInterval } from '../../shared/ruleInterval'
import { evaluate, isUsedUp, engineRuleFrom, meterHistoryColumn, referencedColumns, sequenceAnchor, extensionAnchor, matchExtension, applyExtension, ymdToDate, type DeadlineResult } from '../../shared/deadlineEngine'
import { useGridStore } from '../stores/gridStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { localDateString } from '../../shared/dates'

/** A rule's interval, or (older callers) a bare number of days. */
export type IntervalInput = RuleInterval | number | null | undefined

/** Threshold constants for formatCalculatedDays display tiers */
const DAYS_FAR_FUTURE = 30
const DAYS_APPROACHING = 8
const DAYS_IMMINENT = 1
const DAYS_DUE_TODAY = 0
const DAYS_RECENTLY_OVERDUE = -7
const DAYS_OVERDUE = -30

/**
 * Returns the effective deadline Date for a cell value + the rule's interval.
 * No interval: the stored date IS the deadline. Day intervals add calendar days;
 * month/year intervals are calendar-correct (see shared/ruleInterval.ts).
 */
export function computeEffectiveDeadline(dateValue: string, interval: IntervalInput = 0): Date | null {
  const res = evaluateInterval(dateValue, interval)
  return res.due ? ymdToDate(res.due) : null
}

/** The shared engine (W05) for an interval rule, as of today */
function evaluateInterval(dateValue: string, interval: IntervalInput) {
  const iv = typeof interval === 'object' && interval !== null ? interval : toRuleInterval(interval ?? 0)
  return evaluate({ id: 0, kind: 'interval', interval: iv, config: null, condition: null, businessDays: false }, { today: localDateString(), columnDate: dateValue })
}

/**
 * Returns the signed number of days between today and the effective deadline.
 * Positive = future (days remaining). Zero = today. Negative = past (days overdue).
 */
export function computeDaysUntil(dateValue: string, interval: IntervalInput = 0): number | null {
  return evaluateInterval(dateValue, interval).daysUntil
}

/**
 * A rule's deadline for one grid row (W05): the engine with the row's other
 * columns and the workspace's days off. Read at call time, like the words.
 */
export function evaluateRuleForRow(rule: ParsedAlertRule, columnValue: string | null, row: Record<string, unknown>, columnId?: number): DeadlineResult {
  const engineRule = engineRuleFrom(rule)
  const values: Record<number, string | null> = {}
  for (const id of referencedColumns(engineRule)) {
    const v = row[`col_${id}`]
    values[id] = typeof v === 'string' ? v : null
  }
  const cal = useWorkspaceStore.getState().calendar
  const meterCol = meterHistoryColumn(engineRule)
  const context = useGridStore.getState().deadlineContext
  const meterHistory = meterCol ? context?.meter?.[`${String(row.row_id)}:${meterCol}`] : undefined
  const activityCount = columnId !== undefined ? context?.quota?.[`${String(row.row_id)}:${columnId}`] ?? 0 : undefined
  const anchor = sequenceAnchor(engineRule, columnValue, values)
  const progress = columnId !== undefined
    ? (context?.progress?.[`${String(row.row_id)}:${columnId}`] ?? []).filter(p => p.anchor === anchor).map(p => p.step)
    : undefined
  const prevKey = `${String(row.row_id)}:${columnId}`
  const previous = columnId !== undefined && context?.previous && prevKey in context.previous ? { previousDone: context.previous[prevKey] ?? null } : {}
  const finished = columnId !== undefined && context?.finished?.[prevKey] ? { finishedFor: context.finished[prevKey] } : {}
  const res = evaluate(engineRule, {
    today: localDateString(), columnDate: columnValue, values, meterHistory, activityCount, progress, ...previous, ...finished,
    holidays: new Set(cal?.holidays ?? []), weekend: cal?.weekend ?? [0, 6],
  })
  const ext = columnId !== undefined
    ? matchExtension(context?.extensions?.[`${String(row.row_id)}:${columnId}`], extensionAnchor(engineRule, columnValue, values), res.step)
    : undefined
  return ext ? applyExtension(res, ext, localDateString()) : res
}

/** "Deadline: Mar 3, 2026 · 2 days overdue" for any rule's result. */
export function formatResultTooltip(res: DeadlineResult): string {
  if (!res.due || res.daysUntil === null) return ''
  const formatted = ymdToDate(res.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  // Late now, whatever the end date: say so, like the chip ("All 12 used"), not "Due today"
  if (isUsedUp(res)) return `${res.label ?? 'All used'} · ends ${formatted}`
  const d = res.daysUntil
  if (d < 0) return `Deadline: ${formatted} · ${-d} day${d === -1 ? '' : 's'} overdue`
  if (d === 0) return `Deadline: ${formatted} · Due today`
  return `Deadline: ${formatted} · in ${d} day${d === 1 ? '' : 's'}`
}

/**
 * Words next to a date that has a rule (G-09, D-23): when it's due if that
 * isn't the date shown, and how it stands ("due Oct 6 · 4 days late",
 * "in 5 days", "✓ done"). Null when there's nothing to say.
 */
export function deadlineChipText(res: DeadlineResult, storedValue: string | null): string | null {
  if (res.state === 'done') return '✓ done'
  if (res.state === 'paused') return 'paused'
  if (!res.due || res.daysUntil === null) return null
  if (isUsedUp(res)) return res.label ?? 'all used'
  const d = res.daysUntil
  const when = d < 0 ? `${-d} day${d === -1 ? '' : 's'} late` : d === 0 ? 'due today' : `in ${d} day${d === 1 ? '' : 's'}`
  const shown = storedValue ? storedValue.slice(0, 10) : null
  if (shown === res.due) return when
  const due = ymdToDate(res.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d === 0 ? `due today (${due})` : `due ${due} · ${when}`
}

/**
 * Human-readable tooltip for a colored deadline cell.
 * Shows the computed deadline date and how far away it is.
 */
export function formatDeadlineTooltip(dateValue: string, interval: IntervalInput, daysUntil: number): string {
  const deadline = computeEffectiveDeadline(dateValue, interval)
  if (!deadline) return ''
  const formatted = deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (daysUntil < 0) {
    const n = Math.abs(daysUntil)
    return `Deadline: ${formatted} · ${n} day${n === 1 ? '' : 's'} overdue`
  }
  if (daysUntil === 0) return `Deadline: ${formatted} · Due today`
  return `Deadline: ${formatted} · in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`
}

/**
 * Finds the matching threshold for a given daysUntil value.
 * Algorithm: sort thresholds ascending by daysBefore, return the first
 * where daysBefore >= daysUntil. This finds the "most urgent" applicable threshold.
 *
 * Examples with thresholds [-30, 0, 14, 30, 60, 90]:
 *   daysUntil=45 → 60 threshold (yellow)
 *   daysUntil=10 → 14 threshold (red)
 *   daysUntil=0  → 0 threshold (pulse)
 *   daysUntil=-5 → 0 threshold (pulse) — already past due, 0 is still the floor
 *   daysUntil=-40 → -30 threshold (dark-pulse)
 *   daysUntil=100 → undefined (no color — beyond all thresholds)
 */
export function getMatchingThreshold(
  daysUntil: number,
  thresholds: AlertThreshold[]
): AlertThreshold | undefined {
  if (thresholds.length === 0) return undefined
  const sorted = [...thresholds].sort((a, b) => a.daysBefore - b.daysBefore)
  return sorted.find(t => daysUntil <= t.daysBefore)
}

/**
 * Given daysUntil and an alert rule, returns the matching threshold (or null).
 */
export function getAlertThreshold(
  daysUntil: number,
  rule: ParsedAlertRule | undefined
): AlertThreshold | null {
  if (!rule) return null
  return getMatchingThreshold(daysUntil, rule.thresholds) ?? null
}

/**
 * Human-readable display for a calculated_days column.
 * Returns text, colorClass, and optional icon.
 */
export function formatCalculatedDays(daysUntil: number | null): {
  text: string
  colorClass: string
  icon: string | null
} {
  if (daysUntil === null) return { text: '—', colorClass: 'text-slate-300 dark:text-slate-600', icon: null }
  if (daysUntil > DAYS_FAR_FUTURE) return { text: `${daysUntil} days`, colorClass: '', icon: null }
  if (daysUntil >= DAYS_APPROACHING)  return { text: `${daysUntil} days`, colorClass: '', icon: '📅' }
  if (daysUntil >= DAYS_IMMINENT)  return { text: `${daysUntil} days`, colorClass: 'text-orange-700 dark:text-orange-400', icon: '⏰' }
  if (daysUntil === DAYS_DUE_TODAY) return { text: 'Due today', colorClass: 'text-red-600 dark:text-red-400 font-semibold', icon: '⚠️' }
  if (daysUntil >= DAYS_RECENTLY_OVERDUE)  return { text: `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} overdue`, colorClass: 'text-red-600 dark:text-red-400 font-semibold', icon: '⚠️' }
  if (daysUntil >= DAYS_OVERDUE) return { text: `${Math.abs(daysUntil)} days overdue`, colorClass: 'text-red-700 dark:text-red-300 font-bold', icon: '⚠️' }
  return { text: `${Math.abs(daysUntil)} days overdue`, colorClass: 'text-red-800 dark:text-red-200 font-bold', icon: '🔴' }
}

/**
 * Computes age in years from a date-of-birth string.
 * Returns a human-friendly string like "34 yrs".
 */
export function computeAge(dobValue: string): string {
  const dob = new Date(dobValue.includes('T') ? dobValue : `${dobValue}T00:00:00`)
  if (isNaN(dob.getTime())) return '—'
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  if (age < 0) return '—'
  return `${age} yrs`
}

/**
 * Groups deadlines by urgency bucket for display purposes.
 */
export function classifyDeadline(daysUntil: number): 'overdue' | 'today' | 'this-week' | 'this-month' | 'future' {
  if (daysUntil < 0) return 'overdue'
  if (daysUntil === 0) return 'today'
  if (daysUntil <= 7) return 'this-week'
  if (daysUntil <= 30) return 'this-month'
  return 'future'
}
