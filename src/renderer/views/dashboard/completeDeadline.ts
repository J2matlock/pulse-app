import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
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
  const done: Array<DeadlineToComplete & { sysLogId: number | null; newValue: string | null; checklistIds: number[]; previous?: Record<number, string | null>; isStep?: boolean }> = []
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
    const repeat = startsNextCycle(item.interval, item.ruleKind)
    const newValue = repeat ? today : null
    const res = await safeInvoke(IPC.CELL_UPDATE, item.rowId, item.columnId, newValue)
    if (!res.ok) continue
    let sysLogId = res.data.sysLogId
    // Columns without "log changes" still get a timeline entry, so completions are never invisible
    if (sysLogId == null) {
      const text = !repeat ? `${item.columnName} completed (was ${formatDate(item.dateValue)})`
        : item.ruleKind && item.ruleKind !== 'interval' ? `${item.columnName} done ${formatDate(today)}`
        : `${item.columnName} done ${formatDate(today)}; next due ${formatDate(addInterval(new Date(), item.interval!))}`
      const logRes = await safeInvoke(IPC.CASE_LOG_CREATE, item.rowId, text, 'system', null)
      if (logRes.ok) sysLogId = logRes.data.id
    }
    const checklistIds = await addChecklist(item.rowId, item.checklistTemplateId)
    done.push({ ...item, sysLogId, newValue, checklistIds })
  }
  if (done.length === 0) return []

  const sideEffects: SideEffect[] = done.filter(d => d.sysLogId != null).map(d => ({ type: 'void_case_log', caseLogId: d.sysLogId! }))
  const first = done[0]!
  const nextDue = first.newValue && first.interval && (!first.ruleKind || first.ruleKind === 'interval') ? `; next due ${formatDate(addInterval(new Date(), first.interval))}` : ''
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
        } else {
          await useGridStore.getState().updateCell(d.rowId, d.columnId, d.dateValue)
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
        } else {
          await useGridStore.getState().updateCell(d.rowId, d.columnId, d.newValue)
        }
        d.checklistIds = await addChecklist(d.rowId, d.checklistTemplateId)
      }
      await opts.onUndone?.()
    },
  })
  return done
}
