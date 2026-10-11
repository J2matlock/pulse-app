// @vitest-environment jsdom
/** Escape closes these dialogs, like their Cancel or X (AUDIT-046). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async () => ({ ok: true, data: [] }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { SnoozeDialog } from '../../../src/renderer/views/tasks/SnoozeDialog'
import { AlertRuleEditor } from '../../../src/renderer/components/alerts/AlertRuleEditor'
import { AnchorChangeDialog } from '../../../src/renderer/components/alerts/AnchorChangeDialog'
import { ContactImportExport } from '../../../src/renderer/components/contacts/ContactImportExport'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../src/renderer/stores/alertStore'
import { pulseEvents } from '../../../src/renderer/events'
import type { Column } from '../../../src/shared/types'
import { setWords } from '../vocabFixture'

const col = (id: number, name: string, type: string, config = '{}') => ({ id, grid_id: 1, name, column_type: type, width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: id === 1 ? 1 : 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '' }) as Column

function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
}

beforeEach(() => {
  setWords()
  invoke.mockClear()
  useGridStore.setState({ activeGridId: 1, columns: [col(1, 'Name', 'text'), col(2, 'Referral', 'date')], hiddenColumns: [], rows: [], grids: [], deadlineContext: null } as never)
})

describe('Escape closes the dialog', () => {
  it('snooze', () => {
    const onClose = vi.fn()
    const onSnooze = vi.fn()
    render(<SnoozeDialog onClose={onClose} onSnooze={onSnooze} />)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSnooze).not.toHaveBeenCalled()
  })

  it('deadline rule editor', () => {
    const onClose = vi.fn()
    render(<AlertRuleEditor columnId={2} onClose={onClose} />)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith()
  })

  it('contact import', () => {
    const onClose = vi.fn()
    render(<ContactImportExport open mode="import" onClose={onClose} />)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('"correction, or a new start?" leaves the steps alone', () => {
    useGridStore.setState({ columns: [col(2, 'Referral', 'date'), col(3, 'Plan', 'deadline', '{"alert_rule_id":7}')],
      deadlineContext: { meter: {}, quota: {}, progress: { '9:3': [{ step: 0, anchor: '2026-01-10' }] }, extensions: {} } } as never)
    useAlertStore.setState({ rules: [{ id: 7, name: 'Steps', thresholds: [], kind: 'sequence', rule_config: JSON.stringify({ kind: 'sequence', anchorColumnId: 2, steps: [{ label: 'Plan', offset: { days: 45 } }] }) }] } as never)
    render(<AnchorChangeDialog />)
    act(() => pulseEvents.emit('cell:changed', { rowId: 9, columnId: 2, from: '2026-01-10', to: '2026-01-11' }))
    expect(screen.getByText('Correction, or a new start?')).toBeTruthy()
    act(() => pressEscape())
    expect(screen.queryByText('Correction, or a new start?')).toBeNull()
    expect(invoke).not.toHaveBeenCalledWith('deadlines:progress-reanchor', 9, 3, '2026-01-10', '2026-01-11')
  })
})
