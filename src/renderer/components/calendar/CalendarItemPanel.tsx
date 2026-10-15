/**
 * A deadline or follow-up clicked on the Calendar (UX D-08): the full text,
 * "Due Oct 12 · 2 days overdue", and the shared deadline card (Done, Done on…,
 * Extend…, Open the record) instead of leaving the page. The deadline's
 * details come from main for that one record, so Done goes through the
 * engine like everywhere else.
 */
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import type { CalendarItem } from '../../../shared/calendar'
import { formatDue } from '../../../shared/deadlineEngine'
import { daysAwayLabel, daysOverdueLabel } from '../../../shared/deadlineTiles'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import { completeFollowUp } from '../../views/dashboard/completeFollowUp'
import { useRecordDeadlines, deadlineKey } from '../deadlines/useRecordDeadlines'
import { DeadlineCardContent } from '../deadlines/DeadlineCardContent'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { CalendarPanel } from './CalendarPanel'

export function CalendarItemPanel({ item, onClose, onChanged }: {
  item: CalendarItem
  onClose: () => void
  /** After Done, an extension or Undo: the Calendar loads again */
  onChanged: () => Promise<void>
}): React.ReactElement {
  const navigate = useNavigate()
  const { t } = useVocab(item.gridId ?? null)
  const [busy, setBusy] = useState(false)

  // The chip holds only the words; the engine's row for this record has the rest
  const { infos } = useRecordDeadlines(item.kind === 'deadline' && item.rowId ? [item.rowId] : null)
  const info = item.kind !== 'deadline' || !item.rowId ? null
    : infos === null ? undefined
    : infos.get(deadlineKey(item.rowId, item.columnId ?? 0)) ?? null

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
      {/* A deadline the engine knows says it in the card's own words */}
      {!(item.kind === 'deadline' && info) && <p className="text-base text-slate-700 dark:text-slate-200">{when}</p>}
      {item.kind === 'followup' && (
        <>
          <p className="text-base text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{item.title}</p>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton busy={busy} onClick={() => void finishFollowUp()} aria-label={`Mark the follow-up for ${item.recordName ?? t('record')} done`}
              icon={<CheckCircle2 className="w-4 h-4" />}>Done</PrimaryButton>
            {item.rowId && <SecondaryButton onClick={() => navigate(`/profile/${item.rowId}?gridId=${item.gridId}`)}>Open {t('record')}</SecondaryButton>}
          </div>
        </>
      )}
      {item.kind === 'deadline' && (
        info === undefined ? <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>
        : info === null ? (
          <div className="flex flex-wrap gap-2">
            {item.rowId && <SecondaryButton onClick={() => navigate(`/profile/${item.rowId}?gridId=${item.gridId}`)}>Open {t('record')}</SecondaryButton>}
          </div>
        ) : <DeadlineCardContent info={info} where="calendar" layout="stack" onChanged={changed} onDone={() => { void changed(); onClose() }} />
      )}
    </CalendarPanel>
  )
}
