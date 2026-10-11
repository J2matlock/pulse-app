// @vitest-environment jsdom
/** The profile lists a sequence rule's steps with checkmarks (W05 §3.6). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string) => channel === 'deadlines:grid-context'
  ? { ok: true, data: { meter: {}, quota: {}, progress: {} } }
  : { ok: true, data: { sysLogId: 5 } })
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { DeadlinePanel } from '../../src/renderer/components/profile/DeadlinePanel'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { IPC } from '../../src/shared/ipc-channels'
import type { Column, GridRow, ParsedAlertRule } from '../../src/shared/types'

const col = (id: number, name: string, type: string, config = '{}') => ({ id, grid_id: 1, name, column_type: type, width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '' }) as Column
const columns = [col(2, 'Referral', 'date'), col(3, 'Plan steps', 'deadline', '{"alert_rule_id":7}')]
const rule = { id: 7, name: 'EI', description: null, is_system: 0, thresholds: [], interval_days: null, created_at: '', kind: 'sequence',
  rule_config: JSON.stringify({ kind: 'sequence', anchorColumnId: 2, steps: [{ label: 'IFSP meeting', offset: { days: 45 } }, { label: 'Review', offset: { months: 6 } }] }) } as ParsedAlertRule
const row = { row_id: 9, col_2: '2026-01-10', col_3: null } as unknown as GridRow

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 2, 1, 12)) })
afterEach(() => vi.useRealTimers())

describe('sequence steps on the profile', () => {
  it('shows done and upcoming steps, and checks off the current one', async () => {
    useGridStore.setState({ activeGridId: 1, deadlineContext: { meter: {}, quota: {}, progress: { '9:3': [{ step: 0, anchor: '2026-01-10' }] } } } as never)
    render(<DeadlinePanel row={row} columns={columns} alertRules={[rule]} onDateSave={async () => {}} />)
    const steps = screen.getByRole('list', { name: 'Steps for Plan steps' })
    expect(within(steps).getByText('IFSP meeting').className).toMatch(/line-through/)
    expect(within(steps).getByText('Review')).toBeTruthy()
    await act(async () => { fireEvent.click(within(steps).getByRole('button', { name: 'Mark done' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_STEP_DONE, 9, 3, 1, null)
  })
})
