// @vitest-environment jsdom
/**
 * "Here's your caseload": one late deadline lit up (UX pass Q7). Its "Mark it
 * done" does the job, but only on a made-up sample record; on the person's own
 * it explains and writes nothing (persona study D2: Linda's Last Contact).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }))
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => channel === 'deadlines:mark-done'
  ? { ok: true, data: { previous: '2025-09-25', newValue: '2026-10-10', finishedFor: null, sysLogId: 5, checklistItemIds: [] } }
  : { ok: true, data: { meter: {}, quota: {}, progress: {}, extensions: {} } })
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { FirstLook, pickLateCell, FIRST_LOOK_WAIT_MS } from '../../../../src/renderer/components/onboarding/FirstLook'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { useHintStore } from '../../../../src/renderer/stores/hintStore'
import { useSettingsStore } from '../../../../src/renderer/stores/settingsStore'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import type { Column, GridRow, ParsedAlertRule } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

const col = (id: number, name: string, type: string, config = '{}', extra: Partial<Column> = {}) => ({ id, grid_id: 1, name, column_type: type, width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '', ...extra }) as Column
const yearly = { id: 7, name: 'Every year', description: null, is_system: 0, thresholds: [], interval_days: null, interval_months: 12, created_at: '', kind: 'interval' } as ParsedAlertRule
const dueDate = { ...yearly, id: 8, name: 'Due date', interval_months: null } as ParsedAlertRule
const columns = [
  col(1, 'Name', 'text', '{}', { is_name_column: 1 }),
  col(3, 'Annual review', 'date', '{"alert_rule_id":7}'),
  col(4, 'License expires', 'date', '{"alert_rule_id":8}'),
]
const LATE_YEARLY = '2025-09-25' // due Sep 25, 2026: late on Oct 10, 2026
const LATE_DATE = '2026-09-01'
const NOT_LATE = '2026-08-01' // yearly: due Aug 1, 2027

function rowOf(id: number, name: string, review: string | null, license: string | null): GridRow {
  return { row_id: id, col_1: name, col_3: review, col_4: license } as unknown as GridRow
}

/** The grid as the DOM has it: rows in order, a cell per rule column */
function drawGrid(rows: GridRow[]): void {
  document.body.innerHTML = `<div role="grid">${rows.map((r, i) => `<div aria-rowindex="${i + 2}">${
    [1, 3, 4].map(c => `<div data-row-id="${r.row_id}" data-col-id="${c}"></div>`).join('')}</div>`).join('')}</div>`
}

function setup(rows: GridRow[], extra: { sampleRows?: Record<number, number> } = {}) {
  useGridStore.setState({
    activeGridId: 1, loadedGridId: 1, isLoading: false, rows, columns, sampleRows: extra.sampleRows ?? {},
    deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {} },
  } as never)
  drawGrid(rows)
}

/** Time passes, then once more for what the first look does after it renders (focus, measuring) */
const wait = async (ms = 400) => {
  await act(async () => { vi.advanceTimersByTime(ms) })
  await act(async () => { vi.advanceTimersByTime(100) })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 9, 10, 12))
  invoke.mockClear()
  setWords()
  useAlertStore.setState({ rules: [yearly, dueDate], isLoaded: true })
  useHintStore.setState({ seen: new Set() })
  useSettingsStore.setState({ reducedMotion: false })
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** Every record a made-up sample */
const samples = (...ids: number[]) => ({ sampleRows: Object.fromEntries(ids.map(id => [id, 0])) })

describe('which deadline the first look shows', () => {
  it('the top-most late cell', () => {
    setup([rowOf(9, 'Robert', NOT_LATE, null), rowOf(10, 'Maria', LATE_YEARLY, null), rowOf(11, 'Ann', LATE_YEARLY, null)], samples(9, 10, 11))
    const pick = pickLateCell()!
    expect(pick.row.row_id).toBe(10)
    expect(pick.column.id).toBe(3)
    expect(pick.doneable).toBe(true)
    expect(pick.real).toBe(false)
  })

  it('prefers one whose Done is a single click over a date that doesn\'t repeat', () => {
    setup([rowOf(9, 'Robert', NOT_LATE, LATE_DATE), rowOf(10, 'Maria', LATE_YEARLY, null)], samples(9, 10))
    expect(pickLateCell()!.row.row_id).toBe(10)
  })

  it('the person\'s own records (an imported list): still picked for the colour, never doneable', () => {
    setup([rowOf(9, 'Melissa Ortiz', LATE_YEARLY, null), rowOf(10, 'Maria', LATE_YEARLY, null)])
    const pick = pickLateCell()!
    expect(pick.row.row_id).toBe(9)
    expect(pick.doneable).toBe(false)
    expect(pick.real).toBe(true)
  })

  it('prefers a sample record over the person\'s own', () => {
    setup([rowOf(9, 'Robert', LATE_YEARLY, null), rowOf(10, 'Maria', LATE_YEARLY, null)], { sampleRows: { 10: 1 } })
    expect(pickLateCell()!.row.row_id).toBe(10)
  })

  it('leaves out deadlines that are done or paused', () => {
    setup([rowOf(9, 'Robert', NOT_LATE, LATE_DATE), rowOf(10, 'Maria', NOT_LATE, LATE_DATE)])
    useGridStore.setState({ deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {}, finished: { '9:4': [LATE_DATE] } } } as never)
    expect(pickLateCell()!.row.row_id).toBe(10)
  })

  it('nothing late: nothing to show', () => {
    setup([rowOf(9, 'Robert', NOT_LATE, null)])
    expect(pickLateCell()).toBeNull()
  })
})

describe('FirstLook', () => {
  it('nothing late: no first look at all, and it counts as seen', async () => {
    setup([rowOf(9, 'Robert', NOT_LATE, null)])
    const onClose = vi.fn()
    render(<FirstLook onClose={onClose} />)
    await wait()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onClose).toHaveBeenCalled()
    expect(useHintStore.getState().isSeen('caseload')).toBe(true)
  })

  it('an existing workspace (everything seen) never sees it', async () => {
    setup([rowOf(9, 'Robert', LATE_YEARLY, null)])
    useHintStore.setState({ seen: 'all' })
    const onClose = vi.fn()
    render(<FirstLook onClose={onClose} />)
    await wait()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onClose).toHaveBeenCalled()
  })

  it('gives up quietly when the list never arrives', async () => {
    setup([rowOf(9, 'Robert', LATE_YEARLY, null)])
    useGridStore.setState({ loadedGridId: null })
    const onClose = vi.fn()
    render(<FirstLook onClose={onClose} />)
    await wait(FIRST_LOOK_WAIT_MS + 400)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onClose).toHaveBeenCalled()
  })

  it('a sample: a labelled modal dialog naming the record and column, with focus on "Mark it done"', async () => {
    setup([rowOf(9, 'Robert', LATE_YEARLY, null)], samples(9))
    render(<FirstLook onClose={vi.fn()} />)
    await wait()
    const dialog = screen.getByRole('dialog', { name: "Here's your caseload" })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain("Robert's Annual review is red.")
    expect(dialog.textContent).toContain('Red means overdue. This one is made up, so try "Mark it done".')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mark it done' }))
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(useHintStore.getState().isSeen('caseload')).toBe(true)
  })

  it('a sample: "Mark it done" marks the deadline done, the normal way, with an Undo, and closes', async () => {
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
    setup([rowOf(9, 'Robert', LATE_YEARLY, null)], samples(9))
    const onClose = vi.fn()
    render(<FirstLook onClose={onClose} />)
    await wait()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark it done' })) })
    expect(invoke).toHaveBeenCalledWith('deadlines:mark-done', 9, 3, { kind: 'repeat' }, null, null)
    expect(useUndoStore.getState().undoStack.length).toBe(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('Linda: an imported list (no samples) with a late repeating deadline gets Got it only, and nothing is written', async () => {
    setup([rowOf(9, 'Melissa Ortiz', LATE_YEARLY, null)])
    const onClose = vi.fn()
    render(<FirstLook onClose={onClose} />)
    await wait()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain("Melissa Ortiz's Annual review is red.")
    expect(dialog.textContent).toContain('Red means overdue.')
    expect(dialog.textContent).toContain('When it\'s really done, right-click its date and choose "Mark done or extend…".')
    expect(dialog.textContent).not.toContain('made up')
    expect(screen.queryByRole('button', { name: 'Mark it done' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    const gotIt = screen.getByRole('button', { name: 'Got it' })
    expect(document.activeElement).toBe(gotIt)
    await act(async () => { fireEvent.click(gotIt) })
    expect(onClose).toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('deadlines:mark-done', expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything())
  })

  it('Close and Escape close it without marking anything done', async () => {
    setup([rowOf(9, 'Robert', LATE_YEARLY, null)], samples(9))
    const onClose = vi.fn()
    const a = render(<FirstLook onClose={onClose} />)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    a.unmount()
    useHintStore.setState({ seen: new Set() })
    drawGrid(useGridStore.getState().rows)
    render(<FirstLook onClose={onClose} />)
    await wait()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(invoke).not.toHaveBeenCalledWith('deadlines:mark-done', expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything())
  })

  it('a late date that needs a dialog to be done: "Got it" only, no Done', async () => {
    setup([rowOf(9, 'Robert', NOT_LATE, LATE_DATE)], samples(9))
    render(<FirstLook onClose={vi.fn()} />)
    await wait()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain("Robert's License expires is red.")
    expect(dialog.textContent).toContain('Red means overdue.')
    expect(dialog.textContent).not.toContain('Mark it done')
    expect(dialog.textContent).not.toContain('right-click')
    expect(screen.queryByRole('button', { name: 'Mark it done' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy()
  })

  it('the ring pulses, and doesn\'t under reduced motion', async () => {
    setup([rowOf(9, 'Robert', LATE_YEARLY, null)])
    const a = render(<FirstLook onClose={vi.fn()} />)
    await wait()
    expect(screen.getByTestId('first-look-ring').style.animation).toMatch(/first-look-pulse/)
    a.unmount()
    useSettingsStore.setState({ reducedMotion: true })
    useHintStore.setState({ seen: new Set() })
    drawGrid(useGridStore.getState().rows)
    render(<FirstLook onClose={vi.fn()} />)
    await wait()
    expect(screen.getByTestId('first-look-ring').style.animation).toBe('none')
  })

  it('speaks the list\'s own words', async () => {
    setWords({ list: { one: 'fleet', many: 'fleets', article: 'a' } })
    setup([rowOf(9, 'Van 4', LATE_YEARLY, null)])
    render(<FirstLook onClose={vi.fn()} />)
    await wait()
    expect(screen.getByRole('dialog', { name: "Here's your fleet" })).toBeTruthy()
  })
})
