/** A built report as a table, with a totals line and sortable headings. */
import React from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { formatReportCell, type ReportResult } from '../../../shared/reports'

export function ReportTable({ result, sort, onSort, maxRows, caption }: {
  result: ReportResult
  sort?: { field: string; dir: 'asc' | 'desc' }
  onSort?: (field: string) => void
  /** Show only the first lines (dashboard cards) */
  maxRows?: number
  caption?: string
}): React.ReactElement {
  const rows = maxRows ? result.rows.slice(0, maxRows) : result.rows
  const numeric = (kind: string) => kind === 'number' || kind === 'currency'
  const showTotals = result.rows.length > 1 && result.columns.some(c => c.key in result.totals)
  if (result.rows.length === 0) return <p className="text-base text-slate-500 dark:text-slate-400 py-4">Nothing to count yet. Add more, or widen the filters above.</p>
  return (
    <div className="overflow-auto">
      <table className="w-full text-base border-collapse">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b-2 border-slate-300 dark:border-slate-600">
            {result.columns.map(c => {
              const active = sort?.field === c.key
              return (
                <th key={c.key} scope="col" className={`py-2 px-2 font-semibold text-slate-700 dark:text-slate-200 ${numeric(c.kind) ? 'text-right' : 'text-left'}`}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {onSort ? (
                    <button type="button" onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 rounded-sm hover:text-blue-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500" style={{ minHeight: 36 }}>
                      {c.label}
                      {active && (sort!.dir === 'asc' ? <ArrowUp className="w-4 h-4" aria-hidden="true" /> : <ArrowDown className="w-4 h-4" aria-hidden="true" />)}
                    </button>
                  ) : c.label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-200 dark:border-slate-700">
              {result.columns.map(c => (
                <td key={c.key} className={`py-2 px-2 text-slate-800 dark:text-slate-100 ${numeric(c.kind) ? 'text-right tabular-nums' : ''}`}>{formatReportCell(r[c.key] ?? null, c.kind, c.bucket)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {showTotals && !maxRows && (
          <tfoot>
            <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-semibold">
              {result.columns.map((c, i) => (
                <td key={c.key} className={`py-2 px-2 text-slate-800 dark:text-slate-100 ${numeric(c.kind) ? 'text-right tabular-nums' : ''}`}>
                  {c.key in result.totals ? formatReportCell(result.totals[c.key] ?? null, c.kind, c.bucket) : i === 0 ? 'Total' : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {maxRows && result.rows.length > maxRows && <p className="text-sm text-slate-500 dark:text-slate-400 pt-1">and {result.rows.length - maxRows} more…</p>}
      {result.truncated && <p className="text-sm text-amber-700 dark:text-amber-300 pt-2">{result.truncated}</p>}
    </div>
  )
}
