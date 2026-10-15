/**
 * The dashboard's next step (UX pass Q2): one sentence and one thing to open.
 */
import { describe, it, expect } from 'vitest'
import { nextStep } from '../../../../src/renderer/views/dashboard/nextStep'
import type { PriorityItem, ExtendedDeadlineInfo } from '../../../../src/renderer/views/dashboard/types'
import { GENERIC_VOCAB, HUMAN_SERVICES_VOCAB, term, type Vocab, type VocabKey, type TermOptions } from '../../../../src/shared/vocab'
import type { CaseloadTask, ChecklistDueItem } from '../../../../src/shared/types'

const words = (v: Vocab) => (key: VocabKey, opts?: TermOptions) => term(v, key, opts)
const hs = words(HUMAN_SERVICES_VOCAB)
const CAR_SHOP: Vocab = {
  ...GENERIC_VOCAB,
  record: { one: 'customer', many: 'customers', article: 'a' },
  list: { one: 'shop', many: 'shops', article: 'a' },
}
const shop = words(CAR_SHOP)

function deadline(name: string, column: string, daysUntil: number, extra: Partial<ExtendedDeadlineInfo> = {}): PriorityItem {
  const data: ExtendedDeadlineInfo = {
    rowId: 7, clientName: name, gridId: 3, gridName: 'Main', columnId: 11, columnName: column, dateValue: '2026-01-01',
    daysUntil, alertRuleId: 1, threshold: { daysBefore: 0, bgClass: 'alert-red', label: 'Late' }, intervalDays: 30, ...extra,
  }
  return { kind: 'deadline', data, sortKey: daysUntil }
}
function task(title: string, daysUntil: number, due: string | null = '2026-03-03'): PriorityItem {
  const data = { id: 5, title, due_date: due, grid_id: null } as CaseloadTask
  return { kind: 'task', data, daysUntil, sortKey: daysUntil }
}
function checklist(name: string, title: string, daysUntil: number): PriorityItem {
  const data = { id: 9, row_id: 8, grid_id: 4, client_name: name, grid_name: 'Main', title, due_date: '2026-03-01' } as ChecklistDueItem
  return { kind: 'checklist', data, daysUntil, sortKey: daysUntil }
}
function followUp(name: string | null, daysUntil: number): PriorityItem {
  return { kind: 'followup', data: { id: 2, row_id: 6, content: 'Call back', follow_up_date: '2026-03-01', grid_id: 2, grid_name: 'Main', client_name: name }, daysUntil, sortKey: daysUntil }
}

describe('nextStep', () => {
  it('one overdue column: names the column and counts the records', () => {
    const late = [deadline('Maria Garcia', 'Last Face-to-Face', -12), deadline('Ann Lee', 'Last Face-to-Face', -3), deadline('Bo Kim', 'Last Face-to-Face', -1)]
    const step = nextStep({ overdueItems: late, priorityItems: late, t: hs })!
    expect(step.kind).toBe('overdue')
    expect(step.sentence).toBe('Last Face-to-Face is overdue for 3 clients.')
    expect(step.action).toBe('Start with Maria Garcia →')
    expect(step.detail).toBe('Last Face-to-Face, 12 days overdue')
    expect(step.path).toBe('/profile/7?gridId=3')
  })

  it('one late record reads in the singular, in the workspace words', () => {
    const late = [deadline('Pat Smith', 'Oil change', -1)]
    const step = nextStep({ overdueItems: late, priorityItems: late, t: shop })!
    expect(step.sentence).toBe('Oil change is overdue for 1 customer.')
    expect(step.detail).toBe('Oil change, 1 day overdue')
    expect(step.sentence).not.toMatch(/client/i)
  })

  it('several overdue columns: counts the deadlines', () => {
    const late = [deadline('Maria', 'Annual Review', -20, { rowId: 1 }), deadline('Ann', 'Last Visit', -2, { rowId: 2 })]
    expect(nextStep({ overdueItems: late, priorityItems: late, t: hs })!.sentence).toBe('2 deadlines are overdue.')
  })

  it('calls a deadline by what is due when its rule says so (R6: "Appeal window", not "Appeal filed")', () => {
    const late = [deadline('Walt', 'Appeal filed', -3, { title: 'Appeal window' })]
    const step = nextStep({ overdueItems: late, priorityItems: late, t: hs })!
    expect(step.sentence).toBe('Appeal window is overdue for 1 client.')
    expect(step.detail).toBe('Appeal window, 3 days overdue')
  })

  it('says how many records too when some have more than one overdue (R6: 38 deadlines, 36 people)', () => {
    const late = [
      deadline('Maria', 'Annual Review', -20, { rowId: 1 }), deadline('Maria', 'Last Visit', -9, { rowId: 1 }),
      deadline('Ann', 'Last Visit', -2, { rowId: 2 }),
    ]
    expect(nextStep({ overdueItems: late, priorityItems: late, t: hs })!.sentence).toBe('3 deadlines are overdue, for 2 clients.')
    expect(nextStep({ overdueItems: late, priorityItems: late, t: shop })!.sentence).toBe('3 deadlines are overdue, for 2 customers.')
  })

  it('mixed kinds: lists only the kinds present', () => {
    const late = [deadline('Maria', 'Annual Review', -20), task('Send report', -4), task('Call payroll', -2), followUp('Ann', -1)]
    const step = nextStep({ overdueItems: late, priorityItems: late, t: hs })!
    expect(step.sentence).toBe('4 things are overdue: 1 deadline, 2 tasks and 1 follow-up.')
    expect(nextStep({ overdueItems: [deadline('M', 'X', -2), checklist('Ann', 'Consent form', -1)], priorityItems: [], t: hs })!.sentence)
      .toBe('2 things are overdue: 1 deadline and 1 checklist item.')
  })

  it('only tasks: counts the tasks, and a task opens Tasks with its due date', () => {
    const late = [task('Send report', -4)]
    const step = nextStep({ overdueItems: late, priorityItems: late, t: hs })!
    expect(step.sentence).toBe('1 task is overdue.')
    expect(step.action).toBe('Start with Send report →')
    expect(step.detail).toBe('Due Mar 3, 2026')
    expect(step.path).toBe('/tasks')
  })

  it('a used-up quota is overdue though its end date is ahead', () => {
    const late = [deadline('Maria', 'Visits this month', 10, { state: 'overdue', label: 'All 4 used' })]
    expect(nextStep({ overdueItems: late, priorityItems: late, t: hs })!.detail).toBe('Visits this month, All 4 used')
  })

  it('checklist items and follow-ups open the record; an unnamed record says so in its words', () => {
    expect(nextStep({ overdueItems: [checklist('Ann', 'Consent form', -2)], priorityItems: [], t: hs })!.path).toBe('/profile/8?gridId=4')
    const fu = nextStep({ overdueItems: [followUp(null, -1)], priorityItems: [], t: shop })!
    expect(fu.path).toBe('/profile/6?gridId=2')
    expect(fu.action).toBe('Start with Unnamed customer →')
    expect(fu.detail).toBe('Follow-up, 1 day overdue')
  })

  it('nothing late: what is due today comes first', () => {
    const items = [deadline('Maria', 'Last Visit', 0), task('Call payroll', 0), deadline('Ann', 'Review', 5)]
    const step = nextStep({ overdueItems: [], priorityItems: items, t: hs })!
    expect(step.kind).toBe('today')
    expect(step.sentence).toBe('2 due today.')
    expect(step.action).toBe('Start with Maria →')
    expect(step.detail).toBe('Last Visit')
  })

  it('nothing late or due today: a quieter link to what is next', () => {
    const step = nextStep({ overdueItems: [], priorityItems: [deadline('Ann', 'Review', 5), task('Later', 9)], t: hs })!
    expect(step.kind).toBe('next')
    expect(step.sentence).toBe('Nothing overdue or due today.')
    expect(step.action).toBe('Next: Ann, Review in 5 days →')
    expect(step.detail).toBeNull()
    expect(nextStep({ overdueItems: [], priorityItems: [task('Someday', 9999, null)], t: hs })!.action).toBe('Next: Someday →')
    expect(nextStep({ overdueItems: [], priorityItems: [task('Tomorrow', 1)], t: hs })!.action).toBe('Next: Tomorrow, in 1 day →')
  })

  it('nothing due at all: no step (the dashboard says what it is for instead)', () => {
    expect(nextStep({ overdueItems: [], priorityItems: [], t: hs })).toBeNull()
  })
})
