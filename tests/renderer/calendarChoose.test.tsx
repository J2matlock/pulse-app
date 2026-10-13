// @vitest-environment jsdom
/**
 * The Calendar's "Which deadlines…" menu and each column's "Show on the Calendar" switch (calendar-flexibility plan, Part 1),
 * and adding from the Calendar: the New… chooser, a deadline for a record, a task and an event (Part 2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

let settings: Record<string, string | null> = {}
const usage = [
  { rule_id: 1, column_id: 9, column_name: 'Care plan review', grid_id: 2, grid_name: 'Clients', hidden: false },
  { rule_id: 1, column_id: 10, column_name: 'Phone contact', grid_id: 2, grid_name: 'Clients', hidden: false },
  { rule_id: 2, column_id: 20, column_name: 'Inspection', grid_id: 3, grid_name: 'Vehicles', hidden: true },
]
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  if (channel === 'settings:get') return { ok: true, data: settings[args[0] as string] ?? null }
  if (channel === 'settings:update') { settings[args[0] as string] = args[1] as string; return { ok: true, data: true } }
  if (channel === 'alert-rule:usage') return { ok: true, data: usage }
  if (channel === 'appointments:list' || channel === 'calendar:items') return { ok: true, data: [] }
  if (channel === 'search:clients-cross-grid') return { ok: true, data: [{ rowId: 4, gridId: 2, clientName: 'Jane Smith', gridName: 'Clients' }] }
  if (channel === 'calendar:deadline-options') return { ok: true, data: deadlineOptions(args[1] as string) }
  if (channel === 'cell:update') return { ok: true, data: { sysLogId: null, previous: '2026-01-10' } }
  if (channel === 'task:create') return { ok: true, data: { id: 3, ...(args[0] as object) } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

const deadlineOptions = (due: string) => [
  { columnId: 9, columnName: 'Care plan review', current: '2026-01-10', value: due === '2026-10-20' ? '2026-04-20' : '2026-04-21', reason: null, nearest: [] },
  { columnId: 11, columnName: 'Quarterly report', current: null, value: null, reason: 'This deadline is only due on its scheduled dates.', nearest: ['2026-10-15', '2027-01-15'] },
  { columnId: 12, columnName: 'Oil change', current: null, value: null, reason: 'It\'s worked out from miles readings, so it can\'t be set from a date.', nearest: [] },
]

import CalendarView from '../../src/renderer/views/CalendarView'
import toast from 'react-hot-toast'
import { DeadlineForRecordDialog } from '../../src/renderer/components/calendar/DeadlineForRecordDialog'
import { useUndoStore } from '../../src/renderer/stores/undoStore'
import { localDateString } from '../../src/shared/dates'
import { CalendarColumnSwitch } from '../../src/renderer/components/grid/CalendarColumnSwitch'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { setWords } from './vocabFixture'
import { renderSettled } from './renderSettled'

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

beforeEach(() => {
  setWords(); invoke.mockClear(); settings = {}
  useWorkspaceStore.setState({ features: { appointments: true, tasks: true } } as never)
})

describe('Which deadlines… on the Calendar', () => {
  it('lists deadline columns by list, all ticked when nothing was chosen, and saves the hidden ones', async () => {
    render(<MemoryRouter><CalendarView /></MemoryRouter>)
    await settle()
    const opener = screen.getByRole('button', { name: /^Which deadlines/ })
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(opener)
    await settle()
    const menu = screen.getByRole('dialog', { name: 'Deadlines on the Calendar' })
    expect(within(menu).getByRole('group', { name: 'Clients' })).toBeTruthy()
    expect(within(menu).getByRole('group', { name: 'Vehicles' })).toBeTruthy()
    const boxes = within(menu).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map(b => [b.getAttribute('aria-label'), b.checked])).toEqual([
      ['Care plan review (Clients)', true], ['Phone contact (Clients)', true], ['Inspection (Vehicles)', true],
    ])
    expect(within(menu).getByText('(hidden in the list)')).toBeTruthy()

    invoke.mockClear()
    await act(async () => { fireEvent.click(within(menu).getByLabelText('Phone contact (Clients)')) })
    await settle()
    expect(invoke).toHaveBeenCalledWith('settings:update', 'calendar_hidden_deadline_columns', '[10]')
    // The items come again from main, which leaves the column out
    expect(invoke.mock.calls.some(c => c[0] === 'calendar:items')).toBe(true)
    expect((within(menu).getByLabelText('Phone contact (Clients)') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('button', { name: /^Which deadlines \(1 hidden\)/ })).toBeTruthy()

    await act(async () => { fireEvent.click(within(menu).getByRole('button', { name: 'Show all' })) })
    expect(settings.calendar_hidden_deadline_columns).toBe('[]')
  })

  it('remembers what was hidden, and Escape closes it with focus back on the button', async () => {
    settings.calendar_hidden_deadline_columns = '[9,20]'
    render(<MemoryRouter><CalendarView /></MemoryRouter>)
    await settle()
    const opener = screen.getByRole('button', { name: /^Which deadlines \(2 hidden\)/ })
    fireEvent.click(opener)
    await settle()
    expect((screen.getByLabelText('Care plan review (Clients)') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('Phone contact (Clients)') as HTMLInputElement).checked).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Deadlines on the Calendar' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('goes away with the Deadlines chip', async () => {
    render(<MemoryRouter><CalendarView /></MemoryRouter>)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Deadlines' }))
    expect(screen.queryByRole('button', { name: /^Which deadlines/ })).toBeNull()
  })
})

describe('Show on the Calendar, in a column\'s settings', () => {
  it('reads and writes the same setting, leaving other columns alone', async () => {
    settings.calendar_hidden_deadline_columns = '[20]'
    await renderSettled(<CalendarColumnSwitch columnId={9} />)
    const sw = screen.getByRole('switch', { name: /Show on the Calendar/ })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await act(async () => { fireEvent.click(sw) })
    expect(settings.calendar_hidden_deadline_columns).toBe('[9,20]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await act(async () => { fireEvent.click(sw) })
    expect(settings.calendar_hidden_deadline_columns).toBe('[20]')
  })

  it('starts off for a column hidden from the Calendar menu', async () => {
    settings.calendar_hidden_deadline_columns = '[9]'
    await renderSettled(<CalendarColumnSwitch columnId={9} />)
    expect(screen.getByRole('switch', { name: /Show on the Calendar/ }).getAttribute('aria-checked')).toBe('false')
  })
})

describe('adding from the Calendar', () => {
  const today = localDateString()

  async function openChooserByClickingToday() {
    render(<MemoryRouter><CalendarView /></MemoryRouter>)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await settle()
    fireEvent.click(document.querySelector(`[data-day="${today}"]`) as HTMLElement)
    return screen.getByRole('dialog', { name: /^Add to / })
  }

  it('clicking an empty part of a day offers an event, an appointment, a deadline or a task', async () => {
    const chooser = await openChooserByClickingToday()
    expect(within(chooser).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.querySelector('.font-medium')?.textContent)).toEqual(
      ['Close', 'Event', 'Appointment', 'Deadline for a client', 'Task'])
    // Each option says what it is to screen readers too
    expect(within(chooser).getByRole('button', { name: 'Event' }).getAttribute('aria-describedby')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /^Add to / })).toBeNull()
  })

  it('leaves out what is switched off', async () => {
    useWorkspaceStore.setState({ features: { appointments: false, tasks: false } } as never)
    render(<MemoryRouter><CalendarView /></MemoryRouter>)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'New…' }))
    const chooser = screen.getByRole('dialog', { name: /^Add to / })
    expect(within(chooser).queryByRole('button', { name: 'Appointment' })).toBeNull()
    expect(within(chooser).queryByRole('button', { name: 'Task' })).toBeNull()
    expect(within(chooser).getByRole('button', { name: 'Event' })).toBeTruthy()
  })

  it('an event opens the event dialog on that day', async () => {
    const chooser = await openChooserByClickingToday()
    fireEvent.click(within(chooser).getByRole('button', { name: 'Event' }))
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'New event' })
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toBe(today)
  })

  it('a task opens the task dialog with the day as its due date', async () => {
    const chooser = await openChooserByClickingToday()
    fireEvent.click(within(chooser).getByRole('button', { name: 'Task' }))
    await settle()
    const dialog = screen.getByRole('dialog', { name: /task/i })
    expect((within(dialog).getByLabelText(/Due date/i) as HTMLInputElement).value).toBe(today)
  })

  it('a deadline for a record sets the chosen column so it is due that day, through the usual cell save', async () => {
    const onSaved = vi.fn()
    await renderSettled(<MemoryRouter><DeadlineForRecordDialog date="2026-10-20" onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)
    const dialog = screen.getByRole('dialog', { name: 'Deadline for a client' })
    fireEvent.change(within(dialog).getByLabelText('Find a client'), { target: { value: 'jan' } })
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    fireEvent.click(within(dialog).getByRole('button', { name: /Jane Smith/ }))
    await settle()
    expect(invoke).toHaveBeenCalledWith('calendar:deadline-options', 4, '2026-10-20')
    // The only usable column is chosen; the others are listed, but can't be picked, with the reason
    const review = within(dialog).getByRole('radio', { name: 'Care plan review' }) as HTMLInputElement
    expect(review.checked).toBe(true)
    expect(within(dialog).getByText('Pulse will set it to Apr 20, 2026 (now Jan 10, 2026).')).toBeTruthy()
    expect((within(dialog).getByRole('radio', { name: 'Oil change' }) as HTMLInputElement).disabled).toBe(true)
    expect(within(dialog).getByText(/miles readings/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Oct 15, 2026' })).toBeTruthy()

    invoke.mockClear()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Set deadline' })) })
    expect(invoke).toHaveBeenCalledWith('cell:update', 4, 9, '2026-04-20')
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Jane Smith: Care plan review is due Oct 20, 2026')
    expect(onSaved).toHaveBeenCalled()
    // One undo step, named for the record and column
    const top = useUndoStore.getState().undoStack.at(-1)!
    expect(top).toMatchObject({ description: 'Changed Care plan review', contextLabel: 'Jane Smith' })
  })

  it('a nearest-day button moves the due date', async () => {
    await renderSettled(<MemoryRouter><DeadlineForRecordDialog date="2026-10-20" onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Find a client'), { target: { value: 'jan' } })
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    fireEvent.click(screen.getByRole('button', { name: /Jane Smith/ }))
    await settle()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Oct 15, 2026' })) })
    await settle()
    expect((screen.getByLabelText('Due on') as HTMLInputElement).value).toBe('2026-10-15')
    expect(invoke).toHaveBeenCalledWith('calendar:deadline-options', 4, '2026-10-15')
  })
})
