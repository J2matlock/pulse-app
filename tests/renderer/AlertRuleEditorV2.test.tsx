// @vitest-environment jsdom
/** Rule editor v2 (W05 §6): pick how it's worked out, choose columns, see a live preview, save. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string) => channel === 'alert-rule:create' ? { ok: true, data: 11 } : { ok: true, data: [] })
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { AlertRuleEditor } from '../../src/renderer/components/alerts/AlertRuleEditor'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { IPC } from '../../src/shared/ipc-channels'
import type { Column, GridRow } from '../../src/shared/types'
import { setWords } from './vocabFixture'

const col = (id: number, name: string, type: string, extra: Partial<Column> = {}) => ({ id, grid_id: 1, name, column_type: type, width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '', ...extra }) as Column
const columns = [col(1, 'Name', 'text', { is_name_column: 1 }), col(2, 'Referral', 'date'), col(3, 'Plan written', 'date'),
  col(4, 'Status', 'status', { config: JSON.stringify({ options: [{ label: 'Active', color: 'green' }, { label: 'Closed', color: 'gray' }] }) })]
const rows = [
  { row_id: 8, col_1: 'Sam Doe', col_2: null, col_3: null, col_4: 'Active' },
  { row_id: 9, col_1: 'Pat Lee', col_2: '2026-01-10', col_3: null, col_4: 'Active' },
] as unknown as GridRow[]

beforeEach(() => {
  setWords()
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 2, 1, 12))
  useGridStore.setState({ activeGridId: 1, columns, rows, grids: [], deadlineContext: null } as never)
})
afterEach(() => vi.useRealTimers())

describe('the rule editor', () => {
  it('builds a "from another date" rule with a live preview and saves it', async () => {
    const onClose = vi.fn()
    render(<AlertRuleEditor columnId={3} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Rule Name'), { target: { value: 'Plan due' } })
    fireEvent.click(screen.getByRole('radio', { name: /From another date/ }))
    expect(screen.getByTestId('rule-preview').textContent).toBe('Choose the date this deadline is worked out from.')
    // The rule's own column isn't offered as the date to work from
    const anchor = screen.getByLabelText('Worked out from') as HTMLSelectElement
    expect([...anchor.options].map(o => o.text)).toEqual(['Choose the date…', 'Referral'])
    fireEvent.change(anchor, { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Offset amount'), { target: { value: '45' } })
    // Pat has a referral date, so the preview picks Pat
    expect(screen.getByTestId('rule-preview').textContent).toMatch(/^For Pat Lee: .*Feb 24, 2026/)

    fireEvent.click(screen.getByLabelText('Only when…'))
    fireEvent.change(screen.getByLabelText('Only when column'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Only when value'), { target: { value: 'Active' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Rule' })) })
    const call = invoke.mock.calls.find(c => c[0] === IPC.ALERT_RULE_CREATE)!
    expect(call[1]).toMatchObject({
      name: 'Plan due', kind: 'relative', business_days: 0, interval_days: null,
      rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 2, offset: { days: 45, direction: 'after' } }),
      rule_condition: JSON.stringify({ columnId: 4, op: 'is', values: ['Active'], whenFalse: 'pause' }),
    })
    expect(onClose).toHaveBeenCalledWith(11)
  })

  it('will not save settings that are missing something', async () => {
    render(<AlertRuleEditor columnId={3} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Rule Name'), { target: { value: 'Quarterly' } })
    fireEvent.click(screen.getByRole('radio', { name: /On fixed dates/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Rule' })) })
    expect(screen.getAllByText('Choose at least one month.').length).toBeGreaterThan(0)
    expect(invoke.mock.calls.some(c => c[0] === IPC.ALERT_RULE_CREATE && (c[1] as { name: string }).name === 'Quarterly')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Mar' }))
    expect(screen.getByTestId('rule-preview').textContent).toMatch(/^For .*Mar 15, 2026/)
  })
})
