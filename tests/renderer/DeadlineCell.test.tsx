// @vitest-environment jsdom
/** Deadline columns (W05) show their rule's status instead of a value. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { CellDisplay } from '../../src/renderer/components/grid/CellDisplay'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
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

  it('ask for a rule when none is attached', () => {
    useAlertStore.setState({ rules: [] } as never)
    render(<CellDisplay column={column} value={null} row={{ row_id: 1 } as GridRow} allColumns={[column]} parsedConfig={{}} />)
    expect(screen.getByText('Choose a rule')).toBeTruthy()
  })
})
