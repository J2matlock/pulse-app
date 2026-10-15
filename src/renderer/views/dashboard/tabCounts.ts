/**
 * What the Overdue, Next 7 days and Next 30 days tabs show (persona study R6).
 * The tabs filter with these and count what they filter, and the tiles count
 * the same items with `countDue` (shared/deadlineTiles.ts), so a tile, its tab's
 * label and the rows under it are always one number. The calendar week and
 * month are the Calendar page's; here the windows roll from today.
 */
import type { CaseloadTask, ChecklistDueItem } from '../../../shared/types'
import { NEXT_DAYS, dueWithin, isLateDeadline, type DueWindow } from '../../../shared/deadlineTiles'
import type { ExtendedDeadlineInfo, FollowUpRow, PriorityItem } from './types'

export const itemDaysUntil = (item: PriorityItem): number => item.kind === 'deadline' ? item.data.daysUntil : item.daysUntil
const dueLike = (item: PriorityItem) => item.kind === 'deadline' ? item.data : { daysUntil: item.daysUntil }

/** Late, or a used-up quota: the Overdue tile and tab */
export const isLateItem = (item: PriorityItem): boolean => isLateDeadline(dueLike(item))

/** Due from today through the window's last day, not late */
export const inWindow = (item: PriorityItem, which: DueWindow): boolean => dueWithin(dueLike(item), NEXT_DAYS[which])

/**
 * Everything with a date the dashboard counts, soonest first: every deadline
 * (whatever its color rules say), tasks with a due date, checklist items and
 * follow-ups. A task with no due date is on What's due but in no window.
 */
export function datedItems(input: {
  deadlines: ExtendedDeadlineInfo[]
  tasksWithDays: Array<{ task: CaseloadTask; daysUntil: number }>
  checklistWithDays: Array<{ item: ChecklistDueItem; daysUntil: number }>
  followUpsWithDays: Array<{ followUp: FollowUpRow; daysUntil: number }>
}): PriorityItem[] {
  const items: PriorityItem[] = []
  for (const d of input.deadlines) items.push({ kind: 'deadline', data: d, sortKey: d.daysUntil })
  for (const { task, daysUntil } of input.tasksWithDays) { if (task.due_date) items.push({ kind: 'task', data: task, daysUntil, sortKey: daysUntil }) }
  for (const { item, daysUntil } of input.checklistWithDays) items.push({ kind: 'checklist', data: item, daysUntil, sortKey: daysUntil })
  for (const { followUp, daysUntil } of input.followUpsWithDays) items.push({ kind: 'followup', data: followUp, daysUntil, sortKey: daysUntil })
  return items.sort((a, b) => a.sortKey - b.sortKey)
}

export interface WindowTabs { overdue: PriorityItem[]; next7: PriorityItem[]; next30: PriorityItem[] }

/** The three tabs' rows, in one pass */
export function windowTabs(dated: PriorityItem[]): WindowTabs {
  const out: WindowTabs = { overdue: [], next7: [], next30: [] }
  for (const it of dated) {
    if (isLateItem(it)) { out.overdue.push(it); continue }
    if (inWindow(it, 'next7')) out.next7.push(it)
    if (inWindow(it, 'next30')) out.next30.push(it)
  }
  return out
}

/** How many records the items are about (a task belongs to no record) */
export function recordsIn(items: PriorityItem[]): number {
  const rows = new Set<number>()
  for (const it of items) {
    if (it.kind === 'deadline') rows.add(it.data.rowId)
    else if (it.kind === 'checklist' || it.kind === 'followup') rows.add(it.data.row_id)
  }
  return rows.size
}
