/**
 * The ways into a grid cell's deadline card (UX pass Q3): a click on the
 * cell's deadline shape, a click in a Deadline column's cell, Space, and
 * "Mark done or extend…" in the cell's menu. They all send one event, so the
 * grid's rows take no new props (SortableRow's memo stays as it is).
 */
import type { Column } from '../../../shared/types'
import { takesDeadlineRule } from '../../../shared/types'
import { pulseEvents } from '../../events'

/** A date or Deadline column with a deadline rule attached */
export function columnHasDeadlineRule(col: Pick<Column, 'column_type' | 'config'> | undefined): boolean {
  if (!col || !takesDeadlineRule(col.column_type)) return false
  try { return (JSON.parse(col.config || '{}') as { alert_rule_id?: number }).alert_rule_id != null } catch { return false }
}

export function openDeadlineCard(rowId: number, columnId: number, anchor?: HTMLElement | null): void {
  pulseEvents.emit('deadline:open-card', { rowId, columnId, anchor })
}
