// @vitest-environment jsdom
/** The choices editor (audit 1.15 / G-02, G-36): renames can carry records along, removals say who still uses them. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }))
const invoke = vi.fn(async (channel: string) => channel === 'column:option-usage'
  ? { ok: true, data: { Scheduled: 12, Pending: 3 } }
  : { ok: true, data: { updated: 12 } })
Object.defineProperty(window, 'api', { value: { invoke }, writable: true, configurable: true })

import { EditOptionsDialog } from '../../../../src/renderer/components/grid/EditOptionsDialog'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

const column = {
  id: 4, grid_id: 1, name: 'Status', column_type: 'status', position: 0, width: 150, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
  default_value: null, description: null, conditional_format: '[]', created_at: '',
  config: JSON.stringify({ options: [{ label: 'Scheduled', color: '#000' }, { label: 'Pending', color: '#111' }] }),
} as Column

beforeEach(() => { setWords(); invoke.mockClear(); useUndoStore.getState().clear() })

describe('EditOptionsDialog', () => {
  it('renames a choice and offers to change the records that use it', async () => {
    const onSaved = vi.fn()
    render(<EditOptionsDialog column={column} onClose={vi.fn()} onSaved={onSaved} />)
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Choice 1'), { target: { value: 'Booked' } })
    expect(screen.getByText(/Also change 12 clients: Scheduled → Booked/)).toBeTruthy()
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(12))
    expect(invoke).toHaveBeenCalledWith('column:set-options', 4, { options: ['Booked', 'Pending'], renames: { Scheduled: 'Booked' }, updateRecords: true })
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('says how many records still use a removed choice', async () => {
    render(<EditOptionsDialog column={column} onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Remove Pending'))
    expect(screen.getByRole('status').textContent).toMatch(/3 clients still use “Pending”/)
  })
})
