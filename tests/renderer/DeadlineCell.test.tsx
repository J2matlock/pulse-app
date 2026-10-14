// @vitest-environment jsdom
/** Deadline columns (W05) show their rule's status instead of a value. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { CellDisplay, cellFitText } from '../../src/renderer/components/grid/CellDisplay'
import { LINK_FIELD_SEP, LINK_ITEM_SEP } from '../../src/shared/links'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { pulseEvents } from '../../src/renderer/events'
import type { Column, GridRow, ParsedAlertRule } from '../../src/shared/types'

const column = { id: 4, grid_id: 1, name: 'Estimated tax', column_type: 'deadline', width: 150, position: 0, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{"alert_rule_id":7}', conditional_format: '[]', created_at: '' } as Column
const rule = { id: 7, name: 'Estimates', description: null, is_system: 0, thresholds: [], interval_days: null, created_at: '', kind: 'calendar', rule_config: JSON.stringify({ kind: 'calendar', months: [1, 4, 6, 9], day: 15 }) } as ParsedAlertRule

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 2, 12)) })
afterEach(() => vi.useRealTimers())

describe('deadline cells', () => {
  it('show the next due date and how far away it is', () => {
    useAlertStore.setState({ rules: [rule] } as never)
    render(<CellDisplay column={column} value={null} row={{ row_id: 1 } as GridRow} allColumns={[column]} parsedConfig={{ alert_rule_id: 7 }} />)
    expect(screen.getByText('Jan 15, 2027 · in 105 days')).toBeTruthy()
  })

  it('ask for a rule when none is attached, and open the picker from the cell (G-20)', () => {
    useAlertStore.setState({ rules: [] } as never)
    const opened = vi.fn()
    const off = pulseEvents.on('column:choose-rule', opened)
    render(<CellDisplay column={column} value={null} row={{ row_id: 1 } as GridRow} allColumns={[column]} parsedConfig={{}} />)
    const button = screen.getByRole('button', { name: 'Choose a deadline rule' })
    // Not a Tab stop of its own: the list is one Tab stop (G-32)
    expect(button.getAttribute('tabindex')).toBe('-1')
    fireEvent.click(button)
    expect(opened).toHaveBeenCalledWith({ columnId: 4 })
    off()
  })

  it('say when a calendar rule is next due before its lead time, not a bare dash (R4)', () => {
    const lead = { ...rule, rule_config: JSON.stringify({ kind: 'calendar', months: [1, 4, 6, 9], day: 15, lead: 30 }) } as ParsedAlertRule
    useAlertStore.setState({ rules: [lead] } as never)
    render(<CellDisplay column={column} value={null} row={{ row_id: 1 } as GridRow} allColumns={[column]} parsedConfig={{ alert_rule_id: 7 }} />)
    const next = screen.getByText('Next Jan 15, 2027')
    expect(next.getAttribute('title')).toBe('Next: Jan 15, 2027')
  })

  it('a "Days until" column counts to when its date is due when that date has a rule (R4)', () => {
    const every30 = { ...rule, id: 8, kind: 'interval', interval_days: 30, rule_config: null } as unknown as ParsedAlertRule
    const visit = { ...column, id: 2, name: 'Last visit', column_type: 'date', config: '{"alert_rule_id":8,"date_only":false}' } as Column
    const days = { ...column, id: 3, name: 'Days until visit', column_type: 'calculated_days', config: '{"source_column_id":2}' } as Column
    useAlertStore.setState({ rules: [every30] } as never)
    useGridStore.setState({ columns: [visit, days], hiddenColumns: [], deadlineContext: null } as never)
    // Last visit Sep 7, every 30 days: due Oct 7, in 5 days (not "25 days overdue")
    render(<CellDisplay column={days} value={null} row={{ row_id: 1, col_2: '2026-09-07' } as unknown as GridRow} allColumns={[visit, days]} parsedConfig={{ source_column_id: 2 }} />)
    expect(screen.getByText('5 days')).toBeTruthy()
  })

  it('auto-fit measures what the cell shows: deadline words, link names (R1)', () => {
    const every30 = { ...rule, id: 8, kind: 'interval', interval_days: 30, rule_config: null } as unknown as ParsedAlertRule
    const visit = { ...column, id: 2, name: 'Last visit', column_type: 'date', config: '{"alert_rule_id":8,"date_only":false}' } as Column
    const row = { row_id: 1, col_2: '2026-08-07', col_4: null } as unknown as GridRow
    // Due Sep 6: the date and its chip, not just "2026-08-07"
    expect(cellFitText(visit, '2026-08-07', row, every30)).toContain('due Sep 6 · 26 days late')
    expect(cellFitText(column, null, row, rule)).toBe('Jan 15, 2027 · in 105 days')
    expect(cellFitText(column, null, row, undefined)).toBe('Choose a deadline rule')
    const link = { ...column, id: 5, column_type: 'link', config: '{}' } as Column
    expect(cellFitText(link, `12${LINK_FIELD_SEP}Ann Lee${LINK_ITEM_SEP}13${LINK_FIELD_SEP}Bo Chan`, row, undefined)).toBe('Ann Lee, Bo Chan')
  })

  it('show a used-up quota by its label, not "today" (D-13)', () => {
    const quota = { ...rule, kind: 'quota', rule_config: JSON.stringify({ kind: 'quota', activityTypes: ['visit'], startColumnId: 8, endColumnId: 9, limit: 2, warnRemaining: 0, warnDaysBeforeEnd: 0 }) } as ParsedAlertRule
    useAlertStore.setState({ rules: [quota] } as never)
    useGridStore.setState({ deadlineContext: { meter: {}, quota: { '1:4': 2 }, progress: {}, extensions: {} } } as never)
    render(<CellDisplay column={column} value={null} row={{ row_id: 1, col_8: '2026-01-01', col_9: '2026-12-31' } as unknown as GridRow} allColumns={[column]} parsedConfig={{ alert_rule_id: 7 }} />)
    expect(screen.getByText('All 2 used · ends Dec 31, 2026')).toBeTruthy()
  })
})
