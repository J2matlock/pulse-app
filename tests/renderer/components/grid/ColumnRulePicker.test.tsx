// @vitest-environment jsdom
/** The rule window explains its "only when" condition and opens on Close (persona study R4). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })) }, writable: true, configurable: true })

import { ColumnRuleDialog, conditionCounts } from '../../../../src/renderer/components/grid/ColumnRulePicker'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { setWords } from '../../vocabFixture'
import type { Column, GridRow, ParsedAlertRule } from '../../../../src/shared/types'

const columns = [
  { id: 3, grid_id: 1, name: 'Background check', column_type: 'date', config: '{}' },
  { id: 4, grid_id: 1, name: 'Needs background check', column_type: 'dropdown', config: '{}' },
] as Column[]

const rule = (whenFalse: 'hide' | 'pause' = 'hide', op = 'is') => ({
  id: 5, name: 'Background check every 2 years', description: null, is_system: 0, interval_days: null, interval_months: 24, created_at: '',
  thresholds: [{ daysBefore: 30, bgClass: '#facc15', label: 'Due soon' }, { daysBefore: -1, bgClass: '#dc2626', label: 'Overdue' }],
  rule_condition: JSON.stringify({ columnId: 4, op, ...(op === 'is' ? { values: ['Yes'] } : {}), whenFalse }),
}) as unknown as ParsedAlertRule

const row = (id: number, needs: string | null, active: 0 | 1 = 1) =>
  ({ row_id: id, position: id, is_active: active, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_4: needs }) as GridRow

beforeEach(() => {
  setWords()
  useGridStore.setState({ rows: [row(1, 'Yes'), row(2, ''), row(3, null), row(4, 'No'), row(5, 'yes'), row(6, 'No', 0)] })
})

const open = (r: ParsedAlertRule | undefined) => render(
  <ColumnRuleDialog column={columns[0]!} allColumns={columns} currentAlertRule={r} fittingRules={r ? [r] : []} otherListRules={[]}
    onSetRule={vi.fn()} onNewRule={vi.fn()} onClose={vi.fn()} />)

describe('ColumnRuleDialog', () => {
  it('counts the records that match, are blank (counted anyway) and don\'t match', () => {
    open(rule())
    expect(screen.getByTestId('rule-condition-counts').textContent).toBe(
      'Only for clients whose Needs background check is Yes. Right now: 2 match, 2 are blank (counted anyway), 1 doesn\'t match (no color).')
  })

  it('says "paused" for a rule that pauses, and leaves blanks out of "is blank" conditions', () => {
    open(rule('pause'))
    expect(screen.getByTestId('rule-condition-counts').textContent).toMatch(/1 doesn't match \(paused\)\.$/)
    expect(conditionCounts({ columnId: 4, op: 'empty', whenFalse: 'hide' }, useGridStore.getState().rows)).toEqual({ match: 2, blank: 0, noMatch: 3 })
  })

  it('has no condition line for a rule without one', () => {
    open({ ...rule(), rule_condition: null } as unknown as ParsedAlertRule)
    expect(screen.queryByTestId('rule-condition-counts')).toBeNull()
  })

  it('opens with focus on Close, and Remove comes after the other rules', async () => {
    open(rule())
    const close = screen.getByText('Close', { selector: 'button' })
    await waitFor(() => expect(document.activeElement).toBe(close))
    const remove = screen.getByRole('button', { name: 'Remove from this column' })
    const newRule = screen.getByRole('button', { name: 'New rule…' })
    expect(newRule.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
