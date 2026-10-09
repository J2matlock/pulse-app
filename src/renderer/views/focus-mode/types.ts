import type { CaseloadTask, UrgentChecklistItem } from '../../../shared/types'

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
