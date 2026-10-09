/**
 * Required fields (brainstorm B2): a column can be marked required; empty
 * cells then show "Missing" and appear in the Missing information report.
 */

/** Computed and yes/no columns can't be "missing". */
export function canBeRequired(columnType: string): boolean {
  return !['checkbox', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count'].includes(columnType)
}

export function isMissingValue(value: string | null | undefined): boolean {
  return value == null || value.trim() === ''
}
