// @vitest-environment jsdom
/** "Fill in a form" on an archived record: the record isn't among the loaded rows, so it's fetched on its own. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'

const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'forms:list') return { ok: true, data: [{ id: 3, grid_id: 1, name: 'Intake form' }] }
  if (channel === 'row:get') return { ok: true, data: { row_id: 9, is_active: 0, col_1: 'Ann' } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/renderer/components/forms/FillFormDialog', () => ({
  FillFormDialog: ({ form, row }: { form: { name: string }; row?: { row_id: number } }) => <div>FILL {form.name} for {row?.row_id}</div>,
}))

import { FormFillHost } from '../../src/renderer/components/forms/FormFillHost'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { pulseEvents } from '../../src/renderer/events'
import { IPC } from '../../src/shared/ipc-channels'

beforeEach(() => {
  invoke.mockClear()
  useGridStore.setState({ activeGridId: 1, columns: [], hiddenColumns: [], rows: [] })
})

describe('FormFillHost', () => {
  it('opens the form for a record that is not among the loaded rows', async () => {
    render(<FormFillHost />)
    await act(async () => {
      pulseEvents.emit('form:fill', { formId: 3, gridId: 1, rowId: 9 })
      await new Promise(r => setTimeout(r, 0))
    })
    expect(invoke).toHaveBeenCalledWith(IPC.ROW_GET, 1, 9)
    expect(screen.getByText('FILL Intake form for 9')).toBeTruthy()
  })
})
