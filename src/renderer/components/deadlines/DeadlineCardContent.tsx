/**
 * One deadline card (UX pass Q3): the same words and the same buttons, in the
 * same order, wherever a deadline shows — a grid cell's card, the profile's
 * Deadlines panel, the Calendar's side panel and a dashboard row:
 *
 *   Done (or "Mark {step} done", or Renew… for a quota) · Done on… ·
 *   Extend… (or Remove extension) · Open {record} · Change date…
 *
 * Open is left out where the record is already open (the profile) and where
 * the name is the link (a dashboard row); Change date… is given only for a
 * date column, where the caller can open its editor. The dialogs Done needs
 * (a reading, Renewed or Finished, which day) come from useDeadlineActions.
 */
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { formatDue, isUsedUp } from '../../../shared/deadlineEngine'
import { daysAwayLabel, daysOverdueLabel } from '../../../shared/deadlineTiles'
import { shortDate } from '../../../shared/dates'
import { useVocab } from '../../hooks/useVocab'
import type { ExtendedDeadlineInfo } from '../../views/dashboard/types'
import { useDeadlineActions } from '../../views/dashboard/useDeadlineActions'
import { PrimaryButton, SecondaryButton } from '../ui/Button'

export type DeadlineCardWhere = 'grid' | 'profile' | 'calendar' | 'dashboard'

export interface DeadlineCardContentProps {
  info: ExtendedDeadlineInfo
  where: DeadlineCardWhere
  /** stack: words above, buttons below; row: the buttons only, in one line (a dashboard row) */
  layout: 'stack' | 'row'
  /** Leave out the words where the page already shows them (the profile's card) */
  words?: boolean
  /** After Undo, or an extension added or removed: load again */
  onChanged?: () => Promise<void>
  /** After Done went through */
  onDone?: (rowId: number, columnId: number) => void
  /** A date column: open its date editor */
  onChangeDate?: () => void
  /** The record's page opens (the grid card closes itself first) */
  onOpenRecord?: () => void
}

/** "Due Oct 26 · 11 days", "Done", "Paused" */
export function dueWords(info: ExtendedDeadlineInfo): string {
  if (info.state === 'done') return 'Done'
  if (info.state === 'paused') return 'Paused'
  if (isUsedUp({ state: info.state, daysUntil: info.daysUntil })) return info.label || daysOverdueLabel(info.daysUntil)
  const days = info.daysUntil
  return `Due ${info.due ? formatDue(info.due) : shortDate(new Date(`${info.dateValue.slice(0, 10)}T00:00:00`))} · ${days < 0 ? daysOverdueLabel(days) : daysAwayLabel(days)}`
}

function storedDate(dateValue: string): string {
  try { return shortDate(new Date(dateValue.includes('T') ? dateValue : `${dateValue}T00:00:00`)) } catch { return dateValue }
}

export function DeadlineCardContent({ info, where, layout, words = layout === 'stack', onChanged, onDone, onChangeDate, onOpenRecord }: DeadlineCardContentProps): React.ReactElement {
  const navigate = useNavigate()
  const { t } = useVocab(info.gridId)
  const act = useDeadlineActions(info, { onMarkDone: onDone, onChanged })
  const usedUp = isUsedUp({ state: info.state, daysUntil: info.daysUntil })
  const openRecord = () => { onOpenRecord?.(); navigate(`/profile/${info.rowId}?gridId=${info.gridId}`) }
  const showOpen = where === 'grid' || where === 'calendar'
  const target = act.stepName ?? info.columnName
  // One accent per screen (Q8): Done is the card's main action in a grid card or
  // the Calendar's panel, but on a dashboard row or the profile it's one of many,
  // so it's drawn neutral and the page keeps its own main action
  const MainButton = where === 'grid' || where === 'calendar' ? PrimaryButton : SecondaryButton
  const size = layout === 'row' ? 'compact' : 'normal'

  return (
    <>
      {words && (
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-800 dark:text-slate-100" data-testid="deadline-card-due">{dueWords(info)}</p>
          {act.recurring && info.dateValue && <p className="text-base text-slate-600 dark:text-slate-300">Last done {storedDate(info.dateValue)}</p>}
          {info.label && !usedUp && act.ruleKind !== 'interval' && <p className="text-base text-slate-600 dark:text-slate-300">{info.label}</p>}
          {info.detail && <p className="text-base text-slate-600 dark:text-slate-300">{info.detail}</p>}
        </div>
      )}
      <div className={layout === 'row' ? 'flex flex-shrink-0 items-center gap-2' : 'flex flex-wrap gap-2'} data-testid="deadline-card-actions">
        {act.ruleKind === 'quota' ? (
          where !== 'profile' && (
            <MainButton size={size} onClick={openRecord} title={`Open the ${t('record')} to set new dates and how many are allowed`}>Renew…</MainButton>
          )
        ) : act.canMarkDone && (
          <MainButton size={size} busy={act.marking} title={act.doneTitle} onClick={act.startDone}
            icon={<Check className="w-4 h-4" />}
            aria-label={`Mark ${target} done${info.clientName ? ` for ${info.clientName}` : ''}`}>
            {act.stepName ? `Mark ${act.stepName} done` : 'Done'}
          </MainButton>
        )}
        {act.canMarkDone && act.canPickDay && (
          <SecondaryButton size={size} disabled={act.marking} onClick={act.startDoneOnDay} title="It happened on an earlier day: choose which"
            aria-label={`Done on another day: ${info.columnName}${info.clientName ? ` for ${info.clientName}` : ''}`}>Done on…</SecondaryButton>
        )}
        {info.extensionId
          ? <SecondaryButton size={size} onClick={() => void act.removeExtension()} title={info.detail || undefined}>Remove extension</SecondaryButton>
          : act.canExtend && <SecondaryButton size={size} onClick={act.startExtend} title="Give it a new due date, with a reason">Extend…</SecondaryButton>}
        {showOpen && <SecondaryButton size={size} onClick={openRecord}>Open {t('record')}</SecondaryButton>}
        {onChangeDate && <SecondaryButton size={size} onClick={onChangeDate} title="Type or pick a different date">Change date…</SecondaryButton>}
      </div>
      {act.dialogs}
    </>
  )
}
