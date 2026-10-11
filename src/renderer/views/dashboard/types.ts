import type { DeadlineInfo, CaseloadTask, ChecklistDueItem } from '../../../shared/types'
import type { RuleInterval } from '../../../shared/ruleInterval'
import type { RuleKind, DeadlineState, MeterInfo } from '../../../shared/deadlineEngine'

export interface FollowUpRow {
  id: number
  row_id: number
  content: string
  follow_up_date: string
  grid_id: number
  grid_name: string
  client_name: string | null
}

// Raw row from DASHBOARD_GET_DEADLINES query
export interface RawDeadlineRow {
  row_id: number
  grid_id: number
  grid_name: string
  column_id: number
  column_name: string
  column_config: string
  date_value: string
  client_name: string | null
  /** Worked out by the shared engine in main (W05) */
  due?: string | null
  daysUntil?: number | null
  detail?: string
  rule_kind?: RuleKind
  /** Sequence rules: the step that's due */
  step?: number
  state?: DeadlineState
  label?: string
  /** Meter rules: unit and readings on file */
  meter?: MeterInfo
  /** The extension in effect (W05) */
  extension_id?: number
  extended?: { from: string; reason: string }
}

export interface ArchivedRow {
  id: number
  grid_id: number
  archived_at: string | null
  archived_reason: string | null
  grid_name: string
  client_name: string | null
}

export interface ExtendedDeadlineInfo extends DeadlineInfo {
  intervalDays: number | null
  /** Full rule interval (days, or calendar months, end-of-month) */
  interval?: RuleInterval
  /** Checklist template added to the client when marked done (column setting) */
  checklistTemplateId?: number | null
  /** Due date from the engine ('YYYY-MM-DD') */
  due?: string
  /** Plain-English explanation from the engine */
  detail?: string
  /** How the rule works, so marking done does the right thing */
  ruleKind?: RuleKind
  /** Sequence rules: the step that's due */
  step?: number
  /** The extension in effect, so it can be removed */
  extensionId?: number
  /** The engine's state and short status ("All 12 used", "IFSP meeting (step 1 of 4)") */
  state?: DeadlineState
  label?: string
  meter?: MeterInfo
}

export type TopTab = 'priority' | 'overdue' | 'week' | 'month' | 'archived'

export type PriorityItem =
  | { kind: 'deadline'; data: ExtendedDeadlineInfo; sortKey: number }
  | { kind: 'task'; data: CaseloadTask; daysUntil: number; sortKey: number }
  | { kind: 'checklist'; data: ChecklistDueItem; daysUntil: number; sortKey: number }
  | { kind: 'followup'; data: FollowUpRow; daysUntil: number; sortKey: number }
