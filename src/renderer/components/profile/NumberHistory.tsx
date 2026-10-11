/**
 * A number column's history on the profile (W10 §5): a small line next to
 * the value, and a full chart when clicked (first, last, lowest and highest
 * values labelled, so many points don't pile up).
 * Inline SVG (no chart library), with a table for screen readers.
 */
import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { parseDbTimestamp } from '../../../shared/dates'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export interface SeriesPoint { at: string; value: number }

const short = (ts: string) => parseDbTimestamp(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
const fmt = (n: number, currency: boolean) => currency ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : n.toLocaleString('en-US', { maximumFractionDigits: 2 })

/** Points scaled into a box; time on x, value on y (higher is up) */
export function scalePoints(points: SeriesPoint[], w: number, h: number, pad = 2): Array<{ x: number; y: number }> {
  const ts = points.map(p => parseDbTimestamp(p.at).getTime())
  const minT = Math.min(...ts), maxT = Math.max(...ts)
  const vals = points.map(p => p.value)
  const minV = Math.min(...vals), maxV = Math.max(...vals)
  return points.map((p, i) => ({
    x: pad + (maxT === minT ? (points.length === 1 ? (w - 2 * pad) / 2 : (i / (points.length - 1)) * (w - 2 * pad)) : ((ts[i]! - minT) / (maxT - minT)) * (w - 2 * pad)),
    y: pad + (maxV === minV ? (h - 2 * pad) / 2 : (1 - (p.value - minV) / (maxV - minV)) * (h - 2 * pad)),
  }))
}

/** Which points get a label on the chart: the first, last, lowest and highest. */
export function labelledIndices(points: SeriesPoint[]): Set<number> {
  if (points.length === 0) return new Set()
  let lo = 0, hi = 0
  points.forEach((p, i) => { if (p.value < points[lo]!.value) lo = i; if (p.value > points[hi]!.value) hi = i })
  return new Set([0, points.length - 1, lo, hi])
}

export function Sparkline({ points, label, onOpen }: { points: SeriesPoint[]; label: string; onOpen: () => void }): React.ReactElement | null {
  if (points.length < 2) return null
  const xy = scalePoints(points, 72, 22)
  const first = points[0]!.value, last = points[points.length - 1]!.value
  return (
    <button type="button" onClick={onOpen} title={`${label}: history`} aria-label={`${label}: show history (${points.length} values)`}
      className="hit-44 inline-flex items-center px-1 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
      {/* One neutral color: going down isn't always bad (weight lost, a debt paid down) */}
      <svg width="72" height="22" viewBox="0 0 72 22" aria-hidden="true" className="text-slate-600 dark:text-slate-300" data-trend={last >= first ? 'up' : 'down'}>
        <polyline points={xy.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xy[xy.length - 1]!.x} cy={xy[xy.length - 1]!.y} r="2.5" fill="currentColor" />
      </svg>
    </button>
  )
}

export function NumberHistoryDialog({ label, points, currency, onClose }: { label: string; points: SeriesPoint[]; currency: boolean; onClose: () => void }): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const W = 560, H = 240, L = 56, B = 28, T = 24, R = 16
  const xy = scalePoints(points, W - L - R, H - T - B, 0).map(p => ({ x: p.x + L, y: p.y + T }))
  const vals = points.map(p => p.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  const labelled = labelledIndices(points)
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="number-history-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="number-history-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">{label} over time</h2>
          <button type="button" aria-label="Close" onClick={onClose}
            className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-slate-700 dark:text-slate-300" aria-hidden="true">
          <g className="text-slate-300 dark:text-slate-600" stroke="currentColor" strokeWidth="1">
            <line x1={L} y1={T} x2={L} y2={H - B} />
            <line x1={L} y1={H - B} x2={W - R} y2={H - B} />
          </g>
          <g className="fill-slate-500 dark:fill-slate-400" fontSize="12">
            <text x={L - 6} y={T + 4} textAnchor="end">{fmt(max, currency)}</text>
            {max !== min && <text x={L - 6} y={H - B} textAnchor="end">{fmt(min, currency)}</text>}
            <text x={L} y={H - 8}>{short(points[0]!.at)}</text>
            <text x={W - R} y={H - 8} textAnchor="end">{short(points[points.length - 1]!.at)}</text>
          </g>
          <polyline points={xy.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          {xy.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="4" fill="currentColor" />
              {labelled.has(i) && <text x={p.x} y={p.y - 9} textAnchor="middle" fontSize="12" className="fill-slate-700 dark:fill-slate-200">{fmt(points[i]!.value, currency)}</text>}
            </g>
          ))}
        </svg>
        <table className="sr-only">
          <caption>{label} over time</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Value</th></tr></thead>
          <tbody>{points.map((p, i) => <tr key={i}><td>{short(p.at)}</td><td>{fmt(p.value, currency)}</td></tr>)}</tbody>
        </table>
        <p className="text-base text-slate-600 dark:text-slate-300">
          {points.length} values from {short(points[0]!.at)} to {short(points[points.length - 1]!.at)}.
        </p>
      </div>
    </div>
  )
}
