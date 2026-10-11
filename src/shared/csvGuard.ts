/**
 * The CSV formula guard, shared by every CSV export and by import (which undoes it),
 * so the two can't drift apart.
 */

/**
 * Whether a spreadsheet could read this text as a formula: it starts with
 * = + - @ TAB or CR (OWASP's list), a later line starts with = + - @ (for
 * readers that split multi-line cells), or it already starts with the guard
 * apostrophe in front of such text (so a typed "'=x" survives a round trip).
 */
function looksLikeFormula(v: string): boolean {
  if (/^[=+\-@\t\r]/.test(v)) return true
  if (/\r?\n[=+\-@]/.test(v)) return true
  return v.startsWith("'") && looksLikeFormula(v.slice(1))
}

/**
 * Prevent CSV formula injection (AUDIT-037). Excel/LibreOffice treat cells starting
 * with = + - @ as formulas. OWASP's guard is a single leading apostrophe, which
 * Excel hides and which leading-whitespace trimming can't remove (a TAB could be).
 * Pulse's own import takes it off again (unguardCsvFormula).
 */
export function sanitizeCsvFormula(v: string): string {
  return looksLikeFormula(v) ? `'${v}` : v
}

/**
 * The exact reverse of sanitizeCsvFormula, for Pulse's own import: drops one leading
 * apostrophe only when what follows is something the export would have guarded.
 * A name like "'Til" keeps its apostrophe.
 */
export function unguardCsvFormula(v: string): string {
  return v.startsWith("'") && looksLikeFormula(v.slice(1)) ? v.slice(1) : v
}
