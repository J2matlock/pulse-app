/**
 * The SQL date math deadlines used before the W05 engine, frozen here as the
 * reference the parity tests compare the engine against. Not used by the app.
 */
/**
 * SQLite expression for the effective due date, matching addInterval().
 * `v` is the stored date expression; `r` is the alert_rules table alias.
 * (SQLite's own '+N months' spills Jan 31 into March, so months are clamped.)
 */
export function effectiveDateSql(v: string, r: string): string {
  const months = `COALESCE(${r}.interval_months, 0)`
  const monthMath = `date(date(${v}, 'start of month', '+' || ${months} || ' months'), '+' || (MIN(CAST(strftime('%d', ${v}) AS INTEGER), CAST(strftime('%d', date(${v}, 'start of month', '+' || (${months} + 1) || ' months', '-1 day')) AS INTEGER)) - 1) || ' days')`
  const dayMath = `date(${v}, '+' || COALESCE(${r}.interval_days, 0) || ' days')`
  const base = `(CASE WHEN ${months} > 0 THEN ${monthMath} ELSE ${dayMath} END)`
  return `(CASE WHEN COALESCE(${r}.end_of_month, 0) = 1 THEN date(${base}, 'start of month', '+1 month', '-1 day') ELSE ${base} END)`
}
