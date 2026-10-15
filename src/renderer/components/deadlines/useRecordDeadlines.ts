/**
 * The deadlines of a few records, as main's engine works them out
 * (DEADLINES_GET), for the shared deadline card. The grid card, the profile,
 * the Calendar's panel and the dashboard all read the same engine, so they
 * can't disagree about what's due or what Done will do.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import type { DeadlineResult, RuleKind, MeterInfo } from '../../../shared/deadlineEngine'
import { toRuleInterval } from '../../../shared/ruleInterval'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import type { ExtendedDeadlineInfo } from '../../views/dashboard/types'

/** What DEADLINES_GET returns for a record (main's DeadlineItem) */
export type Loaded = DeadlineResult & {
  row_id: number; grid_id: number; grid_name: string; column_id: number; column_name: string; column_config: string
  date_value: string; client_name: string | null; interval_days: number | null; interval_months: number | null; end_of_month: number | null
  rule_kind: RuleKind; extension_id?: number; meter?: MeterInfo
}

export function toInfo(d: Loaded): ExtendedDeadlineInfo | null {
  if (d.due === null || d.daysUntil === null) return null
  let checklistTemplateId: number | null = null
  try { checklistTemplateId = (JSON.parse(d.column_config || '{}') as { done_checklist_id?: number }).done_checklist_id ?? null } catch { /* none */ }
  const interval = toRuleInterval(d)
  return {
    rowId: d.row_id, clientName: d.client_name ?? '', gridId: d.grid_id, gridName: d.grid_name, columnId: d.column_id, columnName: d.column_name,
    dateValue: d.date_value, daysUntil: d.daysUntil, alertRuleId: null, threshold: null,
    intervalDays: interval.days, interval, checklistTemplateId, due: d.due, detail: d.detail, ruleKind: d.rule_kind, step: d.step,
    extensionId: d.extension_id, state: d.state, label: d.label, meter: d.meter,
  }
}

/** The map's key for one deadline */
export const deadlineKey = (rowId: number, columnId: number): string => `${rowId}:${columnId}`

export interface RecordDeadlines {
  /** "rowId:columnId" → the deadline; null while the first load runs */
  infos: Map<string, ExtendedDeadlineInfo> | null
  reload: () => Promise<void>
}

/**
 * Loads once per set of records, and again when a deadline changed anywhere
 * ('deadline:changed'), when a note was written for one of these records (a
 * quota counts notes; Done and Extend write one) and when one of their cells
 * was saved (a new date). includeDone keeps finished one-off dates, so the
 * card can say "Done" instead of nothing.
 */
export function useRecordDeadlines(rowIds: number[] | null, opts: { includeDone?: boolean } = {}): RecordDeadlines {
  const [infos, setInfos] = useState<Map<string, ExtendedDeadlineInfo> | null>(null)
  const ids = rowIds && rowIds.length > 0 ? rowIds.join(',') : ''
  const includeDone = opts.includeDone === true
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    if (!ids) { setInfos(new Map()); return }
    const rowIdList = ids.split(',').map(Number)
    const res = await safeInvoke<Loaded[]>(IPC.DEADLINES_GET, { rowIds: rowIdList, ...(includeDone ? { includeDone: true } : {}) })
    // A newer load (other records, or a later change) wins
    if (mine !== seq.current) return
    const next = new Map<string, ExtendedDeadlineInfo>()
    if (res.ok && Array.isArray(res.data)) {
      for (const d of res.data) {
        const info = toInfo(d)
        if (info) next.set(deadlineKey(info.rowId, info.columnId), info)
      }
    }
    setInfos(next)
  }, [ids, includeDone])

  useEffect(() => {
    setInfos(null)
    void reload()
    // A late answer for records no longer shown is dropped
    return () => { seq.current++ }
  }, [reload])

  useEffect(() => {
    if (!ids) return
    const mine = new Set(ids.split(',').map(Number))
    const offChanged = pulseEvents.on('deadline:changed', () => { void reload() })
    const offSaved = pulseEvents.on('cell:saved', ({ rowId }) => { if (mine.has(rowId)) void reload() })
    const offLog = window.api?.on?.(IPC.CASE_LOG_CHANGED, (changed: unknown) => {
      if (typeof changed === 'number' && mine.has(changed)) void reload()
    })
    return () => { offChanged(); offSaved(); offLog?.() }
  }, [ids, reload])

  return { infos, reload }
}
