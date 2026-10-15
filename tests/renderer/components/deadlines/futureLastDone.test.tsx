// @vitest-environment jsdom
/** A "last done" date in the future warns, with the fix a click away (persona study R4, Linda's "Last done Dec 4, 2026"). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { DeadlineCardContent } from '../../../../src/renderer/components/deadlines/DeadlineCardContent'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import { IPC } from '../../../../src/shared/ipc-channels'
import { localDateFromToday } from '../../../../src/shared/dates'
import type { Column } from '../../../../src/shared/types'
import type { ExtendedDeadlineInfo } from '../../../../src/renderer/views/dashboard/types'
import { setWords } from '../../vocabFixture'

const future = localDateFromToday(50)
const past = localDateFromToday(-50)
const info = (dateValue: string, over: Partial<ExtendedDeadlineInfo> = {}): ExtendedDeadlineInfo => ({
  rowId: 9, clientName: 'Melissa', gridId: 1, gridName: 'Caseload', columnId: 3, columnName: 'Plan Review', dateValue,
  daysUntil: 400, alertRuleId: 7, threshold: null, intervalDays: null, interval: { days: 0, months: 12, endOfMonth: false },
  due: localDateFromToday(415), detail: '', ruleKind: 'interval', state: 'ok', ...over,
})
const loadGrid = vi.fn(async () => {})
const updateColumn = vi.fn(async () => true)

function renderCard(i: ExtendedDeadlineInfo, onChanged = vi.fn(async () => {})) {
  render(<MemoryRouter><DeadlineCardContent info={i} where="grid" layout="stack" onChanged={onChanged} /></MemoryRouter>)
  return onChanged
}

beforeEach(() => {
  setWords()
  invoke.mockReset()
  invoke.mockImplementation(async () => ({ ok: true, data: 1 }))
  loadGrid.mockClear(); updateColumn.mockClear()
  useUndoStore.getState().clear()
  useGridStore.setState({
    activeGridId: 1, loadGrid, updateColumn,
    columns: [{ id: 3, grid_id: 1, name: 'Plan Review', column_type: 'date', config: '{"alert_rule_id":7}' } as Column],
    hiddenColumns: [],
  } as never)
})

describe('a future "last done" date', () => {
  it('asks whether it is the due date instead of saying "Last done"', () => {
    renderCard(info(future))
    const warning = screen.getByTestId('future-last-done')
    expect(warning.textContent).toMatch(/is in the future\. Is that when it's due\?/)
    expect(screen.queryByText(/^Last done/)).toBeNull()
    expect(screen.getByRole('button', { name: "Make this column's dates the due dates" })).toBeTruthy()
  })

  it('a past date still says "Last done"', () => {
    renderCard(info(past, { rowId: 10 }))
    expect(screen.getByText(/^Last done/)).toBeTruthy()
    expect(screen.queryByTestId('future-last-done')).toBeNull()
  })

  it('a one-off due date never warns', () => {
    renderCard(info(future, { rowId: 11, interval: { days: 0, months: 0, endOfMonth: false } }))
    expect(screen.queryByTestId('future-last-done')).toBeNull()
  })

  it('"It\'s right" hides it for this record and date', () => {
    renderCard(info(future, { rowId: 12 }))
    fireEvent.click(screen.getByRole('button', { name: "It's right" }))
    expect(screen.queryByTestId('future-last-done')).toBeNull()
  })

  it('makes the column\'s dates due dates after saying what it does, with Undo', async () => {
    const onChanged = renderCard(info(future, { rowId: 13 }))
    fireEvent.click(screen.getByRole('button', { name: "Make this column's dates the due dates" }))
    expect(screen.getByTestId('future-last-done').textContent).toMatch(/Every date in “Plan Review” will be read as the day it's due, for every client/)
    fireEvent.click(screen.getByRole('button', { name: 'Make them due dates' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(IPC.ONBOARDING_DATE_RULES, 1, [{ columnId: 3, repeat: 'due' }]))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(loadGrid).toHaveBeenCalledWith(1)
    expect(useUndoStore.getState().undoStack[0]!.description).toBe('“Plan Review” dates are now due dates')
    await useUndoStore.getState().undo()
    expect(updateColumn).toHaveBeenCalledWith(3, { config: '{"alert_rule_id":7}' })
  })
})
