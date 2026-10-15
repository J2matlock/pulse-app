/**
 * The note a record's page suggests (UX pass Q2): when a contact-like deadline
 * ("Last Face-to-Face", "Last Visit") is late, the note box opens with the
 * kind of note that would bring it up to date already picked.
 *
 * Late is the engine's answer, the same as the grid's "Overdue" filter: a
 * negative daysUntil, and neither done nor paused. Only contact-like columns
 * count: one whose notes move its date (`note_updates`), or one named after a
 * note type. An overdue "Annual Review" isn't something a note does.
 */
import type { Column, GridRow, ParsedAlertRule } from '../../shared/types'
import type { ActivityType } from '../../shared/activityTypes'
import { ruleOfColumn } from './filterMatch'
import { evaluateRuleForRow } from './deadlineCalc'

export interface NoteSuggestion {
  /** The note type to pick, or null to keep the remembered one */
  typeKey: string | null
  columnName: string
  daysLate: number
}

/** The types a column's notes move it with (column setting "Notes update this date") */
function noteUpdatesOf(col: Column): string[] {
  try {
    const v = (JSON.parse(col.config || '{}') as { note_updates?: unknown }).note_updates
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "Last Visit" names Visit; "Visitation Review" doesn't (whole words, any case) */
export function namesType(columnName: string, type: Pick<ActivityType, 'key' | 'label'>): boolean {
  const words = [type.label, type.key.replace(/_/g, ' ')].map(w => w.trim()).filter(Boolean)
  return words.some(w => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(w)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(columnName))
}

export function suggestedNote(
  row: GridRow,
  columns: Column[],
  rulesById: Map<number, ParsedAlertRule>,
  activeTypes: Pick<ActivityType, 'key' | 'label'>[],
): NoteSuggestion | null {
  const activeKeys = new Set(activeTypes.map(t => t.key))
  let best: NoteSuggestion | null = null
  for (const col of columns) {
    const rule = ruleOfColumn(col, rulesById)
    if (!rule) continue
    const updates = noteUpdatesOf(col)
    const byName = activeTypes.find(t => namesType(col.name, t))
    if (updates.length === 0 && !byName) continue
    const value = row[`col_${col.id}` as keyof GridRow]
    const res = evaluateRuleForRow(rule, typeof value === 'string' ? value : null, row, col.id)
    if (res.state === 'done' || res.state === 'paused' || res.daysUntil === null || res.daysUntil >= 0) continue
    const daysLate = -res.daysUntil
    if (best && best.daysLate >= daysLate) continue
    // The column's own setting wins over a guess from its name; an archived type is skipped
    const typeKey = updates.find(k => activeKeys.has(k)) ?? byName?.key ?? null
    best = { typeKey, columnName: col.name, daysLate }
  }
  return best
}
