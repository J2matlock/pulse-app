/**
 * The dashboard's next step (UX pass Q2): one sentence about the whole
 * workload and the one thing to open first. Pure, so every branch is tested.
 *
 * Counts follow the Overdue tile and tab (`overdueItems` uses isLateDeadline),
 * so the banner, the tiles and the morning briefing never disagree. The
 * dashboard search doesn't filter it: pass the unsearched lists.
 */
import type { VocabKey, TermOptions } from '../../../shared/vocab'
import { daysOverdueLabel } from '../../../shared/deadlineTiles'
import { shortDate, ymdLocalDate } from '../../../shared/dates'
import { assertNever } from '../../../shared/assertNever'
import type { ExtendedDeadlineInfo, PriorityItem } from './types'

type Words = (key: VocabKey, opts?: TermOptions) => string

export type NextStepKind = 'overdue' | 'today' | 'next'

export interface NextStep {
  kind: NextStepKind
  /** The sentence about the workload ("3 deadlines are overdue.") */
  sentence: string
  /** overdue / today: the main button ("Start with Maria Garcia →"); next: the quieter link */
  action: string
  /** A muted second line about the first item ("Last Face-to-Face, 12 days overdue") */
  detail: string | null
  /** Where the button goes */
  path: string
}

export interface NextStepInput {
  overdueItems: PriorityItem[]
  /** Everything on "What's due", soonest first, without the dashboard search */
  priorityItems: PriorityItem[]
  t: Words
}

type Kind = PriorityItem['kind']

/** Singular and plural for each kind of item, in the order a sentence lists them */
const KIND_WORDS: Record<Kind, [string, string]> = {
  deadline: ['deadline', 'deadlines'],
  task: ['task', 'tasks'],
  checklist: ['checklist item', 'checklist items'],
  followup: ['follow-up', 'follow-ups'],
}
const KIND_ORDER: Kind[] = ['deadline', 'task', 'checklist', 'followup']

const countOf = (n: number, kind: Kind): string => `${n} ${KIND_WORDS[kind][n === 1 ? 0 : 1]}`

/** "a, b and c" */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Who or what the item is about: the record's name, or a task's title */
export function itemName(item: PriorityItem, t: Words): string {
  const unnamed = `Unnamed ${t('record')}`
  switch (item.kind) {
    case 'deadline': return item.data.clientName || unnamed
    case 'task': return item.data.title
    case 'checklist': return item.data.client_name ?? unnamed
    case 'followup': return item.data.client_name ?? unnamed
    default: return assertNever(item, 'dashboard item')
  }
}

/** Opens the item where the work is done: the record's page, or Tasks */
export function itemPath(item: PriorityItem): string {
  switch (item.kind) {
    case 'deadline': return `/profile/${item.data.rowId}?gridId=${item.data.gridId}`
    case 'task': return '/tasks'
    case 'checklist': return `/profile/${item.data.row_id}?gridId=${item.data.grid_id}`
    case 'followup': return `/profile/${item.data.row_id}?gridId=${item.data.grid_id}`
    default: return assertNever(item, 'dashboard item')
  }
}

/** What's due: "Appeal window" for a rule worked out from another column, else the column (deadlineLabel) */
const titleOf = (d: ExtendedDeadlineInfo): string => d.title ?? d.columnName

const daysUntilOf = (item: PriorityItem): number => item.kind === 'deadline' ? item.data.daysUntil : item.daysUntil

/** What the first item is and how late: "Last Face-to-Face, 12 days overdue", "Due Mar 3" */
function lateDetail(item: PriorityItem): string {
  const days = daysUntilOf(item)
  switch (item.kind) {
    case 'deadline':
      // A used-up quota is late whatever its end date says
      return days < 0 ? `${titleOf(item.data)}, ${daysOverdueLabel(days)}` : `${titleOf(item.data)}, ${item.data.label ?? 'all used'}`
    case 'task':
      return item.data.due_date ? `Due ${shortDate(ymdLocalDate(item.data.due_date))}` : 'Overdue'
    case 'checklist':
      return `${item.data.title}, ${daysOverdueLabel(days)}`
    case 'followup':
      return `Follow-up, ${daysOverdueLabel(days)}`
    default:
      return assertNever(item, 'dashboard item')
  }
}

/** What the item is, for "today" and "next": the deadline's column or the checklist item */
function whatOf(item: PriorityItem): string | null {
  switch (item.kind) {
    case 'deadline': return titleOf(item.data)
    case 'task': return null
    case 'checklist': return item.data.title
    case 'followup': return 'Follow-up'
    default: return assertNever(item, 'dashboard item')
  }
}

function overdueSentence(items: PriorityItem[], t: Words): string {
  const n = items.length
  const kinds = KIND_ORDER.filter(k => items.some(i => i.kind === k))
  if (kinds.length > 1) {
    const parts = kinds.map(k => countOf(items.filter(i => i.kind === k).length, k))
    return `${n} things are overdue: ${joinAnd(parts)}.`
  }
  const kind = kinds[0] ?? 'deadline'
  if (kind === 'deadline') {
    const columns = new Set(items.map(i => i.kind === 'deadline' ? titleOf(i.data) : ''))
    if (columns.size === 1) {
      const first = items[0]
      const column = first?.kind === 'deadline' ? titleOf(first.data) : ''
      return `${column} is overdue for ${n} ${t('record', { count: n })}.`
    }
    // Deadlines and records are both counted somewhere (the list's Overdue button counts
    // records): say both when they differ (persona study R6)
    const records = new Set(items.map(i => i.kind === 'deadline' ? i.data.rowId : 0)).size
    if (records !== n) return `${countOf(n, kind)} are overdue, for ${records} ${t('record', { count: records })}.`
  }
  return `${countOf(n, kind)} ${n === 1 ? 'is' : 'are'} overdue.`
}

export function nextStep({ overdueItems, priorityItems, t }: NextStepInput): NextStep | null {
  const firstLate = overdueItems[0]
  if (firstLate) {
    return {
      kind: 'overdue',
      sentence: overdueSentence(overdueItems, t),
      action: `Start with ${itemName(firstLate, t)} →`,
      detail: lateDetail(firstLate),
      path: itemPath(firstLate),
    }
  }

  const dueToday = priorityItems.filter(i => daysUntilOf(i) === 0)
  const firstToday = dueToday[0]
  if (firstToday) {
    return {
      kind: 'today',
      sentence: `${dueToday.length} due today.`,
      action: `Start with ${itemName(firstToday, t)} →`,
      detail: whatOf(firstToday),
      path: itemPath(firstToday),
    }
  }

  const upcoming = priorityItems.find(i => daysUntilOf(i) > 0)
  if (upcoming) {
    const days = daysUntilOf(upcoming)
    // A task with no due date sorts last (9999 days): say nothing about when
    const when = upcoming.kind === 'task' && !upcoming.data.due_date ? null : `in ${days} day${days === 1 ? '' : 's'}`
    const what = [whatOf(upcoming), when].filter(Boolean).join(' ')
    return {
      kind: 'next',
      sentence: 'Nothing overdue or due today.',
      action: `Next: ${itemName(upcoming, t)}${what ? `, ${what}` : ''} →`,
      detail: null,
      path: itemPath(upcoming),
    }
  }
  return null
}
