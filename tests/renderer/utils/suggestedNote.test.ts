/** The note a record's page suggests when a contact-like deadline is late (UX pass Q2). */
import { describe, it, expect, vi } from 'vitest'
import type { Column, GridRow, ParsedAlertRule } from '../../../src/shared/types'

// The engine is tested on its own; here a cell's value says what it answers:
// "late:12" → 12 days late, "soon" → in 5 days, "done:4" / "paused:4" → 4 days past but done or paused
vi.mock('../../../src/renderer/utils/deadlineCalc', () => ({
  evaluateRuleForRow: (_rule: unknown, value: string | null) => {
    const [what, n] = (value ?? '').split(':')
    if (what === 'late') return { state: 'overdue', daysUntil: -Number(n) }
    if (what === 'done') return { state: 'done', daysUntil: -Number(n) }
    if (what === 'paused') return { state: 'paused', daysUntil: -Number(n) }
    if (what === 'soon') return { state: 'upcoming', daysUntil: 5 }
    return { state: 'none', daysUntil: null }
  },
}))

import { suggestedNote, namesType } from '../../../src/renderer/utils/suggestedNote'

const rule = { id: 9, name: 'Monthly', thresholds: [], interval_days: 30, kind: 'interval' } as unknown as ParsedAlertRule
const rules = new Map([[9, rule]])
const col = (id: number, name: string, config: Record<string, unknown> = { alert_rule_id: 9 }) =>
  ({ id, name, column_type: 'date', config: JSON.stringify(config), is_name_column: 0 } as unknown as Column)
const row = (values: Record<number, string>) => ({ row_id: 1, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [`col_${k}`, v])) } as unknown as GridRow)

const TYPES = [
  { key: 'note', label: 'Note' }, { key: 'phone', label: 'Phone' }, { key: 'visit', label: 'Visit' }, { key: 'no_show', label: 'Missed' },
]

describe('suggestedNote', () => {
  it("the column's own note types win over a match on its name", () => {
    const cols = [col(2, 'Last Phone Contact', { alert_rule_id: 9, note_updates: ['visit'] })]
    expect(suggestedNote(row({ 2: 'late:12' }), cols, rules, TYPES)).toEqual({ typeKey: 'visit', columnName: 'Last Phone Contact', daysLate: 12 })
  })

  it('a column named after a type picks it, on whole words only', () => {
    expect(suggestedNote(row({ 2: 'late:3' }), [col(2, 'Last Visit')], rules, TYPES)?.typeKey).toBe('visit')
    expect(suggestedNote(row({ 2: 'late:3' }), [col(2, 'last phone contact')], rules, TYPES)?.typeKey).toBe('phone')
    expect(suggestedNote(row({ 2: 'late:3' }), [col(2, 'Visitation Review')], rules, TYPES)).toBeNull()
    expect(namesType('Last no show', { key: 'no_show', label: 'Missed' })).toBe(true)
    expect(namesType('Telephoned', { key: 'phone', label: 'Phone' })).toBe(false)
  })

  it('an archived type is skipped: the next note type of the column, else its name, else none', () => {
    const active = TYPES.filter(t => t.key !== 'visit')
    const cols = [col(2, 'Last Face-to-Face', { alert_rule_id: 9, note_updates: ['visit', 'phone'] })]
    expect(suggestedNote(row({ 2: 'late:5' }), cols, rules, active)?.typeKey).toBe('phone')
    // Only an archived type and no name match: the box still opens, with the remembered kind
    const only = [col(2, 'Last Face-to-Face', { alert_rule_id: 9, note_updates: ['visit'] })]
    expect(suggestedNote(row({ 2: 'late:5' }), only, rules, active)).toEqual({ typeKey: null, columnName: 'Last Face-to-Face', daysLate: 5 })
    expect(suggestedNote(row({ 2: 'late:5' }), [col(2, 'Last Visit')], rules, active)).toBeNull()
  })

  it('done or paused deadlines are not late, and neither is one still ahead', () => {
    for (const v of ['done:4', 'paused:4', 'soon', '']) expect(suggestedNote(row({ 2: v }), [col(2, 'Last Visit')], rules, TYPES), v).toBeNull()
  })

  it('an overdue deadline that no note meets (Annual Review) suggests nothing', () => {
    expect(suggestedNote(row({ 2: 'late:40' }), [col(2, 'Annual Review')], rules, TYPES)).toBeNull()
  })

  it('a column without a deadline rule never counts', () => {
    expect(suggestedNote(row({ 2: 'late:40' }), [col(2, 'Last Visit', { note_updates: ['visit'] })], rules, TYPES)).toBeNull()
  })

  it('the most overdue contact-like column wins, past a later non-contact one', () => {
    const cols = [col(2, 'Annual Review'), col(3, 'Last Phone Call'), col(4, 'Last Visit')]
    expect(suggestedNote(row({ 2: 'late:90', 3: 'late:4', 4: 'late:20' }), cols, rules, TYPES))
      .toEqual({ typeKey: 'visit', columnName: 'Last Visit', daysLate: 20 })
  })
})
