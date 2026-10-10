/**
 * A grouped report as horizontal bars: one line per group, bar length is the
 * number. One color (length carries the value), labels and values in text
 * colors, a tooltip per bar. The table below stays the full, accessible view,
 * so the bars are hidden from screen readers.
 */
import React from 'react'
import { formatReportCell, type ReportColumn, type ReportResult } from '../../../shared/reports'

/** The numbers a chart can draw; money first, since a total is usually the point */
export function chartValues(result: ReportResult): ReportColumn[] {
  const nums = result.columns.filter(c => /^v\d+$/.test(c.key) && (c.kind === 'number' || c.kind === 'currency'))
  return [...nums.filter(c => c.kind === 'currency'), ...nums.filter(c => c.kind !== 'currency')]
}

export function ReportChart({ result, valueKey, maxBars }: {
  result: ReportResult
  /** Which value to draw (defaults to the first number) */
  valueKey?: string
  /** Show only the first bars (dashboard cards) */
  maxBars?: number
}): React.ReactElement | null {
  const group = result.columns[0]
  const value = result.columns.find(c => c.key === valueKey) ?? chartValues(result)[0]
  if (!group || !value) return null
  // Months, weeks…: the latest are the ones worth a glance
  const latest = !!group.bucket
  const rows = !maxBars ? result.rows : latest ? result.rows.slice(-maxBars) : result.rows.slice(0, maxBars)
  const hidden = result.rows.length - rows.length
  const nums = rows.map(r => { const v = r[value.key]; return typeof v === 'number' && v > 0 ? v : 0 })
  const max = Math.max(...nums, 0)
  if (max === 0) return null
  return (
    <div aria-hidden="true" className="space-y-[2px]">
      <p className="text-sm text-slate-500 dark:text-slate-400 pb-1">{value.label}</p>
      {rows.map((r, i) => {
        const label = formatReportCell(r[group.key] ?? null, group.kind, group.bucket)
        const shown = formatReportCell(r[value.key] ?? null, value.kind)
        const pct = (nums[i]! / max) * 100
        return (
          <div key={i} className="flex items-center gap-3 rounded-sm hover:bg-slate-50 dark:hover:bg-slate-800/60" title={`${label}: ${shown}`} style={{ minHeight: 30 }}>
            <span className="w-40 flex-shrink-0 truncate text-base text-slate-700 dark:text-slate-200">{label}</span>
            <span className="flex-1 min-w-0 h-5 flex items-center">
              {nums[i]! > 0 && <span className="h-5 rounded-r bg-blue-600 dark:bg-blue-400" style={{ width: `max(${pct}%, 4px)` }} />}
            </span>
            <span className="w-24 flex-shrink-0 text-right tabular-nums text-base text-slate-800 dark:text-slate-100">{shown}</span>
          </div>
        )
      })}
      {hidden > 0 && <p className="text-sm text-slate-500 dark:text-slate-400 pt-1">and {hidden} {latest ? 'earlier' : 'more'}…</p>}
    </div>
  )
}
