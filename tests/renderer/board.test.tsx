// @vitest-environment jsdom
/** The board (W06 §3): lanes per stage, filters and search as in the table, cards, saved view mode. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'settings:get') return { ok: true, data: JSON.stringify([4]) }
  if (channel === 'stages:durations') return { ok: true, data: { 1: { current: { stage: 'In progress', since: '2026-09-28 10:00:00', days: 3, approximate: false }, stays: [] }, 3: { current: { stage: 'Estimate', since: '2026-09-01 10:00:00', days: 31, approximate: true }, stays: [] } } }
  if (channel === 'stages:move') return { ok: true, data: { previous: 'In progress', changed: true, sysLogIds: [], checklistItemIds: [], stamped: null } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { BoardView } from '../../src/renderer/components/board/BoardView'
import { buildLanes, visibleRows } from '../../src/renderer/components/board/boardLanes'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import { localDateString } from '../../src/shared/dates'
import type { Column, GridRow } from '../../src/shared/types'
import type { StageConfig } from '../../src/shared/stages'
import { setWords } from './vocabFixture'

const stage: StageConfig = { options: [{ value: 'Estimate' }, { value: 'In progress' }, { value: 'Done', done: true }], hideDoneAfterDays: 14 }
const columns = [
  { id: 1, grid_id: 1, name: 'Job', column_type: 'text', is_name_column: 1, config: '{}' },
  { id: 2, grid_id: 1, name: 'Status', column_type: 'status', config: JSON.stringify({ options: [{ label: 'Estimate', color: '#3b82f6' }, { label: 'In progress', color: '#eab308' }, { label: 'Done', color: '#22c55e' }], stage }) },
  { id: 3, grid_id: 1, name: 'Promised', column_type: 'date', config: JSON.stringify({ alert_rule_id: 5 }) },
  { id: 4, grid_id: 1, name: 'Bay', column_type: 'text', config: '{}' },
] as Column[]
const old = '2020-01-01 10:00:00'
const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
const rows = [
  { row_id: 1, col_1: 'Brakes', col_2: 'In progress', col_3: localDateString(new Date(Date.now() + 5 * 86_400_000)), col_4: 'Bay 2', is_starred: 0, updated_at: now },
  { row_id: 2, col_1: 'Oil', col_2: 'In progress', col_3: localDateString(new Date(Date.now() - 2 * 86_400_000)), col_4: null, is_starred: 1, updated_at: now },
  { row_id: 3, col_1: 'Tires', col_2: 'Estimate', col_3: null, is_starred: 0, updated_at: now },
  { row_id: 4, col_1: 'Wipers', col_2: 'Done', col_3: null, is_starred: 0, updated_at: old },
  { row_id: 5, col_1: 'Glass', col_2: 'Done', col_3: null, is_starred: 0, updated_at: now },
  { row_id: 6, col_1: 'Paint', col_2: null, col_3: null, is_starred: 0, updated_at: now },
] as unknown as GridRow[]
const filters = { activeFilters: [], filterMode: 'and' as const, showStarredOnly: false, searchQuery: '' }

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div> }

beforeEach(() => {
  setWords(); invoke.mockClear()
  useAlertStore.setState({ rules: [{ id: 5, name: 'Promised', description: null, is_system: 0, interval_days: null, created_at: '', thresholds: [{ daysBefore: 0, bgClass: '#dc2626', label: 'Late' }] }] } as never)
  useGridStore.setState({ activeGridId: 1, columns, hiddenColumns: [], rows, grids: [], activeFilters: [], filterMode: 'and', showStarredOnly: false, searchQuery: '', rowTagsMap: new Map(), acuityLevels: [], acuityEnabled: false, deadlineContext: null } as never)
})

describe('board lanes', () => {
  it('put records in stage order, nearest deadline first, done ones hidden after a while', () => {
    const lanes = buildLanes(rows, 2, stage, { nameOf: r => String(r.col_1), dueOf: r => (r.row_id === 2 ? -2 : r.row_id === 1 ? 5 : null) })
    expect(lanes.map(l => [l.option?.value ?? null, l.rows.map(r => r.col_1), l.hidden])).toEqual([
      ['Estimate', ['Tires'], 0], ['In progress', ['Oil', 'Brakes'], 0], ['Done', ['Glass'], 1], [null, ['Paint'], 0],
    ])
  })

  it('apply filters, starred and search like the table', () => {
    expect(visibleRows(rows, columns, { ...filters, showStarredOnly: true }).map(r => r.row_id)).toEqual([2])
    expect(visibleRows(rows, columns, { ...filters, searchQuery: 'ti' }).map(r => r.row_id)).toEqual([3])
    expect(visibleRows(rows, columns, { ...filters, activeFilters: [{ columnId: 4, operator: 'is_not_empty', value: '' }] }).map(r => r.row_id)).toEqual([1])
  })
})

describe('the board', () => {
  it('shows lanes with counts and cards with chosen fields and deadline chips; a card opens its record', async () => {
    render(<MemoryRouter><Routes><Route path="*" element={<><BoardView /><Where /></>} /></Routes></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const board = screen.getByRole('list', { name: 'Board by Status' })
    expect(within(board).getAllByRole('listitem').filter(li => li.tagName === 'SECTION').map(s => s.getAttribute('aria-label'))).toEqual(['Estimate, 1', 'In progress, 2', 'Done, 1', 'No status, 1'])
    const lane = screen.getByRole('list', { name: 'In progress' })
    const cards = within(lane).getAllByRole('button')
    expect(cards.map(c => c.textContent)).toEqual([expect.stringMatching(/^Oil.*Promised: Overdue 2 days/), expect.stringMatching(/^BrakesBay: Bay 2Promised: Due in 5 days/)])
    expect(screen.getByText(/^1 older \w+ hidden$/)).toBeTruthy()
    fireEvent.click(cards[1]!)
    expect(screen.getByTestId('where').textContent).toBe('/profile/1')
  })

  it('remembers board mode in saved views', () => {
    useGridStore.setState({ savedViews: [{ id: 1, grid_id: 1, name: 'Jobs board', config: JSON.stringify({ sortConfig: [], activeFilters: [], filterMode: 'and', hiddenColumnIds: [], groupByColumnId: null, showStarredOnly: false, viewMode: 'board' }) }] } as never)
    useGridStore.getState().applySavedView(1)
    expect(useGridStore.getState().viewMode).toBe('board')
  })
})

describe('moving cards from the keyboard', () => {
  it('arrows move focus between cards; Ctrl+Shift+arrow moves a card to the next stage and says so', async () => {
    render(<MemoryRouter><BoardView /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const card = (name: string) => screen.getAllByRole('button').find(b => b.textContent?.startsWith(name))!
    card('Oil').focus()
    fireEvent.keyDown(card('Oil'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(card('Brakes'))
    fireEvent.keyDown(card('Brakes'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(card('Tires'))
    await act(async () => { fireEvent.keyDown(card('Brakes'), { key: 'ArrowRight', ctrlKey: true, shiftKey: true }) })
    expect(invoke).toHaveBeenCalledWith('stages:move', 1, 2, 'Done')
    expect(screen.getByText('Moved Brakes to Done').getAttribute('aria-live')).toBe('polite')
    // The last stage has nowhere further to go
    invoke.mockClear()
    await act(async () => { fireEvent.keyDown(card('Glass'), { key: 'ArrowRight', ctrlKey: true, shiftKey: true }) })
    expect(invoke).not.toHaveBeenCalledWith('stages:move', expect.anything(), expect.anything(), expect.anything())
  })
})

describe('time in stage on cards', () => {
  it('shows how long each card has been in its lane', async () => {
    render(<MemoryRouter><BoardView /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 350)) })
    const card = (name: string) => screen.getAllByRole('button').find(b => b.textContent?.startsWith(name))!
    expect(card('Brakes').textContent).toContain('3 days here')
    expect(card('Tires').textContent).toContain('About 31 days here')
    expect(card('Oil').textContent).not.toContain('here')
  })
})
