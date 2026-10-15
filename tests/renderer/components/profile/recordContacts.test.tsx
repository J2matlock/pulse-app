// @vitest-environment jsdom
/** 3.19: contact details on the record page. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: () => () => {}, copyToClipboard: vi.fn(async () => {}) },
  writable: true, configurable: true,
})
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { ProfileHeader } from '../../../../src/renderer/components/profile/ProfileHeader'
import { LinkedProviders } from '../../../../src/renderer/components/profile/LinkedProviders'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { setWords } from '../../vocabFixture'
import type { Column, GridRow, RecordKind } from '../../../../src/shared/types'

const col = (id: number, name: string, extra: Partial<Column> = {}): Column => ({
  id, grid_id: 1, name, column_type: 'text', width: 150, position: id, is_visible: 1, is_required: 0,
  is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '', ...extra,
})
const row = { row_id: 7, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_1: 'Pat' } as GridRow

function asKind(record_kind: RecordKind) {
  useGridStore.setState({ activeGridId: 1, grids: [{ id: 1, name: 'List', record_kind } as never], columns: [col(1, 'Name', { is_name_column: 1 })] })
}

async function renderHeader() {
  render(<MemoryRouter><ProfileHeader row={row} columns={[col(1, 'Name', { is_name_column: 1 })]} gridId={1} onRowUpdate={() => {}} /></MemoryRouter>)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: [] })
})

describe('Add contact info', () => {
  it('is offered for people but not for things', async () => {
    asKind('thing')
    await renderHeader()
    expect(screen.queryByRole('button', { name: /Add contact info/ })).toBeNull()
  })

  it('offers a real column after saving, and moves the value into it', async () => {
    asKind('person')
    const addColumn = vi.fn(async (name: string, type: string) => {
      useGridStore.setState({ columns: [col(1, 'Name', { is_name_column: 1 }), col(9, name, { column_type: type })] })
    })
    const updateCell = vi.fn(async () => {})
    useGridStore.setState({ addColumn, updateCell } as never)
    await renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /Add contact info/ }))
    expect(screen.getByLabelText('Kind')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Guardian cell' } })
    fireEvent.change(screen.getByLabelText('Number or address'), { target: { value: '555-0199' } })
    // The list-wide choice isn't part of the one-off form (C-10)
    expect(screen.queryByText(/column/)).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    const saves = () => mockInvoke.mock.calls.filter(c => c[0] === 'row:set-manual-contacts')
    expect(saves()).toEqual([['row:set-manual-contacts', 7, [{ type: 'phone', label: 'Guardian cell', value: '555-0199' }]]])
    expect(addColumn).not.toHaveBeenCalled()
    expect(screen.getByText(/Want a .Guardian cell. column for every client/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add the column' })) })
    expect(addColumn).toHaveBeenCalledWith('Guardian cell', 'phone')
    expect(updateCell).toHaveBeenCalledWith(7, 9, '555-0199')
    // Not shown twice: the extra entry goes once the column holds it
    expect(saves().at(-1)).toEqual(['row:set-manual-contacts', 7, []])
    expect(screen.queryByText(/Want a/)).toBeNull()
  })

  it('"No thanks" keeps the entry and drops the offer', async () => {
    asKind('person')
    await renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /Add contact info/ }))
    fireEvent.change(screen.getByLabelText('Number or address'), { target: { value: 'pat@example.com' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'email' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(screen.queryByText(/Want a/)).toBeNull()
    expect(screen.getByText('pat@example.com')).toBeTruthy()
  })
})

describe('linked contacts', () => {
  it('shows phone, email and the link note right on the record, with details on request', async () => {
    mockInvoke.mockImplementation((channel: string) => channel === 'contacts:get-client-links'
      ? Promise.resolve({ ok: true, data: [{ id: 1, provider_id: 3, row_id: 7, grid_id: 1, linked_at: '2026-09-01 10:00:00', notes: 'Primary care',
        provider_name: 'Dr. Lee', provider_phone_main: '555-0100', provider_email: 'lee@clinic.org', provider_org_name: 'Eastside Clinic', provider_title: 'GP', provider_category_color: '#00f' }] })
      : Promise.resolve({ ok: true, data: [] }))
    render(<MemoryRouter><LinkedProviders rowId={7} gridId={1} /></MemoryRouter>)
    expect(await screen.findByText('555-0100')).toBeTruthy()
    expect(screen.getByText('lee@clinic.org')).toBeTruthy()
    expect(screen.getByText('Primary care')).toBeTruthy()
    expect(screen.getByText(/GP, Eastside Clinic/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy Dr. Lee phone/ })) })
    expect(window.api.copyToClipboard).toHaveBeenCalledWith('555-0100')
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('button', { name: /Open in/ })).toBeTruthy()
  })
})
