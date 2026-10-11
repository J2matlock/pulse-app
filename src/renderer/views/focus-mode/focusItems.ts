import type { AlertThreshold } from '../../../shared/types'
import { toRuleInterval } from '../../../shared/ruleInterval'
import { ymdToDate } from '../../../shared/deadlineEngine'
import { getMatchingThreshold } from '../../utils/deadlineCalc'
import { wordNow } from '../../utils/vocab'
import type { RawDeadlineRow, FocusItem } from './types'

/**
 * Focus Mode's deadline list, straight from the engine's results (main works
 * out `due` and `daysUntil` for every kind of rule, with extensions and days
 * off). Shows what's late or due today, and anything a color threshold has
 * reached; at most 20.
 */
export function focusDeadlineItems(rows: RawDeadlineRow[]): FocusItem[] {
  return rows
    .flatMap(r => {
      if (!r.due || r.daysUntil === null || r.daysUntil === undefined) return []
      let thresholds: AlertThreshold[] = []
      try { thresholds = r.alert_thresholds ? JSON.parse(r.alert_thresholds) as AlertThreshold[] : [] } catch { /* ignore malformed */ }
      return [{ r, due: r.due, daysUntil: r.daysUntil, thresholds }]
    })
    .filter(x => x.daysUntil <= 0 || (x.thresholds.length > 0 && getMatchingThreshold(x.daysUntil, x.thresholds) !== undefined))
    .slice(0, 20)
    .map(({ r, due, daysUntil }) => {
      let checklistTemplateId: number | null = null
      try { checklistTemplateId = (JSON.parse(r.column_config || '{}') as { done_checklist_id?: number }).done_checklist_id ?? null } catch { /* none */ }
      return {
        id: `${r.row_id}-${r.column_id}`,
        rowId: r.row_id,
        gridId: r.grid_id,
        columnId: r.column_id,
        clientName: r.client_name ?? `Unknown ${wordNow('record', {}, r.grid_id)}`,
        label: r.label ? `${r.column_name}: ${r.label}` : r.column_name,
        columnName: r.column_name,
        subLabel: r.grid_name,
        urgency: daysUntil < 0 ? 'overdue' as const : daysUntil === 0 ? 'today' as const : 'upcoming' as const,
        type: 'client' as const,
        daysUntil,
        dueDateStr: ymdToDate(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
        dateValue: r.date_value,
        ruleKind: r.rule_kind ?? 'interval',
        interval: toRuleInterval(r),
        step: r.step,
        checklistTemplateId,
        meter: r.meter,
      }
    })
}
