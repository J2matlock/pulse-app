import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke, storeInvoke } from '../../utils/safeInvoke'
import { useUndoStore } from '../../stores/undoStore'
import { useGridStore } from '../../stores/gridStore'
import type { SideEffect } from '../../stores/undoStore'
import { localDateString } from '../../../shared/dates'
import { addInterval, type RuleInterval } from '../../../shared/ruleInterval'
import type { RuleKind } from '../../../shared/deadlineEngine'
import toast from 'react-hot-toast'

export interface DeadlineToComplete {
  rowId: number
  columnId: number
  columnName: string
  clientName: string
  /** The stored date being completed */
  dateValue: string
  /** The column's rule interval; a repeating rule starts its next cycle */
  interval?: RuleInterval
  /** Checklist template to add to the client when this is marked done */
  checklistTemplateId?: number | null
  /** How the rule works (W05); other kinds than interval always record today as done */
  ruleKind?: RuleKind
  /** Meter rules: the reading at the service */
  reading?: number
  /** Sequence rules: the step to check off */
  step?: number
  /** One-off dates (no repeat): renewed with a new date, or finished (Decision E1) */
  oneOff?: { kind: 'renewed'; newDate: string } | { kind: 'finished' }
}

/** What main did for a plain Done (L-25), for undo */
interface MarkDoneSnap { previous: string | null; newValue: string | null; finishedFor: string | null; sysLogId: number; checklistItemIds: number[] }

/** A date with no repeat: Done asks whether it was renewed or finished */
export function isOneOffDeadline(item: Pick<DeadlineToComplete, 'ruleKind' | 'interval'>): boolean {
  return (!item.ruleKind || item.ruleKind === 'interval') && !(item.interval && (item.interval.days > 0 || item.interval.months > 0))
}

/** Keep the open list in step with a date main changed */
function patchCell(rowId: number, columnId: number, value: string | null): void {
  const key = `col_${columnId}`
  useGridStore.setState(s => ({ rows: s.rows.map(r => r.row_id === rowId ? { ...r, [key]: value } : r) }))
}

/**
 * A rule that counts from the date entered ("every 6 months") repeats; a plain
 * due date doesn't. Other kinds (relative, calendar, meter…) always keep the
 * done date, which is how they know it's done.
 */
export function startsNextCycle(iv: RuleInterval | undefined, kind?: RuleKind): boolean {
  if (kind && kind !== 'interval') return true
  return !!iv && (iv.days > 0 || iv.months > 0)
}

/**
 * Bulk "Mark done": meter readings are asked one at a time, quotas are renewed
 * on the record, and a step that can't be told isn't marked. Returns what can
 * go ahead, and a plain message naming what can't.
 */
export function skippedForBulkDone<T extends DeadlineToComplete>(items: T[]): { rest: T[]; message: string | null } {
  const reading = items.filter(c => c.ruleKind === 'meter')
  const quota = items.filter(c => c.ruleKind === 'quota')
  const noStep = items.filter(c => c.ruleKind === 'sequence' && c.step === undefined)
  const oneOff = items.filter(c => isOneOffDeadline(c) && !c.oneOff)
  const rest = items.filter(c => !reading.includes(c) && !quota.includes(c) && !noStep.includes(c) && !oneOff.includes(c))
  const names = (xs: T[]) => [...new Set(xs.map(x => x.columnName))].join(', ')
  const parts = [
    reading.length ? `${names(reading)} (needs a reading; mark done one at a time)` : '',
    quota.length ? `${names(quota)} (renew on the record)` : '',
    noStep.length ? `${names(noStep)} (open the record to choose the step)` : '',
    oneOff.length ? `${names(oneOff)} (say whether it was renewed or finished; one at a time)` : '',
  ].filter(Boolean)
  const n = reading.length + quota.length + noStep.length + oneOff.length
  return { rest, message: n ? `${n} couldn't be marked done here: ${parts.join('; ')}.` : null }
}

const hasRepeat = (iv: RuleInterval) => iv.days > 0 || iv.months > 0

function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d.includes('T') ? d : `${d}T00:00:00`) : d
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function addChecklist(rowId: number, templateId: number | null | undefined): Promise<number[]> {
  if (!templateId) return []
  const res = await safeInvoke<{ createdIds: number[] }>(IPC.CHECKLIST_APPLY_TEMPLATE, rowId, templateId)
  return res.ok ? res.data.createdIds : []
}

async function removeChecklistItems(ids: number[]): Promise<void> {
  for (const id of ids) await safeInvoke(IPC.CHECKLIST_DELETE_ITEM, id)
}

/**
 * Mark one or more deadlines done and record it on each client's timeline.
 * - Repeating rules ("every 6 months after the last review"): the date becomes
 *   today, which starts the next cycle.
 * - Plain due dates: the date is cleared.
 * - If the column names a checklist, it's added to the client.
 * One undo step covers the whole batch. Returns the deadlines that were completed.
 */
export async function completeDeadlines(
  items: DeadlineToComplete[],
  opts: { onUndone?: () => Promise<void> } = {}
): Promise<DeadlineToComplete[]> {
  const today = localDateString()
  const done: Array<DeadlineToComplete & { sysLogId: number | null; newValue: string | null; checklistIds: number[]; previous?: Record<number, string | null>; isStep?: boolean; snap?: MarkDoneSnap }> = []
  for (const item of items) {
    if (item.ruleKind === 'sequence') {
      if (item.step === undefined) continue
      const res = await safeInvoke<{ sysLogId: number }>(IPC.DEADLINE_STEP_DONE, item.rowId, item.columnId, item.step)
      if (!res.ok) { toast.error(res.error); continue }
      const checklistIds = await addChecklist(item.rowId, item.checklistTemplateId)
      done.push({ ...item, sysLogId: res.data.sysLogId, newValue: item.dateValue, checklistIds, isStep: true })
      continue
    }
    if (item.ruleKind === 'meter') {
      if (item.reading === undefined) continue
      const res = await safeInvoke<{ previous: Record<number, string | null>; sysLogId: number }>(IPC.DEADLINE_METER_DONE, item.rowId, item.columnId, item.reading)
      if (!res.ok) { toast.error(res.error); continue }
      const checklistIds = await addChecklist(item.rowId, item.checklistTemplateId)
      done.push({ ...item, sysLogId: res.data.sysLogId, newValue: today, checklistIds, previous: res.data.previous })
      continue
    }
    // Everything else: one step in main (date, note, checklist) — L-25
    const oneOff = isOneOffDeadline(item)
    if (oneOff && !item.oneOff) continue
    const res = await safeInvoke<MarkDoneSnap>(IPC.DEADLINE_MARK_DONE, item.rowId, item.columnId, oneOff ? item.oneOff : { kind: 'repeat' }, item.checklistTemplateId ?? null)
    if (!res.ok) { toast.error(res.error); continue }
    patchCell(item.rowId, item.columnId, res.data.newValue)
    done.push({ ...item, sysLogId: res.data.sysLogId, newValue: res.data.newValue, checklistIds: [], snap: res.data })
  }
  if (done.length === 0) return []

  // Plain Done notes are voided in its own undo, since redo writes a fresh one
  const sideEffects: SideEffect[] = done.filter(d => d.sysLogId != null && !d.snap).map(d => ({ type: 'void_case_log', caseLogId: d.sysLogId! }))
  const first = done[0]!
  const nextDue = first.oneOff?.kind === 'renewed' ? `; now due ${formatDate(first.oneOff.newDate)}`
    : first.oneOff?.kind === 'finished' ? ' (finished)'
    : first.newValue && first.interval && hasRepeat(first.interval) && (!first.ruleKind || first.ruleKind === 'interval') ? `; next due ${formatDate(addInterval(new Date(), first.interval))}` : ''
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description: done.length === 1
      ? `Marked "${first.columnName}" done for ${first.clientName}${nextDue}`
      : `Marked ${done.length} deadlines done`,
    timestamp: Date.now(),
    category: 'logged',
    icon: 'check-square',
    contextLabel: done.length === 1 ? first.clientName : undefined,
    contextId: done.length === 1 ? first.rowId : undefined,
    sideEffects: sideEffects.length > 0 ? sideEffects : undefined,
    undo: async () => {
      for (const d of done) {
        if (d.isStep) {
          await safeInvoke(IPC.DEADLINE_STEP_UNDO, d.rowId, d.columnId, d.step)
        } else if (d.previous) {
          // Meter: put back the date and both readings
          for (const [col, value] of Object.entries(d.previous)) await safeInvoke(IPC.CELL_UPDATE, d.rowId, Number(col), value)
        } else if (d.snap) {
          await storeInvoke(IPC.DEADLINE_MARK_DONE_UNDO, d.rowId, d.columnId, d.snap)
          await safeInvoke(IPC.CASE_LOG_VOID, d.snap.sysLogId, 'Undone action')
          patchCell(d.rowId, d.columnId, d.snap.previous)
        }
        await removeChecklistItems(d.checklistIds)
      }
      await opts.onUndone?.()
    },
    redo: async () => {
      for (const d of done) {
        if (d.isStep) {
          await safeInvoke(IPC.DEADLINE_STEP_DONE, d.rowId, d.columnId, d.step)
        } else if (d.previous) {
          const res = await safeInvoke<{ previous: Record<number, string | null>; sysLogId: number }>(IPC.DEADLINE_METER_DONE, d.rowId, d.columnId, d.reading)
          if (res.ok) d.previous = res.data.previous
        } else if (d.snap) {
          const again = await storeInvoke<MarkDoneSnap>(IPC.DEADLINE_MARK_DONE, d.rowId, d.columnId, isOneOffDeadline(d) ? d.oneOff : { kind: 'repeat' }, d.checklistTemplateId ?? null)
          d.snap = again
          patchCell(d.rowId, d.columnId, again.newValue)
          continue
        }
        d.checklistIds = await addChecklist(d.rowId, d.checklistTemplateId)
      }
      await opts.onUndone?.()
    },
  })
  return done
}
