// @vitest-environment jsdom
/** The board works out each card's deadline once, not for every card on every change (AUDIT-134). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const calls = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../src/renderer/components/board/boardLanes', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/components/board/boardLanes')>()
  return { ...real, nearestDeadline: (...a: Parameters<typeof real.nearestDeadline>) => { calls.n++; return real.nearestDeadline(...a) } }
})
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import { BoardView } from '../../src/renderer/components/board/BoardView'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import type { Column, GridRow } from '../../src/shared/types'
import { setWords } from './vocabFixture'

const stage = { options: [{ value: 'Open' }, { value: 'Done', done: true }], hideDoneAfterDays: 14 }
const columns = [
  { id: 1, grid_id: 1, name: 'Job', column_type: 'text', is_name_column: 1, config: '{}' },
  { id: 2, grid_id: 1, name: 'Status', column_type: 'status', config: JSON.stringify({ options: [{ label: 'Open' }, { label: 'Done' }], stage }) },
  { id: 3, grid_id: 1, name: 'Due', column_type: 'date', config: JSON.stringify({ alert_rule_id: 5 }) },
] as Column[]
const rows = Array.from({ length: 20 }, (_, i) => ({ row_id: i + 1, col_1: `Test ${i + 1}`, col_2: 'Open', col_3: '2026-01-01', is_starred: 0, updated_at: '2026-10-01 10:00:00' })) as unknown as GridRow[]

beforeEach(() => {
  setWords(); calls.n = 0
  useAlertStore.setState({ rules: [{ id: 5, name: 'Due', description: null, is_system: 0, interval_days: null, created_at: '', thresholds: [] }] } as never)
  useGridStore.setState({ activeGridId: 1, columns, hiddenColumns: [], rows, grids: [], activeFilters: [], filterMode: 'and', showStarredOnly: false, searchQuery: '', rowTagsMap: new Map(), acuityLevels: [], acuityEnabled: false } as never)
})

describe('board cost', () => {
  it('editing one record works out only that card again', async () => {
    render(<MemoryRouter><BoardView /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const first = calls.n
    expect(first).toBe(20)
    await act(async () => {
      useGridStore.setState({ rows: rows.map(r => r.row_id === 3 ? { ...r, col_1: 'Test edited' } : r) })
    })
    expect(calls.n).toBe(first + 1)
  })
})
