/**
 * Reading a number out of a cell the way people type it: "$1,234.50",
 * "12 000", "-3.5". Used wherever a stored value is counted or compared
 * (deadline meters and limits, reports, number history), so they all agree.
 */

const NUMBER_RE = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/

/** The number in a cell, or null when it's empty or isn't a number ("TBD", a lone "$") */
export function parseNumberCell(value: string | null | undefined): number | null {
  if (value == null) return null
  const cleaned = value.replace(/[$,\s]/g, '')
  if (!NUMBER_RE.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
