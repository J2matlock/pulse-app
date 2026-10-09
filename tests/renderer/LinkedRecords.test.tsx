// @vitest-environment jsdom
/** Profile "Linked" section (W04 §7.3): blocks both ways, key details, deadline rollups, unlink, open. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

const type = { id: 7, from_grid_id: 3, to_grid_id: 2, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one', created_at: '', from_grid_name: 'Vehicles', to_grid_name: 'Customers' }
const links = [{
  type, direction: 'backward', label: 'Vehicles', other_grid_id: 3, other_grid_name: 'Vehicles', single: false,
  records: [
    { row_id: 21, grid_id: 3, display_name: '2017 Civic', is_active: 1, details: [{ label: 'Plate', value: 'ABC123', type: 'text' }, { label: 'Bought', value: '2020-04-01', type: 'date' }] },
    { row_id: 22, grid_id: 3, display_name: '2009 Van', is_active: 0 },
  ],
}]
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'links:get') return { ok: true, data: links }
  if (channel === 'deadlines:get') return { ok: true, data: [
    { row_id: 21, column_name: 'Oil change', daysUntil: -12, state: 'overdue' },
    { row_id: 21, column_name: 'Inspection', daysUntil: 40, state: 'ok' },
    { row_id: 22, column_name: 'Registration', daysUntil: 3, state: 'paused' },
  ] }
  if (channel === 'links:remove') return { ok: true, data: { added: null, removed: [{ typeId: 7, fromRowId: 21, toRowId: 5 }], sysLogIds: [], rowIds: [21, 5] } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { LinkedRecords } from '../../src/renderer/components/profile/LinkedRecords'
import { IPC } from '../../src/shared/ipc-channels'
import { setWords } from './vocabFixture'

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }

beforeEach(() => { setWords(); invoke.mockClear() })

async function show() {
  render(<MemoryRouter><Routes><Route path="*" element={<><LinkedRecords rowId={5} /><Where /></>} /></Routes></MemoryRouter>)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

describe('linked records on the profile', () => {
  it('show each block with details and what is overdue or coming up', async () => {
    await show()
    const block = screen.getByRole('region', { name: 'Vehicles' })
    expect(within(block).getByText('Vehicles (2)')).toBeTruthy()
    expect(within(block).getByText('Plate: ABC123 · Bought: Apr 1, 2020')).toBeTruthy()
    expect(within(block).getByText('Oil change overdue 12 days')).toBeTruthy()
    expect(within(block).queryByText(/Inspection/)).toBeNull()
    expect(within(block).queryByText(/Registration/)).toBeNull()
    expect(within(block).getByRole('button', { name: '2009 Van (archived)' })).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINES_GET, { rowIds: [21, 22] })
  })

  it('open a linked record, or unlink it', async () => {
    await show()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unlink 2017 Civic' })) })
    // This record is the "to" side of a backward block
    expect(invoke).toHaveBeenCalledWith(IPC.RECORD_LINK_REMOVE, 7, 21, 5)
    fireEvent.click(screen.getByRole('button', { name: '2017 Civic' }))
    expect(screen.getByTestId('where').textContent).toBe('/profile/21?gridId=3')
  })
})
