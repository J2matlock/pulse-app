import React from 'react'
import type { Column, GridRow } from '../../../shared/types'
import { computeDaysUntil, computeAge, formatCalculatedDays, evaluateRuleForRow } from '../../utils/deadlineCalc'
import { useAlertStore } from '../../stores/alertStore'
import { useGridStore } from '../../stores/gridStore'
import { formatDue, isUsedUp } from '../../../shared/deadlineEngine'
import { canBeRequired, isMissingValue } from '../../../shared/requiredFields'
import { LinkCell } from './LinkCell'
import { pulseEvents } from '../../events'

export interface CellDisplayProps {
  column: Column
  value: string | null
  row?: GridRow
  allColumns?: Column[]
  parsedConfig?: Record<string, unknown>
  highlightText?: string
  isActiveMatch?: boolean
}

/** Escape special regex characters so user input is matched literally. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Split text by search term and wrap matches in <mark> tags. */
function renderWithHighlight(text: string, highlight: string, isActiveMatch?: boolean): React.ReactNode {
  if (!highlight) return text
  const escaped = escapeRegex(highlight)
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text // no match
  return parts.map((part, i) => {
    regex.lastIndex = 0
    return regex.test(part)
      ? <mark key={i} className={`search-mark${isActiveMatch ? ' search-mark-current' : ''}`}>{part}</mark>
      : part
  })
}

export const CellDisplay = React.memo(function CellDisplay({ column, value, row, allColumns: _allColumns, parsedConfig, highlightText, isActiveMatch }: CellDisplayProps): React.ReactElement {
  // Helper: apply highlight to a text string if highlightText is set
  const hl = (text: string): React.ReactNode => highlightText ? renderWithHighlight(text, highlightText, isActiveMatch) : text
  if (parsedConfig?.required && canBeRequired(column.column_type) && isMissingValue(value)) {
    return <span className="italic text-amber-800 dark:text-amber-300">Missing</span>
  }
  switch (column.column_type) {

    case 'checkbox': {
      const isChecked = value === 'true' || value === '1'
      return (
        <div className="flex items-center">
          <div className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center ${
            isChecked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-600'
          }`}>
            {isChecked && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>
      )
    }

    case 'date':
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return <span className="tabular-nums">{formatDate(value)}</span>

    case 'number':
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return <span className="tabular-nums">{hl(value)}</span>

    case 'deadline':
      return <DeadlineCell column={column} value={value} row={row} parsedConfig={parsedConfig} />

    case 'link':
      return <LinkCell column={column} value={value} parsedConfig={parsedConfig} />

    case 'file_count': {
      const n = Number(value) || 0
      if (n === 0) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return <span className="tabular-nums">{n} file{n === 1 ? '' : 's'}</span>
    }

    case 'age_from_dob': {
      // Read-only computed: derive age from source date column
      let sourceValue: string | null = null
      const ageCfg = parsedConfig as { source_column_id?: number } | undefined
      if (ageCfg?.source_column_id && row) {
        sourceValue = row[`col_${ageCfg.source_column_id}` as keyof GridRow] as string | null
      }
      if (!sourceValue) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return <span className="tabular-nums text-slate-500 dark:text-slate-400 italic">{computeAge(sourceValue)}</span>
    }

    case 'calculated_days': {
      // Read-only computed: days until/since source date column
      let sourceValue: string | null = null
      const daysCfg = parsedConfig as { source_column_id?: number; label?: string } | undefined
      const label = daysCfg?.label ?? 'days until'
      if (daysCfg?.source_column_id && row) {
        sourceValue = row[`col_${daysCfg.source_column_id}` as keyof GridRow] as string | null
      }
      if (!sourceValue) return <span className="text-slate-300 dark:text-slate-500">—</span>
      const days = computeDaysUntil(sourceValue)
      const { text, colorClass, icon } = formatCalculatedDays(days)
      return (
        <span className={`tabular-nums ${colorClass}`} title={label}>
          {icon && <span className="mr-1">{icon}</span>}
          {text}
        </span>
      )
    }

    case 'phone': {
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      const digits = value.replace(/\D/g, '')
      const formatted = digits.length === 10
        ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
        : value
      return <span className="tabular-nums">{hl(formatted)}</span>
    }

    case 'email':
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return <span className="truncate text-blue-600 dark:text-blue-400" title={value}>{hl(value)}</span>

    case 'url':
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return (
        <span className="truncate text-blue-600 dark:text-blue-400 underline" title={value}>
          {hl(value.replace(/^https?:\/\//, ''))}
        </span>
      )

    case 'notes':
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return (
        <span className="truncate text-slate-500 dark:text-slate-400 italic" title={value}>
          {hl(value.length > 60 ? value.slice(0, 60) + '\u2026' : value)}
        </span>
      )

    case 'currency': {
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      const num = parseFloat(value)
      if (!Number.isFinite(num)) return <span className="truncate">{value}</span>
      return (
        <span className="tabular-nums">
          {num.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </span>
      )
    }

    case 'address':
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return <span className="truncate" title={value}>{hl(value.split('\n')[0] ?? '')}</span>

    case 'auto_number':
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return <span className="truncate tabular-nums" title={value}>{hl(value)}</span>

    case 'status': {
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      let statusColor = '#64748b'
      const statusCfg = parsedConfig as { options?: Array<{ label: string; color: string }> } | undefined
      const match = statusCfg?.options?.find(o => o.label === value)
      if (match) statusColor = match.color
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium text-white truncate"
          style={{ backgroundColor: statusColor, fontSize: 15 }}
          title={value}
        >
          {hl(value)}
        </span>
      )
    }

    case 'tag': {
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      let tags: string[] = []
      try { tags = JSON.parse(value) } catch { tags = value.split(',').map(t => t.trim()).filter(Boolean) }
      return (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((t, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-sm bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200">
              {hl(t)}
            </span>
          ))}
          {tags.length > 3 && <span className="text-sm text-slate-500 dark:text-slate-400">+{tags.length - 3}</span>}
        </div>
      )
    }

    default:
      if (!value) return <span className="text-slate-300 dark:text-slate-500">—</span>
      return <span className="truncate" title={value}>{hl(value)}</span>
  }
})

/** A date the way list cells show it (also used by the filter chips) */
export function formatDate(value: string): string {
  try {
    const d = new Date(value.includes('T') ? value : `${value}T00:00:00`)
    if (isNaN(d.getTime())) return value
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  } catch {
    return value
  }
}

/**
 * A deadline column (W05): no value of its own to type, just its rule's
 * status — the next due date, or when it was done. The stored value is the
 * date it was last done.
 */
function DeadlineCell({ column, value, row, parsedConfig }: { column: Column; value: string | null; row?: GridRow; parsedConfig?: unknown }): React.ReactElement {
  const ruleId = (parsedConfig as { alert_rule_id?: number } | undefined)?.alert_rule_id
  const rule = useAlertStore(s => s.rules.find(r => r.id === ruleId))
  // Counts, readings, steps and done flags arrive after the rows; redraw when they do
  useGridStore(s => s.deadlineContext)
  // Not set up yet: the cell itself opens the column's rule picker (G-20)
  if (!rule) return (
    <button type="button" className="text-blue-700 dark:text-blue-300 underline hover:no-underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
      onClick={e => { e.stopPropagation(); pulseEvents.emit('column:choose-rule', { columnId: column.id }) }}>
      Choose a deadline rule
    </button>
  )
  const res = evaluateRuleForRow(rule, value, (row ?? {}) as unknown as Record<string, unknown>, column.id)
  if (res.state === 'done') return <span className="truncate min-w-0 text-green-700 dark:text-green-300">Done{value ? ` ${formatDue(value.slice(0, 10))}` : ''}</span>
  if (res.state === 'paused') return <span className="truncate min-w-0 text-slate-500 dark:text-slate-400 italic" title={res.detail}>Paused</span>
  if (!res.due || res.daysUntil === null) return <span className="text-slate-300 dark:text-slate-500">—</span>
  const d = res.daysUntil
  // A used-up quota: "All 12 used · ends Dec 31, 2026", not "today"
  if (isUsedUp(res)) return <span className="truncate min-w-0 tabular-nums" title={res.detail}>{res.label ?? 'All used'} · ends {formatDue(res.due)}</span>
  const when = d < 0 ? `${-d} day${d === -1 ? '' : 's'} late` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`
  return <span className="truncate min-w-0 tabular-nums" title={res.detail}>{res.label ? `${res.label} · ` : ''}{formatDue(res.due)} · {when}</span>
}
