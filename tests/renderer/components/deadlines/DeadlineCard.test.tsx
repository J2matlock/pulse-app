// @vitest-environment jsdom
/** A grid cell's deadline card (UX pass Q3): opened by event, focus on Done, Escape and a click outside close it. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
let served: unknown[] = []
const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { DeadlineCardHost } from '../../../../src/renderer/components/deadlines/DeadlineCardHost'
import { placeCard } from '../../../../src/renderer/components/deadlines/DeadlineCard'
import { openDeadlineCard } from '../../../../src/renderer/components/deadlines/openDeadlineCard'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { IPC } from '../../../../src/shared/ipc-channels'
import type { Column, GridRow } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

const col = (id: number, name: string, type: string, config = '{}', extra: Partial<Column> = {}) => ({ id, grid_id: 1, name, column_type: type, width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '', ...extra }) as Column
const loaded = {
  row_id: 9, grid_id: 1, grid_name: 'Caseload', column_id: 3, column_name: 'Annual review', column_config: '{"alert_rule_id":7}',
  date_value: '2025-10-26', client_name: 'Robert', interval_days: null, interval_months: 12, end_of_month: null, rule_kind: 'interval',
  due: '2026-10-26', state: 'ok', daysUntil: 11, estimated: false, detail: '',
}
const refreshDeadlineContext = vi.fn(async () => {})

function renderGrid() {
  render(
    <MemoryRouter>
      <div role="grid">
        <div role="gridcell" tabIndex={-1} data-row-id="9" data-col-id="3" data-testid="cell">Oct 26, 2025</div>
      </div>
      <button type="button">Somewhere else</button>
      <DeadlineCardHost />
    </MemoryRouter>,
  )
  return screen.getByTestId('cell')
}

beforeEach(() => {
  setWords()
  served = [loaded]
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string) => channel === IPC.DEADLINES_GET ? { ok: true, data: served }
    : channel === IPC.DEADLINE_MARK_DONE ? { ok: true, data: { previous: '2025-10-26', newValue: '2026-10-15', finishedFor: null, sysLogId: 5, checklistItemIds: [] } }
    : { ok: true, data: null })
  refreshDeadlineContext.mockClear()
  useGridStore.setState({
    activeGridId: 1,
    columns: [col(1, 'Name', 'text', '{}', { is_name_column: 1 }), col(3, 'Annual review', 'date', '{"alert_rule_id":7}')],
    rows: [{ row_id: 9, col_1: 'Robert', col_3: '2025-10-26' } as unknown as GridRow],
    refreshDeadlineContext,
  } as never)
})

describe('the grid deadline card', () => {
  it('opens from the event with "Loading…", then the card, with focus on Done', async () => {
    const cell = renderGrid()
    act(() => { openDeadlineCard(9, 3, cell) })
    const card = screen.getByRole('dialog', { name: 'Annual review · Robert' })
    expect(card.textContent).toContain('Loading…')
    const done = await screen.findByRole('button', { name: 'Mark Annual review done for Robert' })
    await waitFor(() => expect(document.activeElement).toBe(done))
    expect(screen.getByTestId('deadline-card-due').textContent).toBe('Due Oct 26, 2026 · 11 days')
    expect(screen.getByRole('button', { name: 'Open client' })).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINES_GET, { rowIds: [9], includeDone: true })
  })

  it('Escape closes it and puts focus back on the cell', async () => {
    const cell = renderGrid()
    act(() => { openDeadlineCard(9, 3, cell) })
    const done = await screen.findByRole('button', { name: 'Mark Annual review done for Robert' })
    await waitFor(() => expect(document.activeElement).toBe(done))
    act(() => { fireEvent.keyDown(done, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(cell)
  })

  it('a click outside closes it', async () => {
    const cell = renderGrid()
    act(() => { openDeadlineCard(9, 3, cell) })
    await screen.findByRole('button', { name: 'Mark Annual review done for Robert' })
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Somewhere else' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a click inside does not close it, and a scroll of the list does', async () => {
    const cell = renderGrid()
    act(() => { openDeadlineCard(9, 3, cell) })
    const card = await screen.findByRole('dialog')
    act(() => { fireEvent.mouseDown(card) })
    expect(screen.getByRole('dialog')).toBeTruthy()
    act(() => { fireEvent.scroll(window) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Done marks it, redraws the list\'s colours and closes', async () => {
    const cell = renderGrid()
    act(() => { openDeadlineCard(9, 3, cell) })
    const done = await screen.findByRole('button', { name: 'Mark Annual review done for Robert' })
    await act(async () => { fireEvent.click(done) })
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_MARK_DONE, 9, 3, { kind: 'repeat' }, null, null)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(refreshDeadlineContext).toHaveBeenCalled()
    // The cell shows the new date at once (patched by completeDeadlines)
    expect(useGridStore.getState().rows[0]).toMatchObject({ col_3: '2026-10-15' })
  })

  it('says "Nothing due yet" when the engine has nothing due', async () => {
    served = []
    const cell = renderGrid()
    act(() => { openDeadlineCard(9, 3, cell) })
    expect(await screen.findByText('Nothing due yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open client' })).toBeTruthy()
  })

  it('finds the cell itself when no anchor is given (the cell menu)', async () => {
    renderGrid()
    act(() => { openDeadlineCard(9, 3) })
    expect(await screen.findByRole('dialog', { name: 'Annual review · Robert' })).toBeTruthy()
  })

  it('flips above a cell near the bottom of the window', async () => {
    const cell = renderGrid()
    // jsdom's window is 768 px tall and draws the card 0 px high: the cell's bottom edge is in the last 16 px
    cell.getBoundingClientRect = () => ({ top: 716, bottom: 760, left: 40, right: 190, width: 150, height: 44, x: 40, y: 716, toJSON: () => ({}) })
    act(() => { openDeadlineCard(9, 3, cell) })
    const card = screen.getByRole('dialog')
    expect(card.dataset.placement).toBe('above')
  })
})

describe('placeCard', () => {
  const rect = (top: number, left: number) => ({ top, bottom: top + 44, left, right: left + 150, width: 150, height: 44, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  const view = { width: 1366, height: 768 }

  it('goes under the cell when there is room', () => {
    expect(placeCard(rect(100, 300), 200, view)).toEqual({ top: 148, left: 300, width: 320, above: false })
  })

  it('goes above the cell when it would run off the bottom', () => {
    expect(placeCard(rect(600, 300), 200, view)).toEqual({ top: 396, left: 300, width: 320, above: true })
  })

  it('stays 16 px inside the window on the right and on a narrow screen', () => {
    expect(placeCard(rect(100, 1300), 200, view).left).toBe(1366 - 16 - 320)
    expect(placeCard(rect(100, 0), 200, { width: 340, height: 640 })).toMatchObject({ left: 16, width: 308 })
  })
})
