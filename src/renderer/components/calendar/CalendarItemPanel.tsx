/**
 * A deadline or follow-up clicked on the Calendar (UX D-08): the full text,
 * "Due Oct 12 · 2 days overdue", and the same choices as the dashboard row
 * (Done, Done on…, Extend…, Open the record) instead of leaving the page.
 * The deadline's details come from main for that one record, so Done goes
 * through the engine like everywhere else.
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { CalendarItem } from '../../../shared/calendar'
import { formatDue, isUsedUp, type DeadlineResult, type RuleKind, type MeterInfo } from '../../../shared/deadlineEngine'
import { daysAwayLabel, daysOverdueLabel } from '../../../shared/deadlineTiles'
import { toRuleInterval } from '../../../shared/ruleInterval'
import { shortDate } from '../../../shared/dates'
import { safeInvoke } from '../../utils/safeInvoke'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import type { ExtendedDeadlineInfo } from '../../views/dashboard/types'
import { useDeadlineActions } from '../../views/dashboard/useDeadlineActions'
import { completeFollowUp } from '../../views/dashboard/completeFollowUp'
import { CalendarPanel } from './CalendarPanel'

/** What DEADLINES_GET returns for a record (main's DeadlineItem) */
type Loaded = DeadlineResult & {
  row_id: number; grid_id: number; grid_name: string; column_id: number; column_name: string; column_config: string
  date_value: string; client_name: string | null; interval_days: number | null; interval_months: number | null; end_of_month: number | null
  rule_kind: RuleKind; extension_id?: number; meter?: MeterInfo
}

function toInfo(d: Loaded): ExtendedDeadlineInfo | null {
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

const btn = 'btn-compact-secondary'

function DeadlineActions({ info, onChanged, onDone }: { info: ExtendedDeadlineInfo; onChanged: () => Promise<void>; onDone: () => void }): React.ReactElement {
  const navigate = useNavigate()
  const { t } = useVocab(info.gridId)
  const act = useDeadlineActions(info, { onMarkDone: onDone, onChanged })
  const usedUp = isUsedUp({ state: info.state, daysUntil: info.daysUntil })
  const stored = (() => { try { return shortDate(new Date(info.dateValue.includes('T') ? info.dateValue : `${info.dateValue}T00:00:00`)) } catch { return info.dateValue } })()
  return (
    <>
      {act.recurring && <p className="text-sm text-slate-600 dark:text-slate-300">Last done {stored}</p>}
      {info.label && !usedUp && act.ruleKind !== 'interval' && <p className="text-sm text-slate-600 dark:text-slate-300">{info.label}</p>}
      {info.detail && <p className="text-sm text-slate-600 dark:text-slate-300">{info.detail}</p>}
      <div className="flex flex-wrap gap-2">
        {act.ruleKind === 'quota' ? (
          <button type="button" className="btn-compact-primary" onClick={() => navigate(`/profile/${info.rowId}?gridId=${info.gridId}`)}
            title={`Open the ${t('record')} to set new dates and how many are allowed`}>Renew…</button>
        ) : (
          <button type="button" className="btn-compact-primary" disabled={act.marking} title={act.doneTitle} onClick={act.startDone}
            aria-label={`Mark ${act.stepName ?? info.columnName} done for ${info.clientName}`}>
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />{act.stepName ? `Mark ${act.stepName} done` : 'Done'}
          </button>
        )}
        {act.canPickDay && (
          <button type="button" className={btn} disabled={act.marking} onClick={act.startDoneOnDay} title="It happened on an earlier day: choose which"
            aria-label={`Done on another day: ${info.columnName} for ${info.clientName}`}>Done on…</button>
        )}
        {info.extensionId
          ? <button type="button" className={btn} onClick={() => void act.removeExtension()}>Remove extension</button>
          : <button type="button" className={btn} onClick={act.startExtend} title="Give it a new due date, with a reason">Extend…</button>}
        <button type="button" className={btn} onClick={() => navigate(`/profile/${info.rowId}?gridId=${info.gridId}`)}>Open {t('record')}</button>
      </div>
      {act.dialogs}
    </>
  )
}

export function CalendarItemPanel({ item, onClose, onChanged }: {
  item: CalendarItem
  onClose: () => void
  /** After Done, an extension or Undo: the Calendar loads again */
  onChanged: () => Promise<void>
}): React.ReactElement {
  const navigate = useNavigate()
  const { t } = useVocab(item.gridId ?? null)
  const [info, setInfo] = useState<ExtendedDeadlineInfo | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  // The chip holds only the words; the engine's row for this record has the rest
  useEffect(() => {
    if (item.kind !== 'deadline' || !item.rowId) { setInfo(null); return }
    let live = true
    setInfo(undefined)
    void safeInvoke<Loaded[]>(IPC.DEADLINES_GET, { rowIds: [item.rowId] }).then(r => {
      if (!live) return
      const row = r.ok && Array.isArray(r.data) ? r.data.find(d => d.column_id === item.columnId) : undefined
      setInfo(row ? toInfo(row) : null)
    })
    return () => { live = false }
  }, [item.kind, item.rowId, item.columnId, item.key])

  const days = item.daysUntil ?? null
  const when = `Due ${formatDue(item.date)}${days !== null ? ` · ${days < 0 ? daysOverdueLabel(days) : daysAwayLabel(days)}` : ''}`
  const title = item.kind === 'deadline' ? item.title : 'Follow-up'
  const changed = async () => { await onChanged(); pulseEvents.emit(item.kind === 'deadline' ? 'deadline:changed' : 'followup:changed') }

  async function finishFollowUp() {
    const id = Number(item.key.replace(/^followup-/, ''))
    if (!Number.isInteger(id) || !item.gridId) return
    setBusy(true)
    try {
      if (await completeFollowUp({ id, client_name: item.recordName ?? null, grid_id: item.gridId }, changed)) { await changed(); onClose() }
    } finally { setBusy(false) }
  }

  return (
    <CalendarPanel title={title} onClose={onClose}>
      {item.recordName && item.rowId && (
        <button type="button" className="text-base text-blue-700 dark:text-blue-300 hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          onClick={() => navigate(`/profile/${item.rowId}?gridId=${item.gridId}`)}>{item.recordName}</button>
      )}
      <p className="text-base text-slate-700 dark:text-slate-200">{when}</p>
      {item.kind === 'followup' && (
        <>
          <p className="text-base text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{item.title}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-compact-primary" disabled={busy} onClick={() => void finishFollowUp()} aria-label={`Mark the follow-up for ${item.recordName ?? t('record')} done`}>
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />Done
            </button>
            {item.rowId && <button type="button" className={btn} onClick={() => navigate(`/profile/${item.rowId}?gridId=${item.gridId}`)}>Open {t('record')}</button>}
          </div>
        </>
      )}
      {item.kind === 'deadline' && (
        info === undefined ? <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>
        : info === null ? (
          <div className="flex flex-wrap gap-2">
            {item.rowId && <button type="button" className={btn} onClick={() => navigate(`/profile/${item.rowId}?gridId=${item.gridId}`)}>Open {t('record')}</button>}
          </div>
        ) : <DeadlineActions info={info} onChanged={changed} onDone={() => { void changed(); onClose() }} />
      )}
    </CalendarPanel>
  )
}
