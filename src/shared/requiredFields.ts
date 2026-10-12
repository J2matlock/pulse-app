/**
 * Required fields (brainstorm B2): a column can be marked required; empty
 * cells then show "Missing" and appear in the Missing information report.
 */
import { columnTraits } from './columnTraits'

/** Computed and yes/no columns can't be "missing". */
export function canBeRequired(columnType: string): boolean {
  return columnTraits(columnType).requirable
}

export function isMissingValue(value: string | null | undefined): boolean {
  return value == null || value.trim() === ''
}
