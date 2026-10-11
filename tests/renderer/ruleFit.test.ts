import { describe, it, expect } from 'vitest'
import { splitRulesByFit } from '../../src/renderer/components/alerts/ruleFit'
import type { ParsedAlertRule } from '../../src/shared/types'

const rule = (id: number, extra: Partial<ParsedAlertRule> = {}) =>
  ({ id, name: `R${id}`, description: null, is_system: 0, thresholds: [], interval_days: 30, created_at: '', ...extra }) as ParsedAlertRule

describe('which rules the column menu offers (D-10)', () => {
  it('offers rules that need no other columns, or only this list\'s', () => {
    const plain = rule(1)
    const here = rule(2, { kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 5, offset: { days: 7, direction: 'after' } }) })
    const elsewhere = rule(3, { kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 77, offset: { days: 7, direction: 'after' } }) })
    const condElsewhere = rule(4, { rule_condition: JSON.stringify({ columnId: 78, op: 'empty', whenFalse: 'hide' }) })
    const { fits, others } = splitRulesByFit([plain, here, elsewhere, condElsewhere], new Set([5, 6]))
    expect(fits.map(r => r.id)).toEqual([1, 2])
    expect(others.map(r => r.id)).toEqual([3, 4])
  })
})
