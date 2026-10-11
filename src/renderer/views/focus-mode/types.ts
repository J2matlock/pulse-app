import type { CaseloadTask, UrgentChecklistItem } from '../../../shared/types'
import type { RuleKind, MeterInfo } from '../../../shared/deadlineEngine'
import type { RuleInterval } from '../../../shared/ruleInterval'

export interface RawDeadlineRow {
  row_id: number
  grid_id: number
  grid_name: string
  column_id: number
  column_name: string
  column_config: string
  date_value: string
  client_name: string | null
  interval_days: number | null
  interval_months?: number | null
  end_of_month?: number | null
  alert_thresholds: string | null
  /** Worked out by the shared engine in main (W05) */
  due?: string | null
  daysUntil?: number | null
  rule_kind?: RuleKind
  /** Sequence step that's due, and its label ("IFSP meeting (step 1 of 4)") */
  step?: number
  label?: string
  meter?: MeterInfo
}

export interface FocusItem {
  id: string
  rowId: number
  columnId: number
  clientName: string
  label: string
  subLabel?: string
  urgency: 'overdue' | 'today' | 'upcoming'
  type: 'client'
  daysUntil: number
  dueDateStr: string
  dateValue: string
  gridId: number
  columnName: string
  /** How the rule works, so Done does the right thing (repeat, step, reading, renew) */
  ruleKind: RuleKind
  interval: RuleInterval
  step?: number
  checklistTemplateId: number | null
  meter?: MeterInfo
  /** The engine's due date ('YYYY-MM-DD') */
  dueYmd: string | null
}

export interface FocusTask {
  id: number
  title: string
  category: string | null
  priority: CaseloadTask['priority']
  due_date: string | null
  daysUntil: number
}

export interface FocusFollowUp {
  id: number
  rowId: number
  clientName: string
  gridName: string
  content: string
  followUpDate: string
  daysUntil: number
}

export type { UrgentChecklistItem }
