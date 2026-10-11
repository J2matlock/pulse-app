// @vitest-environment jsdom
/**
 * Automated accessibility check (axe-core) on a record page, rendered for
 * real: header, deadlines, checklist, scratch pad, notes and details.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Column } from '../../../src/shared/types'
import { expectNoAxeViolations } from './axe'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {}, copyToClipboard: vi.fn() }, writable: true, configurable: true })
Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  writable: true,
})
class RO { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', RO)
Element.prototype.scrollIntoView = function scrollIntoView() {}
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import ProfileView from '../../../src/renderer/views/ProfileView'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { setWords } from '../vocabFixture'

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 30)) }) }

function column(id: number, name: string, type: string): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150, is_visible: 1, is_required: 0,
    is_identifier: id === 1 ? 1 : 0, is_name_column: id === 1 ? 1 : 0, default_value: null, description: null,
    config: '{}', conditional_format: '[]', created_at: '2026-01-01 00:00:00',
  } as Column
}
const COLUMNS = [column(1, 'Name', 'text'), column(2, 'Phone', 'phone'), column(3, 'Next visit', 'date'), column(4, 'Notes', 'text')]

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'app:get-info') return Promise.resolve({ ok: true, data: { platform: 'linux', version: '1.0.0' } })
    if (/get-all|list|get-for-row|entries|history|get-row|search|get-due|links|templates/.test(channel)) return Promise.resolve({ ok: true, data: [] })
    return Promise.resolve({ ok: false, error: 'not in this test' })
  })
  useGridStore.setState({
    grids: [{ id: 1, name: 'Test List', description: null, created_at: '', updated_at: '', sort_config: '[]', filter_config: '[]', column_order: '[]', frozen_columns: 0, row_height: 'comfortable', show_gridlines: 1, show_row_numbers: 0, show_alternating_rows: 0, position: 0, is_active: 1, acuity_enabled: 0 }],
    activeGridId: 1, columns: COLUMNS, hiddenColumns: [], isLoading: false, gridListLoaded: true, sortedRowIds: [1, 2],
    rows: [1, 2].map(id => ({ row_id: id, position: id - 1, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, display_name: `Test Person ${id}`,
      created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00', col_1: `Test Person ${id}`, col_2: '555-0100', col_3: '2026-11-20', col_4: null })),
  } as unknown as Parameters<typeof useGridStore.setState>[0])
})
afterEach(() => cleanup())

describe('axe: record page', () => {
  it('has no accessibility problems', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/profile/1']}>
        <Routes><Route path="/profile/:rowId" element={<ProfileView />} /></Routes>
      </MemoryRouter>,
    )
    await flush()
    await flush()
    expect(screen.getAllByText('Test Person 1').length).toBeGreaterThan(0)
    await expectNoAxeViolations(container)
  })
})
