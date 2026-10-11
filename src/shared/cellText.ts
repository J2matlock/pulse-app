/**
 * What a cell says, as plain text (audit G-08): one function for copying a
 * cell, exports and printouts, so none of them shows stored values the
 * screen never does (JSON tag lists, link separators, "last done" dates).
 */
import { linkValueText } from './links'
import { formatDue, type DeadlineResult } from './deadlineEngine'

export type DateFormat = 'iso' | 'us' | 'eu'

/** A YYYY-MM-DD (or ISO date-time) value in the chosen format; anything else unchanged */
export function formatDateAs(value: string, fmt: DateFormat): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return value
  const [, y, mo, d] = m
  if (fmt === 'iso') return `${y}-${mo}-${d}`
  if (fmt === 'us') return `${mo}/${d}/${y}`
  return `${d}/${mo}/${y}`
}

/** The text of a cell; deadline columns need their worked-out result (see deadlineText) */
export function cellText(columnType: string, value: string | null, opts: { dateFormat?: DateFormat } = {}): string {
  if (value === null || value === '') return ''
  switch (columnType) {
    case 'checkbox': return (value === 'true' || value === '1') ? 'Yes' : 'No'
    case 'date': return formatDateAs(value, opts.dateFormat ?? 'iso')
    case 'currency': {
      const n = parseFloat(value)
      return isNaN(n) ? value : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    case 'tag': {
      try {
        const arr = JSON.parse(value) as unknown
        if (Array.isArray(arr)) return arr.map(String).join(', ')
      } catch { /* plain text */ }
      return value
    }
    case 'link': return linkValueText(value)
    default: return value
  }
}

/** A deadline cell as the table shows it: "Oct 6, 2026 · in 361 days", "Done Oct 2, 2026", "Paused" */
export function deadlineText(res: DeadlineResult | undefined, lastDone: string | null): string {
  if (!res) return ''
  if (res.state === 'done') return `Done${lastDone ? ` ${formatDue(lastDone.slice(0, 10))}` : ''}`
  if (res.state === 'paused') return 'Paused'
  if (!res.due || res.daysUntil === null) return ''
  const d = res.daysUntil
  const when = d < 0 ? `${-d} day${d === -1 ? '' : 's'} late` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`
  return `${res.label ? `${res.label} · ` : ''}${formatDue(res.due)} · ${when}${res.estimated ? ' (estimated)' : ''}`
}
