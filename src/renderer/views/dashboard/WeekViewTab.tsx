import React, { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { LoadingOverlay } from '../../components/shared/LoadingSpinner'
import { SecondaryButton } from '../../components/ui/Button'
import { ymdLocalDate } from '../../../shared/dates'
import { assertNever } from '../../../shared/assertNever'
import type { PriorityItem } from './types'
import { itemDaysUntil } from './tabCounts'
import { DeadlineRow } from './DeadlineRow'

/** A long window draws its soonest items first, like What's due (UX pass Q9b) */
const FIRST_ITEMS_SHOWN = 100

export interface DueWindowProps {
  /** The tab's rows, already filtered by the window (tabCounts.ts), soonest first */
  items: PriorityItem[]
  /** Today, YYYY-MM-DD (useToday) */
  today: string
  isLoading: boolean
  /** After Done: drop the row and reload */
  onMarkDone?: (rowId: number, columnId: number) => void
  onUndone?: () => Promise<void>
}

/** "Oct 14": a handful of headings, so a formatter per call is fine */
const monthDay = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function addDays(base: Date, n: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

/**
 * The rows of a "Next N days" tab, under a heading per day or per seven days.
 * Groups come from days-until, so a day is a local calendar day.
 */
export function DueWindowList({ items, today, isLoading, onMarkDone, onUndone, groupDays, title, testId, emptyText }: DueWindowProps & {
  /** 1: a heading per day; 7: a heading per seven days from today */
  groupDays: 1 | 7
  title: string
  testId: string
  emptyText: string
}): React.ReactElement {
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(false)
  const shown = useMemo(() => showAll ? items : items.slice(0, FIRST_ITEMS_SHOWN), [items, showAll])

  const groups = useMemo(() => {
    const start = ymdLocalDate(today)
    const out: Array<{ key: number; label: string; isToday: boolean; items: PriorityItem[] }> = []
    for (const item of shown) {
      const key = Math.floor(Math.max(0, itemDaysUntil(item)) / groupDays)
      let g = out[out.length - 1]
      if (!g || g.key !== key) {
        const first = addDays(start, key * groupDays)
        const label = groupDays === 1
          ? first.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
          : `${monthDay(first)} – ${monthDay(addDays(first, groupDays - 1))}`
        g = { key, label, isToday: groupDays === 1 && key === 0, items: [] }
        out.push(g)
      }
      g.items.push(item)
    }
    return out
  }, [shown, today, groupDays])

  if (isLoading) return <LoadingOverlay label={`Loading ${title.toLowerCase()}…`} />

  const rowButton = 'w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500'

  function renderItem(item: PriorityItem, i: number): React.ReactNode {
    switch (item.kind) {
      case 'deadline': {
        const d = item.data
        // The same row as What's due: Done, Extend, Renew (D-22)
        return (
          <div key={`dl-${d.rowId}-${d.columnId}-${i}`} data-due-item role="list" className="rounded-lg bg-slate-50 dark:bg-slate-700/40 overflow-hidden">
            <DeadlineRow deadline={d} onMarkDone={onMarkDone ?? (() => {})} onUndoneMarkDone={onUndone} />
          </div>
        )
      }
      case 'task': {
        const t = item.data
        return (
          // Buttons, so the keyboard can open them too (Q-053)
          <button key={`task-${t.id}`} data-due-item type="button" className={rowButton} onClick={() => navigate('/tasks')}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-purple-400" />
            <span className="flex-1 min-w-0">
              <span className="font-medium text-slate-800 dark:text-slate-100">{t.title}</span>
              <span className="text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-sm ml-2">task</span>
            </span>
            {t.category && <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{t.category}</span>}
          </button>
        )
      }
      case 'checklist': {
        const ci = item.data
        return (
          <button key={`cl-${ci.id}`} data-due-item type="button" className={rowButton} onClick={() => navigate(`/profile/${ci.row_id}?gridId=${ci.grid_id}`)}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-teal-400" />
            <span className="flex-1 min-w-0">
              <span className="font-medium text-slate-800 dark:text-slate-100">{ci.title}</span>
              <span className="text-sm bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded-sm ml-2">checklist</span>
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{ci.client_name} &middot; {ci.grid_name}</span>
          </button>
        )
      }
      case 'followup': {
        const f = item.data
        return (
          <button key={`fu-${f.id}`} data-due-item type="button" className={rowButton} onClick={() => navigate(`/profile/${f.row_id}?gridId=${f.grid_id}`)}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-amber-400" />
            <span className="flex-1 min-w-0">
              <span className="font-medium text-slate-800 dark:text-slate-100">{f.client_name}</span>
              <span className="text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-sm ml-2">follow-up</span>
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{f.grid_name}</span>
          </button>
        )
      }
      default:
        return assertNever(item)
    }
  }

  return (
    <div className="p-4" data-testid={testId}>
      <h2 className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-blue-500" />
        {title}
      </h2>
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500 dark:text-slate-400">
          <Clock className="w-10 h-10 opacity-40" />
          <p className="text-base">{emptyText}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.key}>
              <h3 className={`text-sm font-semibold mb-2 uppercase tracking-wide ${g.isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {g.isToday ? `Today · ${g.label}` : g.label}
              </h3>
              <div className="space-y-1">{g.items.map(renderItem)}</div>
            </div>
          ))}
          {shown.length < items.length && (
            <div className="flex items-center gap-3 pt-3 flex-wrap border-t border-slate-200 dark:border-slate-700">
              <p className="flex-1 min-w-0 text-base text-slate-600 dark:text-slate-300">
                Showing the soonest {shown.length.toLocaleString()} of {items.length.toLocaleString()}.
              </p>
              <SecondaryButton size="compact" onClick={() => setShowAll(true)}>Show all {items.length.toLocaleString()}</SecondaryButton>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The "Next 7 days" tab: today through a week from today, a heading per day */
export function WeekViewTab(props: DueWindowProps): React.ReactElement {
  return <DueWindowList {...props} groupDays={1} title="Next 7 days" testId="week-view" emptyText="Nothing due in the next 7 days." />
}
