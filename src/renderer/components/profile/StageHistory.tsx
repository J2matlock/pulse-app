/**
 * Profile "Stage history" (W06 §5): how long this record has been in its
 * stage, and how long it spent in the ones before.
 */
import React, { useEffect, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import type { StageDurations } from '../../../shared/stages'
import { parseDbTimestamp } from '../../../shared/dates'
import { safeInvoke } from '../../utils/safeInvoke'

const day = (ts: string) => parseDbTimestamp(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const days = (n: number, approx: boolean) => `${approx ? 'about ' : ''}${n} day${n === 1 ? '' : 's'}`

export function StageHistory({ gridId, columnId, columnName, rowId, value }: {
  gridId: number; columnId: number; columnName: string; rowId: number
  /** The current stage, so the history reloads when it changes */
  value: string | null
}): React.ReactElement | null {
  const [d, setD] = useState<StageDurations | null>(null)
  useEffect(() => {
    void safeInvoke<Record<number, StageDurations>>(IPC.STAGE_DURATIONS, gridId, columnId, [rowId]).then(r => setD(r.ok ? r.data[rowId] ?? null : null))
  }, [gridId, columnId, rowId, value])
  if (!d) return null
  const none = `No ${columnName.toLowerCase()}`
  return (
    <ol className="space-y-1.5" aria-label={`${columnName} history`}>
      <li className="flex flex-wrap items-baseline gap-x-2 text-base">
        <span className="font-semibold text-slate-800 dark:text-slate-100">{d.current.stage ?? none}</span>
        <span className="text-slate-600 dark:text-slate-300">now, for {days(d.current.days, d.current.approximate)} (since {day(d.current.since)})</span>
      </li>
      {[...d.stays].reverse().map((s, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-base">
          <span className="text-slate-800 dark:text-slate-100">{s.stage ?? none}</span>
          <span className="text-slate-500 dark:text-slate-400">{days(s.days, s.approximate)} ({day(s.from)} to {day(s.to)})</span>
        </li>
      ))}
    </ol>
  )
}
