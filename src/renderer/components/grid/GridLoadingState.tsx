import React from 'react'

// ── Loading skeleton ─────────────────────────────────────────────────────────

export interface GridLoadingSkeletonProps {
  rowHeight: number
}

export function GridLoadingSkeleton({ rowHeight }: GridLoadingSkeletonProps): React.ReactElement {
  return (
    <div className="flex flex-col h-full" role="status" aria-label="Loading">
      {/* Skeleton header row */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" style={{ height: rowHeight }}>
        {[120, 200, 160, 140, 180].map((w, i) => (
          <div key={i} className="flex-shrink-0 border-r border-slate-200 dark:border-slate-700 px-3 py-3" style={{ width: w }}>
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-sm animate-pulse" />
          </div>
        ))}
      </div>
      {/* Skeleton data rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex border-b border-slate-100 dark:border-slate-800" style={{ height: rowHeight }}>
          {[120, 200, 160, 140, 180].map((w, j) => (
            <div key={j} className="flex-shrink-0 border-r border-slate-100 dark:border-slate-800 px-3 py-3" style={{ width: w }}>
              <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm animate-pulse" style={{ width: `${50 + ((i + j) * 7) % 40}%` }} />
            </div>
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

// ── Empty columns state ──────────────────────────────────────────────────────

export function GridEmptyColumns(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500 dark:text-slate-400">
      <p className="text-base">No columns yet. Add a column to get started.</p>
    </div>
  )
}
