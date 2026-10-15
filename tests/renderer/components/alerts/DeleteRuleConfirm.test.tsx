// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke }, writable: true })

import { DeleteRuleConfirm } from '../../../../src/renderer/components/alerts/DeleteRuleConfirm'
import { useAlertStore, describeRuleUsage } from '../../../../src/renderer/stores/alertStore'
import type { AlertRuleUse, ParsedAlertRule } from '../../../../src/shared/types'

const rule = { id: 3, name: 'Every year', description: null, is_system: 0, thresholds: [], interval_days: null, created_at: '' } as ParsedAlertRule
const use = (column_id: number, column_name: string, grid_id: number, grid_name: string): AlertRuleUse => ({ rule_id: 3, column_id, column_name, grid_id, grid_name, hidden: false })

describe('DeleteRuleConfirm (D-05)', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('says which columns use the rule before deleting', async () => {
    const uses = [use(1, 'Last visit', 1, 'Clients'), use(2, 'Lease renewal', 2, 'Housing')]
    mockInvoke.mockImplementation(async (ch: string) => ch === 'alert-rule:usage' ? { ok: true, data: uses } : { ok: true, data: { rule, columnIds: [1, 2] } })
    useAlertStore.setState({ rules: [rule], usage: uses })
    const onDone = vi.fn()
    render(<DeleteRuleConfirm rule={rule} onDone={onDone} />)
    expect(await screen.findByText(/Used by 2 columns in 2 lists/)).toBeTruthy()
    expect(screen.getByText(/stop being deadlines/)).toBeTruthy()
    expect(screen.getByText('Lease renewal')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete rule' })) })
    expect(mockInvoke).toHaveBeenCalledWith('alert-rule:delete', 3)
    expect(onDone).toHaveBeenCalled()
  })

  it('a rule no column uses is deleted at once, no question, with the Undo toast (Q4)', async () => {
    const { useUndoStore } = await import('../../../../src/renderer/stores/undoStore')
    useUndoStore.getState().clear()
    mockInvoke.mockImplementation(async (ch: string) => ch === 'alert-rule:usage' ? { ok: true, data: [] }
      : ch === 'alert-rule:delete' ? { ok: true, data: { rule, columnIds: [] } } : { ok: true, data: [] })
    useAlertStore.setState({ rules: [rule], usage: [] })
    const onDone = vi.fn()
    render(<DeleteRuleConfirm rule={rule} onDone={onDone} />)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(mockInvoke).toHaveBeenCalledWith('alert-rule:delete', 3)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useUndoStore.getState().toast).not.toBeNull()
  })

  it('checks the columns again first: a rule a column started using meanwhile still asks', async () => {
    const uses = [use(1, 'Last visit', 1, 'Clients')]
    mockInvoke.mockImplementation(async (ch: string) => ch === 'alert-rule:usage' ? { ok: true, data: uses } : { ok: true, data: { rule, columnIds: [1] } })
    useAlertStore.setState({ rules: [rule], usage: [] })
    const onDone = vi.fn()
    render(<DeleteRuleConfirm rule={rule} onDone={onDone} />)
    expect(await screen.findByText(/Used by "Last visit" in Clients/)).toBeTruthy()
    expect(mockInvoke).not.toHaveBeenCalledWith('alert-rule:delete', 3)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('describes usage in plain words', () => {
    expect(describeRuleUsage([])).toBe('Not used by any column.')
    expect(describeRuleUsage([use(1, 'Last visit', 1, 'Clients')])).toBe('Used by "Last visit" in Clients.')
    expect(describeRuleUsage([use(1, 'A', 1, 'Clients'), use(2, 'B', 1, 'Clients')])).toBe('Used by 2 columns in Clients.')
  })
})
