/**
 * "Correction or new start?" (D-37). A sequence's steps count for the start
 * date they were done for, so changing that date would quietly show every
 * step as not done again. A correction moves the steps to the new date.
 */
import React, { useEffect, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import { engineRuleFrom, toYmd, formatDue, type SequenceConfig } from '../../../shared/deadlineEngine'
import type { Column, ParsedAlertRule } from '../../../shared/types'
import { pulseEvents } from '../../events'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { useUndoStore } from '../../stores/undoStore'
import { safeInvoke, storeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface Pending { rowId: number; columnIds: number[]; from: string; to: string; names: string[] }

/** Sequence columns whose steps count from this column */
export function sequencesAnchoredOn(columnId: number, columns: Column[], rules: ParsedAlertRule[]): Column[] {
  return columns.filter(c => {
    let ruleId: number | undefined
    try { ruleId = (JSON.parse(c.config || '{}') as { alert_rule_id?: number }).alert_rule_id } catch { return false }
    const rule = rules.find(r => r.id === ruleId)
    if (!rule) return false
    const r = engineRuleFrom(rule)
    if (r.kind !== 'sequence' || !r.config) return false
    const a = (r.config as SequenceConfig).anchorColumnId
    return (a === 'self' ? c.id : a) === columnId
  })
}

export function AnchorChangeDialog(): React.ReactElement | null {
  const [pending, setPending] = useState<Pending | null>(null)
  const trapRef = React.useRef<HTMLDivElement>(null)
  // Escape leaves the steps alone, like "It's a new start" (AUDIT-046)
  useFocusTrap(trapRef, !!pending, { onEscape: () => setPending(null) })

  useEffect(() => pulseEvents.on('cell:changed', ({ rowId, columnId, from, to }) => {
    const f = toYmd(from), t = toYmd(to)
    if (!f || !t || f === t) return
    const { columns, hiddenColumns, deadlineContext } = useGridStore.getState()
    const seqs = sequencesAnchoredOn(columnId, [...columns, ...hiddenColumns], useAlertStore.getState().rules)
      .filter(c => (deadlineContext.progress?.[`${rowId}:${c.id}`] ?? []).some(p => p.anchor === f))
    if (seqs.length) setPending({ rowId, columnIds: seqs.map(c => c.id), from: f, to: t, names: seqs.map(c => c.name) })
  }), [])

  if (!pending) return null

  async function correction() {
    const p = pending!
    setPending(null)
    const move = async (from: string, to: string) => {
      for (const c of p.columnIds) await storeInvoke(IPC.DEADLINE_PROGRESS_REANCHOR, p.rowId, c, from, to)
      await useGridStore.getState().refreshDeadlineContext()
    }
    const res = await safeInvoke(IPC.DEADLINE_PROGRESS_REANCHOR, p.rowId, p.columnIds[0], p.from, p.to)
    if (!res.ok) return
    for (const c of p.columnIds.slice(1)) await safeInvoke(IPC.DEADLINE_PROGRESS_REANCHOR, p.rowId, c, p.from, p.to)
    await useGridStore.getState().refreshDeadlineContext()
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(), description: `Kept the steps done for ${p.names.join(', ')}`, timestamp: Date.now(),
      category: 'silent', icon: 'check-square', contextId: p.rowId,
      undo: () => move(p.to, p.from), redo: () => move(p.from, p.to),
    })
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="anchor-change-title"
        className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h2 id="anchor-change-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">Correction, or a new start?</h2>
        <p className="text-base text-slate-700 dark:text-slate-200">
          The date changed from {formatDue(pending.from)} to {formatDue(pending.to)}. Steps of {pending.names.join(', ')} were already done for the old date.
        </p>
        <div className="flex flex-col gap-2">
          <button type="button" className="btn-primary" onClick={() => void correction()}>It was a correction: keep the steps done</button>
          <button type="button" className="btn-secondary" onClick={() => setPending(null)}>It's a new start: the steps start over</button>
        </div>
      </div>
    </div>
  )
}
