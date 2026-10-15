// @vitest-environment jsdom
/**
 * The fixed "how soon" tiers (D-028) on the dashboard rows and Focus Mode's
 * task row: the words and colors for late, today, this week, this month and
 * later, pinned per row kind before they share one module (Phase 3.2).
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { TaskRow } from '../../../../src/renderer/views/dashboard/TaskRow'
import { ChecklistDueRow } from '../../../../src/renderer/views/dashboard/ChecklistDueRow'
import { FollowUpDashRow } from '../../../../src/renderer/views/dashboard/FollowUpDashRow'
import { DeadlineRow } from '../../../../src/renderer/views/dashboard/DeadlineRow'
import { TaskFocusItem } from '../../../../src/renderer/views/focus-mode/TaskFocusItem'
import type { CaseloadTask, ChecklistDueItem } from '../../../../src/shared/types'
import type { ExtendedDeadlineInfo, FollowUpRow } from '../../../../src/renderer/views/dashboard/types'

const DAYS = [-3, -1, 0, 1, 7, 8, 30, 31]

const task: CaseloadTask = {
  id: 1, title: 'Call the school', description: null, category: null, priority: 'normal', due_date: '2026-10-20',
  is_completed: 0, completed_at: null, grid_id: null, position: 0, recurrence_rule: null, snoozed_until: null,
  created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00',
} as CaseloadTask

const checklist = {
  id: 3, row_id: 9, title: 'Home visit', client_name: 'Maria', grid_id: 1, grid_name: 'Caseload',
  due_date: '2026-10-20', priority: 'normal', is_completed: 0, recurrence_rule: null,
} as ChecklistDueItem

const followUp: FollowUpRow = { id: 4, row_id: 9, content: 'Check in', follow_up_date: '2026-10-20', grid_id: 1, grid_name: 'Caseload', client_name: 'Maria' }

function deadline(daysUntil: number): ExtendedDeadlineInfo {
  return {
    rowId: 9, clientName: 'Maria', gridId: 1, gridName: 'Caseload', columnId: 5, columnName: 'Review',
    dateValue: '2026-10-01', daysUntil, alertRuleId: null, threshold: null, intervalDays: null,
  }
}

/** The urgency words, their classes and the colored bar's classes */
function tierOf(container: HTMLElement): { label: string; text: string; bar: string } {
  const label = [...container.querySelectorAll('div.tabular-nums')].at(-1)
  const bar = container.querySelector('div.w-1')
  return { label: label?.textContent ?? '', text: label?.className ?? '', bar: bar?.className ?? '' }
}

function rows(make: (d: number) => React.ReactElement): Record<number, ReturnType<typeof tierOf>> {
  const out: Record<number, ReturnType<typeof tierOf>> = {}
  for (const d of DAYS) {
    const { container, unmount } = render(<MemoryRouter>{make(d)}</MemoryRouter>)
    out[d] = tierOf(container)
    unmount()
  }
  return out
}

describe('dashboard urgency tiers', () => {
  it('task rows', () => {
    expect(rows(d => <TaskRow task={task} daysUntil={d} onComplete={() => {}} />)).toMatchInlineSnapshot(`
      {
        "-1": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "1 day overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "-3": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "3 days overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "0": {
          "bar": "w-1 self-stretch rounded-full bg-red-400",
          "label": "Due today",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "1": {
          "bar": "w-1 self-stretch rounded-full bg-orange-400",
          "label": "1 day",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "30": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "30 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
        "31": {
          "bar": "w-1 self-stretch rounded-full bg-slate-200 dark:bg-slate-600",
          "label": "31 days",
          "text": "text-sm text-slate-500 dark:text-slate-400 tabular-nums",
        },
        "7": {
          "bar": "w-1 self-stretch rounded-full bg-orange-400",
          "label": "7 days",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "8": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "8 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
      }
    `)
  })

  it('checklist rows', () => {
    expect(rows(d => <ChecklistDueRow item={checklist} daysUntil={d} onComplete={() => {}} />)).toMatchInlineSnapshot(`
      {
        "-1": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "1 day overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "-3": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "3 days overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "0": {
          "bar": "w-1 self-stretch rounded-full bg-red-400",
          "label": "Due today",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "1": {
          "bar": "w-1 self-stretch rounded-full bg-orange-400",
          "label": "1 day",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "30": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "30 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
        "31": {
          "bar": "w-1 self-stretch rounded-full bg-slate-200 dark:bg-slate-600",
          "label": "31 days",
          "text": "text-sm text-slate-500 dark:text-slate-400 tabular-nums",
        },
        "7": {
          "bar": "w-1 self-stretch rounded-full bg-orange-400",
          "label": "7 days",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "8": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "8 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
      }
    `)
  })

  it('follow-up rows', () => {
    expect(rows(d => <FollowUpDashRow followUp={followUp} daysUntil={d} onComplete={() => {}} />)).toMatchInlineSnapshot(`
      {
        "-1": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "1 day overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "-3": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "3 days overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "0": {
          "bar": "w-1 self-stretch rounded-full bg-red-400",
          "label": "Due today",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "1": {
          "bar": "w-1 self-stretch rounded-full bg-orange-400",
          "label": "1 day",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "30": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "30 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
        "31": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "31 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
        "7": {
          "bar": "w-1 self-stretch rounded-full bg-orange-400",
          "label": "7 days",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "8": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "8 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
      }
    `)
  })

  it('deadline rows', () => {
    expect(rows(d => <DeadlineRow deadline={deadline(d)} />)).toMatchInlineSnapshot(`
      {
        "-1": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "1 day overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "-3": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "3 days overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "0": {
          "bar": "w-1 self-stretch rounded-full bg-red-500",
          "label": "Due today",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "1": {
          "bar": "w-1 self-stretch rounded-full bg-orange-400",
          "label": "1 day",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "30": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "30 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
        "31": {
          "bar": "w-1 self-stretch rounded-full bg-slate-200 dark:bg-slate-600",
          "label": "31 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
        "7": {
          "bar": "w-1 self-stretch rounded-full bg-orange-400",
          "label": "7 days",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "8": {
          "bar": "w-1 self-stretch rounded-full bg-yellow-400",
          "label": "8 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
      }
    `)
  })

  it('a used-up deadline reads as late, with its label when it has one', () => {
    const usedUp = (label?: string) => {
      const { container, unmount } = render(<MemoryRouter><DeadlineRow deadline={{ ...deadline(12), state: 'overdue', ...(label ? { label } : {}) }} /></MemoryRouter>)
      const t = tierOf(container)
      unmount()
      return t
    }
    expect(usedUp('All 12 used')).toEqual({ label: 'All 12 used', text: 'text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums', bar: 'w-1 self-stretch rounded-full bg-red-500' })
    expect(usedUp()).toEqual({ label: '12 days overdue', text: 'text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums', bar: 'w-1 self-stretch rounded-full bg-red-500' })
  })

  it('Focus Mode task rows', () => {
    const focus = (d: number) => <TaskFocusItem task={{ id: 1, title: 'Call', category: null, priority: 'normal', due_date: '2026-10-20', daysUntil: d }} celebrating={false} onComplete={() => {}} />
    expect(rows(focus)).toMatchInlineSnapshot(`
      {
        "-1": {
          "bar": "",
          "label": "1 day overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "-3": {
          "bar": "",
          "label": "3 days overdue",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "0": {
          "bar": "",
          "label": "Due today",
          "text": "text-sm text-red-600 dark:text-red-400 font-semibold tabular-nums",
        },
        "1": {
          "bar": "",
          "label": "1 day",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "30": {
          "bar": "",
          "label": "30 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
        "31": {
          "bar": "",
          "label": "31 days",
          "text": "text-sm text-slate-500 dark:text-slate-400 tabular-nums",
        },
        "7": {
          "bar": "",
          "label": "7 days",
          "text": "text-sm text-orange-700 dark:text-orange-400 tabular-nums",
        },
        "8": {
          "bar": "",
          "label": "8 days",
          "text": "text-sm text-yellow-700 dark:text-yellow-400 tabular-nums",
        },
      }
    `)
  })
})
