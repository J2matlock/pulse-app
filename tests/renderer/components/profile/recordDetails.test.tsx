// @vitest-environment jsdom
/** 3.5: number history labels only the points that matter; status badges keep their list colors. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn().mockResolvedValue({ ok: true, data: [] }), on: () => () => {} },
  writable: true, configurable: true,
})

import { labelledIndices, NumberHistoryDialog } from '../../../../src/renderer/components/profile/NumberHistory'
import { ProfileHeader } from '../../../../src/renderer/components/profile/ProfileHeader'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { setWords } from '../../vocabFixture'
import type { Column, GridRow } from '../../../../src/shared/types'

beforeEach(() => setWords())

const pts = [5, 9, 2, 7, 8, 6].map((value, i) => ({ at: `2026-0${i + 1}-01 10:00:00`, value }))

describe('number history chart', () => {
  it('labels the first, last, lowest and highest values only', () => {
    expect([...labelledIndices(pts)].sort()).toEqual([0, 1, 2, 5])
    render(<NumberHistoryDialog label="Weight" points={pts} currency={false} onClose={() => {}} />)
    const labels = [...document.querySelectorAll('svg text')].map(t => t.textContent)
    expect(labels).toContain('2')
    expect(labels).not.toContain('7')
  })
})

describe('status badge in the header', () => {
  it('uses the option color from the list', async () => {
    useGridStore.setState({ activeGridId: 1, grids: [{ id: 1, name: 'Jobs', record_kind: 'job' } as never] })
    const col = (id: number, name: string, extra: Partial<Column> = {}): Column => ({
      id, grid_id: 1, name, column_type: 'text', width: 150, position: id, is_visible: 1, is_required: 0,
      is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '', ...extra,
    })
    const columns = [col(1, 'Name', { is_name_column: 1 }), col(2, 'Stage', { column_type: 'status', is_identifier: 1, config: JSON.stringify({ options: [{ label: 'Approved', color: '#7c3aed' }] }) })]
    const row = { row_id: 7, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_1: 'J-1', col_2: 'Approved' } as GridRow
    render(<MemoryRouter><ProfileHeader row={row} columns={columns} gridId={1} onRowUpdate={() => {}} /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const badge = screen.getByText('Approved') as HTMLElement
    expect(badge.style.backgroundColor).toBe('rgb(124, 58, 237)')
  })
})
