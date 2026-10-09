/**
 * @vitest-environment jsdom
 *
 * Person-only touches follow the list's kind (plans/generalization/W02-list-kinds.md §2):
 * age next to a birth date, and "Discharged" as a handoff reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn().mockResolvedValue({ ok: true, data: [] }), on: () => () => {} },
  writable: true, configurable: true,
})

import { ProfileHeader } from '../../src/renderer/components/profile/ProfileHeader'
import { HandoffDialog } from '../../src/renderer/components/profile/HandoffDialog'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { setWords } from './vocabFixture'
import type { Column, GridRow, RecordKind } from '../../src/shared/types'

const col = (id: number, name: string, extra: Partial<Column> = {}): Column => ({
  id, grid_id: 1, name, column_type: 'text', width: 150, position: id, is_visible: 1, is_required: 0,
  is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}',
  conditional_format: '[]', created_at: '', ...extra,
})
const columns = [col(1, 'Name', { is_name_column: 1 }), col(2, 'Date of birth', { column_type: 'date', is_identifier: 1 })]
const row = { row_id: 7, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_1: 'Pat Doe', col_2: '1990-05-01' } as GridRow

function asKind(record_kind: RecordKind) {
  useGridStore.setState({ activeGridId: 1, grids: [{ id: 1, name: 'List', record_kind } as never] })
}

async function renderHeader() {
  render(<MemoryRouter><ProfileHeader row={row} columns={columns} gridId={1} onRowUpdate={() => {}} /></MemoryRouter>)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeEach(() => setWords())

describe('list kinds', () => {
  it('shows age next to a birth date for people', async () => {
    asKind('person')
    await renderHeader()
    expect(screen.getByText(/May 1, 1990 \(\d+ yrs\)/)).toBeTruthy()
  })

  it('leaves age out for things', async () => {
    asKind('thing')
    await renderHeader()
    expect(screen.getByText('May 1, 1990')).toBeTruthy()
    expect(screen.queryByText(/May 1, 1990 \(/)).toBeNull()
  })

  it('offers "Discharged" for people and "Closed" for jobs when archiving after a handoff', () => {
    asKind('person')
    const { unmount } = render(<MemoryRouter><HandoffDialog rowId={7} gridId={1} clientName="Pat Doe" onClose={() => {}} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByLabelText('Discharged')).toBeTruthy()
    unmount()

    asKind('job')
    render(<MemoryRouter><HandoffDialog rowId={7} gridId={1} clientName="J-0001" onClose={() => {}} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByLabelText('Closed')).toBeTruthy()
    expect(screen.queryByLabelText('Discharged')).toBeNull()
  })
})
