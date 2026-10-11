// @vitest-environment jsdom
/** The calendar (W07 §6): month cells with events, "+N more", layers, agenda, keyboard, panel and new appointment. */
import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
import { localDateString } from '../../src/shared/dates'
import { monthGrid } from '../../src/shared/calendar'
const today = localDateString()
const appt = (id: number, time: string, title: string, extra: Record<string, unknown> = {}) => ({ id, row_id: 4, series_id: null, title, start_at: `${today}T${time}`, end_at: null, all_day: 0, location: null, activity_type_key: null, status: 'scheduled', case_log_id: null, notes: null, is_exception: 0, created_at: '', updated_at: '', record_name: 'Jane', grid_id: 2, grid_name: 'Clients', ...extra })
let appointments = [appt(1, '15:00', 'Session'), appt(2, '09:00', 'Intake')]
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'appointments:list') return { ok: true, data: appointments }
  if (channel === 'calendar:items') return { ok: true, data: [
    { kind: 'deadline', key: 'deadline-4-9', date: today, title: 'Review', rowId: 4, gridId: 2, recordName: 'Jane', state: 'overdue', daysUntil: -1 },
    { kind: 'task', key: 'task-1', date: today, title: 'Order forms' },
  ] }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import CalendarView, { eventsByDay } from '../../src/renderer/views/CalendarView'
import { AppointmentDialog } from '../../src/renderer/components/calendar/AppointmentDialog'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { setWords } from './vocabFixture'
import { renderSettled } from './renderSettled'

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }
/** Let the reload a view switch starts finish before asserting on what it shows */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

async function show(mode: 'Month' | 'Week' = 'Month') {
  render(<MemoryRouter><Routes><Route path="*" element={<><CalendarView /><Where /></>} /></Routes></MemoryRouter>)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  if (mode === 'Month') {
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await settle()
  }
}

beforeEach(() => {
  setWords(); invoke.mockClear()
  appointments = [appt(1, '15:00', 'Session'), appt(2, '09:00', 'Intake')]
  useWorkspaceStore.setState({ features: { appointments: true, tasks: true } } as never)
})

describe('calendar events', () => {
  it('put appointments first, in time order, and respect layers', () => {
    const by = eventsByDay(appointments as never, [{ kind: 'task', key: 't', date: today, title: 'X' }], new Set(['appointments', 'tasks']))
    expect(by.get(today)!.map(e => e.type === 'appointment' ? e.appt.title : e.item.title)).toEqual(['Intake', 'Session', 'X'])
    expect(eventsByDay(appointments as never, [], new Set(['tasks'])).size).toBe(0)
  })
})

describe('the calendar', () => {
  it('shows today\'s events in the month, with "+N more" past three', async () => {
    await show()
    const cell = document.querySelector(`[data-day="${today}"]`) as HTMLElement
    expect(within(cell).getByRole('button', { name: /9:00 am to|Intake with Jane, scheduled/ })).toBeTruthy()
    expect(within(cell).getByText('+2 more')).toBeTruthy()
    // Turning off appointments leaves the deadline and task
    fireEvent.click(screen.getByRole('button', { name: 'Appointments' }))
    expect(within(cell).queryByText(/Intake/)).toBeNull()
    expect(within(cell).getByText('Jane: Review')).toBeTruthy()
  })

  it('moves the today marker at midnight (AUDIT-025)', async () => {
    await show()
    const { pulseEvents } = await import('../../src/renderer/events')
    const { localDateFromToday } = await import('../../src/shared/dates')
    // A neighbouring day in the same month, so it's on screen
    const next = Number(today.slice(8)) >= 15 ? localDateFromToday(-1) : localDateFromToday(1)
    const marker = (d: string) => (document.querySelector(`[data-day="${d}"] button`) as HTMLElement).className
    expect(marker(today)).toContain('bg-blue-600')
    expect(marker(next)).not.toContain('bg-blue-600')
    await act(async () => { pulseEvents.emit('day:changed', { date: next }) })
    expect(marker(next)).toContain('bg-blue-600')
    expect(marker(today)).not.toContain('bg-blue-600')
  })

  it('leaves tasks off the calendar while the Tasks feature is switched off', async () => {
    useWorkspaceStore.setState({ features: { appointments: true, tasks: false } } as never)
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }))
    await settle()
    expect(screen.queryByText('Task: Order forms')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tasks' })).toBeNull()
  })

  it('labels the layers, shows done with a check, and opens a clicked task (audit S-28)', async () => {
    appointments = [appt(1, '15:00', 'Session', { status: 'done' }), appt(2, '09:00', 'Intake', { status: 'cancelled' })]
    const usual = invoke.getMockImplementation()!
    onTestFinished(() => { invoke.mockImplementation(usual) })
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'appointments:list') return { ok: true, data: appointments }
      if (channel === 'calendar:items') return { ok: true, data: [{ kind: 'task', key: 'task-7', date: today, title: 'Order forms', taskId: 7 }] }
      return { ok: true, data: null }
    })
    await show()
    expect(screen.getByText('Show:')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }))
    await settle()
    const done = screen.getByText('✓ 3:00 pm Session with Jane')
    expect(done.className).not.toMatch(/line-through/)
    expect(screen.getByText('9:00 am Intake with Jane').className).toMatch(/line-through/)
    fireEvent.click(screen.getByText('Task: Order forms'))
    expect(screen.getByTestId('where').textContent).toBe('/tasks?task=7')
  })

  it('agenda lists the day; an appointment opens its panel, a deadline its record', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }))
    await settle()
    const day = screen.getByRole('region', { name: new RegExp(`^${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())}`) })
    expect(within(day).getAllByRole('button').map(b => b.textContent)).toEqual(['9:00 am Intake with Jane', '3:00 pm Session with Jane', 'Jane: Review', 'Task: Order forms'])
    fireEvent.click(within(day).getByRole('button', { name: /Intake with Jane/ }))
    expect(screen.getByRole('heading', { name: 'Intake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Done/ })).toBeTruthy()
    fireEvent.click(within(day).getByText('Jane: Review'))
    expect(screen.getByTestId('where').textContent).toBe('/profile/4?gridId=2')
  })

  it('shows only the weeks the month needs, so the last row is not cut off', async () => {
    await show()
    const grid = screen.getByRole('grid')
    const needed = monthGrid(today, 'sunday').filter(w => w.some(d => d.slice(0, 7) === today.slice(0, 7))).length
    expect(within(grid).getAllByRole('row')).toHaveLength(needed + 1) // + the day names
  })

  it('N opens a new appointment on the focused day', async () => {
    await show()
    const cell = document.querySelector(`[data-day="${today}"]`) as HTMLElement
    act(() => { cell.focus() })
    fireEvent.keyDown(cell, { key: 'n' })
    await settle()
    expect(screen.getByRole('heading', { name: 'New appointment' })).toBeTruthy()
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(today)
  })
})

describe('week view', () => {
  it('opens by default with appointments on, placing them by time; clicking a slot starts a new one there', async () => {
    await show('Week')
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true')
    const day = screen.getByRole('group', { name: new RegExp(`^${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())}`) })
    const intake = within(day).getByRole('button', { name: /Intake with Jane/ })
    expect((intake.parentElement as HTMLElement).style.top).toBe(`${9 * 48}px`)
    // Text starts at the top of the block, in lines short enough for two in the 44px minimum
    expect(intake.className).toMatch(/flex-col/)
    expect((intake.parentElement as HTMLElement).className).toMatch(/leading-\[18px\]/)
    // The deadline and task sit in the all-day row, not the hours
    expect(within(day).queryByText('Jane: Review')).toBeNull()
    expect(screen.getByText('Jane: Review')).toBeTruthy()
    fireEvent.click(day, { clientY: 14.5 * 48 })
    expect(screen.getByRole('heading', { name: 'New appointment' })).toBeTruthy()
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('14:30')
  })

  it('dragging an appointment down moves it, snapped to 15 minutes', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'appointments:list') return { ok: true, data: appointments }
      if (channel === 'appointments:update') return { ok: true, data: { snapshot: { appointments: [], series: [], createdAppointmentIds: [], createdSeriesIds: [] }, ids: [2] } }
      return { ok: true, data: [] }
    })
    await show('Week')
    const intake = screen.getByRole('button', { name: /Intake with Jane/ })
    // Each step on its own, so the drag listeners are in place before the pointer moves
    await act(async () => { fireEvent.pointerDown(intake, { button: 0, clientX: 10, clientY: 100 }) })
    await act(async () => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 100 + 50 })) })
    await act(async () => { window.dispatchEvent(new MouseEvent('pointerup')) })
    expect(invoke).toHaveBeenCalledWith('appointments:update', 2, { start_at: `${today}T10:00`, end_at: null }, 'one')
  })
})

describe('editing a repeating appointment (audit S-18)', () => {
  it('shows its pattern, and a changed pattern applies from this one on without asking', async () => {
    const a = appt(5, '10:00', 'Session', { series_id: 3, series_rule: JSON.stringify({ freq: 'weekly', interval: 1, count: 10 }) })
    await renderSettled(<AppointmentDialog appointment={a as never} onClose={vi.fn()} />)
    expect((screen.getByLabelText('Repeats') as HTMLSelectElement).value).toBe('weekly')
    expect(screen.queryByRole('option', { name: "Doesn't repeat" })).toBeNull()
    expect((screen.getByLabelText('How many times') as HTMLInputElement).value).toBe('10')
    fireEvent.change(screen.getByLabelText('Every how many'), { target: { value: '2' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    const call = invoke.mock.calls.find(c => c[0] === 'appointments:update')!
    expect(call.slice(3)).toEqual(['following', { freq: 'weekly', interval: 2, count: 10 }])
  })
})
