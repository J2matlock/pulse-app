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
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, Check } from 'lucide-react'
import { formatDue, isUsedUp, lastDoneInFuture } from '../../../shared/deadlineEngine'
import type { RuleKind } from '../../../shared/deadlineEngine'
import type { RuleInterval } from '../../../shared/ruleInterval'
import { daysAwayLabel, daysOverdueLabel } from '../../../shared/deadlineTiles'
import { localDateString, shortDate } from '../../../shared/dates'
import { IPC } from '../../../shared/ipc-channels'
import { useVocab } from '../../hooks/useVocab'
import { useAlertStore } from '../../stores/alertStore'
import { useGridStore } from '../../stores/gridStore'
import { useUndoStore } from '../../stores/undoStore'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
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

/** "It's right" on a future last-done date: hidden for that record, column and date until the app restarts */
const futureDateOk = new Set<string>()

/** Whether a stored date shows the future "last done" warning (not dismissed this session) */
export function showsFutureLastDone(rowId: number, columnId: number, stored: string | null | undefined, rule: { kind: RuleKind; interval: RuleInterval }): boolean {
  return !!stored && lastDoneInFuture(stored, rule, localDateString()) && !futureDateOk.has(`${rowId}:${columnId}:${stored.slice(0, 10)}`)
}

/**
 * Every date in a date column read as the day it's due (setup's "Due date"
 * rule), with Undo. For a column whose "last done" dates are in the future.
 */
async function makeColumnDueDates(gridId: number, columnId: number, columnName: string, onChanged?: () => Promise<void>): Promise<boolean> {
  const before = () => { const g = useGridStore.getState(); return [...g.columns, ...g.hiddenColumns].find(c => c.id === columnId) }
  const prevConfig = before()?.config || '{}'
  const apply = async (): Promise<boolean> => {
    const res = await safeInvoke(IPC.ONBOARDING_DATE_RULES, gridId, [{ columnId, repeat: 'due' }])
    if (!res.ok) { toast.error(friendlyError(res.error, "We couldn't change the column — try again")); return false }
    await useAlertStore.getState().loadRules()
    if (useGridStore.getState().activeGridId === gridId) await useGridStore.getState().loadGrid(gridId)
    await onChanged?.()
    return true
  }
  if (!await apply()) return false
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description: `“${columnName}” dates are now due dates`,
    timestamp: Date.now(),
    category: 'silent',
    icon: 'calendar',
    undo: async () => {
      await useGridStore.getState().updateColumn(columnId, { config: prevConfig })
      await useAlertStore.getState().loadRules()
      await onChanged?.()
    },
    redo: async () => { await apply() },
  })
  return true
}

/**
 * "Dec 4, 2026 is in the future. Is that when it's due?" in place of "Last
 * done Dec 4, 2026" (persona study R4): a review date imported as a done date
 * put the deadline a year out. The fix is a click away; "It's right" hides it.
 */
export function FutureLastDone({ gridId, rowId, columnId, columnName, stored, onChanged }: {
  gridId: number
  rowId: number
  columnId: number
  columnName: string
  stored: string
  onChanged?: () => Promise<void>
}): React.ReactElement | null {
  const { t } = useVocab(gridId)
  const [, setHidden] = useState(0)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const isDateColumn = useGridStore(s => [...s.columns, ...s.hiddenColumns].find(c => c.id === columnId)?.column_type === 'date')
  const day = stored.slice(0, 10)
  if (futureDateOk.has(`${rowId}:${columnId}:${day}`)) return null
  const shown = shortDate(new Date(`${day}T00:00:00`))
  return (
    <div className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2" data-testid="future-last-done">
      <p className="flex items-start gap-2 text-base text-slate-800 dark:text-slate-100">
        <AlertTriangle className="w-4 h-4 mt-1 flex-shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <span><strong>{shown} is in the future.</strong> Is that when it&apos;s due?</span>
      </p>
      {asking ? (
        <>
          <p className="text-base text-slate-700 dark:text-slate-200">
            Every date in “{columnName}” will be read as the day it&apos;s due, for every {t('record')}. You can undo it.
          </p>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton size="compact" busy={busy}
              onClick={() => { setBusy(true); void makeColumnDueDates(gridId, columnId, columnName, onChanged).finally(() => { setBusy(false); setAsking(false) }) }}>
              Make them due dates
            </PrimaryButton>
            <SecondaryButton size="compact" disabled={busy} onClick={() => setAsking(false)}>Cancel</SecondaryButton>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {/* A link-style button: the words wrap in a narrow card, where a compact button's don't */}
          {isDateColumn && (
            <button type="button" onClick={() => setAsking(true)}
              className="hit-44 px-1 text-left text-base font-medium text-blue-700 dark:text-blue-300 underline rounded-lg focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
              Make this column&apos;s dates the due dates
            </button>
          )}
          <SecondaryButton size="compact" onClick={() => { futureDateOk.add(`${rowId}:${columnId}:${day}`); setHidden(n => n + 1) }}>It&apos;s right</SecondaryButton>
        </div>
      )}
    </div>
  )
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
          {act.recurring && info.dateValue && (showsFutureLastDone(info.rowId, info.columnId, info.dateValue, { kind: act.ruleKind, interval: act.ruleInterval })
            ? <FutureLastDone gridId={info.gridId} rowId={info.rowId} columnId={info.columnId} columnName={info.columnName} stored={info.dateValue} onChanged={onChanged} />
            : <p className="text-base text-slate-600 dark:text-slate-300">Last done {storedDate(info.dateValue)}</p>)}
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
