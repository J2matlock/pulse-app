// @vitest-environment jsdom
/** "Show only the date": a date with a deadline rule keeps its shape and color, its words go to the tooltip. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { deadlineCellInfo } from '../../../../src/renderer/components/grid/gridCellStyle'
import { cellFitText, showsOnlyDate } from '../../../../src/renderer/components/grid/CellDisplay'
import type { Column, GridRow, ParsedAlertRule, CellFormatRule } from '../../../../src/shared/types'
import { localDateString } from '../../../../src/shared/dates'
import { setWords } from '../../vocabFixture'

const rule = {
  id: 5, name: 'Review', description: null, is_system: 0, interval_days: null, created_at: '',
  thresholds: [
    { daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' },
    { daysBefore: -1, bgClass: '#dc2626', label: 'Overdue' },
  ],
} as unknown as ParsedAlertRule

const daysFromToday = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localDateString(d) }

function column(config: Record<string, unknown>): Column {
  return {
    id: 2, grid_id: 1, name: 'Review', column_type: 'date', position: 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: JSON.stringify(config), conditional_format: '[]',
    created_at: '2026-01-01T00:00:00Z',
  } as Column
}

function info(value: string, config: Record<string, unknown>) {
  const col = column(config)
  const row = { row_id: 1, col_2: value } as unknown as GridRow
  const configs = new Map<number, { config: Record<string, unknown>; conditionalFormat: CellFormatRule[] }>([[2, { config, conditionalFormat: [] }]])
  return deadlineCellInfo(col, value, row, configs, new Map([[5, rule]]), 'client')
}

beforeEach(() => { setWords() })

describe('a date column with a rule', () => {
  it('off: the words show beside the date', () => {
    const res = info(daysFromToday(5), { alert_rule_id: 5, date_only: false })
    expect(res.alertChip).toBe('in 5 days')
    expect(res.hasAlertStyle).toBe(true)
  })

  it('on by default: a column that never set it shows only the date', () => {
    expect(info(daysFromToday(5), { alert_rule_id: 5 }).alertChip).toBeNull()
  })

  it('on: no words beside the date, but the color, shape, tooltip and spoken words stay', () => {
    const res = info(daysFromToday(5), { alert_rule_id: 5, date_only: true })
    expect(res.alertChip).toBeNull()
    expect(res.hasAlertStyle).toBe(true)
    expect(res.alertBgStyle).not.toEqual({})
    expect(res.alertIcon).not.toBeNull()
    expect(res.alertTooltip).toMatch(/in 5 days/i)
    expect(res.alertSpoken).toMatch(/in 5 days/i)
    expect(res.alertSpoken).toContain('Due Soon')
  })

  it('on, when it is late: the tooltip says how late', () => {
    const res = info('2025-01-01', { alert_rule_id: 5, date_only: true })
    expect(res.alertChip).toBeNull()
    expect(res.alertTooltip).toMatch(/days late/)
    expect(res.alertTooltip).toMatch(/overdue/)
  })

  it('auto-fit leaves room only for the date when the words are hidden', () => {
    const value = daysFromToday(5)
    const row = { row_id: 1, col_2: value } as unknown as GridRow
    expect(cellFitText(column({ alert_rule_id: 5, date_only: false }), value, row, rule)).toContain('in 5 days')
    expect(cellFitText(column({ alert_rule_id: 5 }), value, row, rule)).not.toContain('in 5 days')
  })

  it('is off only when the column says exactly false', () => {
    expect(showsOnlyDate(column({ date_only: true }))).toBe(true)
    expect(showsOnlyDate(column({ date_only: 'no' }))).toBe(true)
    expect(showsOnlyDate(column({}))).toBe(true)
    expect(showsOnlyDate({ config: 'not json' })).toBe(true)
    expect(showsOnlyDate(column({ date_only: false }))).toBe(false)
  })
})
