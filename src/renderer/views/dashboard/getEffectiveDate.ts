import type { ExtendedDeadlineInfo } from './types'
import { computeEffectiveDeadline } from '../../utils/deadlineCalc'
import { ymdToDate } from '../../../shared/deadlineEngine'

/** The deadline's due date: the engine's, or (older data) the rule's interval from the stored date. */
export function getEffectiveDate(d: ExtendedDeadlineInfo): Date | null {
  if (d.due) return ymdToDate(d.due)
  return computeEffectiveDeadline(d.dateValue, d.interval ?? d.intervalDays)
}
