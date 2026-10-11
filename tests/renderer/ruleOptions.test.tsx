// @vitest-environment jsdom
/** Rule options say what they do (D-31, D-37). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async () => ({ ok: true, data: 1 }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { MeterReadingDialog } from '../../src/renderer/views/dashboard/MeterReadingDialog'
import { AnchorChangeDialog } from '../../src/renderer/components/alerts/AnchorChangeDialog'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import { pulseEvents } from '../../src/renderer/events'
import type { Column } from '../../src/shared/types'

describe('meter reading dialog', () => {
  it('starts from the reading on file, shows the unit, and checks a likely typo', () => {
    const onSave = vi.fn()
    render(<MeterReadingDialog title="Oil change" info={{ unit: 'mi', every: 5000, current: 45180, lastService: 41000 }} onSave={onSave} onClose={vi.fn()} />)
    const input = screen.getByLabelText(/Current reading \(mi\)/) as HTMLInputElement
    expect(input.value).toBe('45180')
    expect(screen.getByText(/On file now: 45,180 mi/)).toBeTruthy()
    fireEvent.change(input, { target: { value: '4521' } })
    expect(screen.getByRole('alert').textContent).toMatch(/lower than the reading at the last service/)
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Mark done anyway' }))
    expect(onSave).toHaveBeenCalledWith(4521)
  })
})

describe('changing a sequence start date', () => {
  beforeEach(() => invoke.mockClear())
  it('asks whether it was a correction, and keeps the steps done if so', async () => {
    const col = (id: number, name: string, type: string, config = '{}') => ({ id, grid_id: 1, name, column_type: type, config, is_visible: 1 }) as unknown as Column
    useGridStore.setState({ activeGridId: 1, columns: [col(2, 'Referral', 'date'), col(3, 'IFSP', 'deadline', '{"alert_rule_id":7}')], hiddenColumns: [],
      deadlineContext: { meter: {}, quota: {}, progress: { '9:3': [{ step: 0, anchor: '2026-01-10' }] }, extensions: {} } } as never)
    useAlertStore.setState({ rules: [{ id: 7, name: 'EI', thresholds: [], kind: 'sequence', rule_config: JSON.stringify({ kind: 'sequence', anchorColumnId: 2, steps: [{ label: 'Plan', offset: { days: 45 } }] }) }] } as never)
    render(<AnchorChangeDialog />)
    act(() => pulseEvents.emit('cell:changed', { rowId: 9, columnId: 2, from: '2026-01-10', to: '2026-01-11' }))
    expect(screen.getByText('Correction, or a new start?')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /correction: keep the steps done/ })) })
    expect(invoke).toHaveBeenCalledWith('deadlines:progress-reanchor', 9, 3, '2026-01-10', '2026-01-11')
  })

  it('says nothing when no steps were done for the old date', () => {
    render(<AnchorChangeDialog />)
    act(() => pulseEvents.emit('cell:changed', { rowId: 9, columnId: 2, from: '2025-05-01', to: '2026-01-11' }))
    expect(screen.queryByText('Correction, or a new start?')).toBeNull()
  })
})
