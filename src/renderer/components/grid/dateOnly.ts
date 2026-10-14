/**
 * "Show only the date" on a date column with a deadline rule: the deadline
 * words go in the tooltip, not the cell. On unless the column turned it off,
 * so only an explicit false is off.
 */
export function dateOnlyOn(config: { date_only?: unknown } | null | undefined): boolean {
  return config?.date_only !== false
}
