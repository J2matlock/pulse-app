/** A deadline is called by what's due (persona study R6): "Appeal window", not "Appeal filed". */
import { describe, it, expect } from 'vitest'
import { deadlineLabel } from '../src/shared/deadlineLabel'

const anchored = { name: 'Appeal window', kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 12, offset: { months: 12, direction: 'after' } }) }

describe('deadlineLabel', () => {
  it('a rule worked out from another column is called by its own name; Done fills in the column', () => {
    expect(deadlineLabel(anchored, { name: 'Appeal filed' })).toEqual({ title: 'Appeal window', doneLabel: 'Appeal filed' })
  })

  it('an interval rule is its column', () => {
    expect(deadlineLabel({ name: 'Yearly', kind: 'interval', rule_config: null }, { name: 'Annual review' }))
      .toEqual({ title: 'Annual review', doneLabel: 'Annual review' })
  })

  it("a relative rule on the column's own date is its column", () => {
    const self = { ...anchored, rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 'self', offset: { days: 90, direction: 'after' } }) }
    expect(deadlineLabel(self, { name: 'Intake' }).title).toBe('Intake')
  })

  it('no rule, unreadable settings or a blank name fall back to the column', () => {
    expect(deadlineLabel(null, { name: 'Review' }).title).toBe('Review')
    expect(deadlineLabel({ ...anchored, rule_config: '{not json' }, { name: 'Appeal filed' }).title).toBe('Appeal filed')
    expect(deadlineLabel({ ...anchored, name: '  ' }, { name: 'Appeal filed' }).title).toBe('Appeal filed')
  })
})
