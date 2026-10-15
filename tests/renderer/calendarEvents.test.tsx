// @vitest-environment jsdom
/** Events on the Calendar: appointments with no record, in their own layer, on even with the Appointments feature off. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
import { localDateString } from '../../src/shared/dates'
import { readCalendarLayers, writeCalendarLayers } from '../../src/shared/calendar'

const today = localDateString()
const appt = (id: number, time: string, title: string, extra: Record<string, unknown> = {}) => ({ id, row_id: 4, series_id: null, title, start_at: `${today}T${time}`, end_at: null, all_day: 0, location: null, activity_type_key: null, status: 'scheduled', case_log_id: null, notes: null, is_exception: 0, created_at: '', updated_at: '', record_name: 'Jane', grid_id: 2, grid_name: 'Clients', ...extra })
const event = appt(7, '09:00', 'Staff meeting', { row_id: null, record_name: null, grid_id: null, grid_name: null, location: 'Room 2' })
let settings: Record<string, string | null> = {}
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  if (channel === 'settings:get') return { ok: true, data: settings[args[0] as string] ?? null }
  if (channel === 'settings:update') { settings[args[0] as string] = args[1] as string; return { ok: true, data: true } }
  if (channel === 'appointments:list') return { ok: true, data: [event, appt(1, '15:00', 'Session')] }
  if (channel === 'appointments:create') return { ok: true, data: { snapshot: { appointments: [], series: [], createdAppointmentIds: [9], createdSeriesIds: [] }, ids: [9] } }
  if (channel === 'appointments:delete') return { ok: true, data: { snapshot: { appointments: [], series: [], createdAppointmentIds: [], createdSeriesIds: [] }, ids: [7] } }
  if (channel === 'calendar:items') return { ok: true, data: [] }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import CalendarView from '../../src/renderer/views/CalendarView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { setWords } from './vocabFixture'

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

async function showAgenda() {
  render(<MemoryRouter><Routes><Route path="*" element={<><CalendarView /><Where /></>} /></Routes></MemoryRouter>)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'Agenda' }))
  await settle()
}

beforeEach(() => {
  setWords(); invoke.mockClear(); settings = {}
  useWorkspaceStore.setState({ features: { appointments: true, tasks: true } } as never)
})

describe('the Events layer', () => {
  it('draws events without a record name, apart from appointments, with their own chip', async () => {
    await showAgenda()
    const ev = screen.getByRole('button', { name: /Staff meeting, scheduled$/ })
    expect(ev.textContent).toBe('9:00 am Staff meeting')
    expect(ev.className).toMatch(/teal/)
    expect(screen.getByRole('button', { name: /Session with Jane/ }).className).toMatch(/blue/)
    // Each chip turns off only its own
    fireEvent.click(screen.getByRole('checkbox', { name: 'Events' }))
    expect(screen.queryByText('9:00 am Staff meeting')).toBeNull()
    expect(screen.getByText('3:00 pm Session with Jane')).toBeTruthy()
    expect(JSON.parse(settings.calendar_layers!)).toEqual({ hidden: ['events'] })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Events' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Appointments' }))
    expect(screen.getByText('9:00 am Staff meeting')).toBeTruthy()
    expect(screen.queryByText('3:00 pm Session with Jane')).toBeNull()
  })

  it('opens a clicked event for editing, not a profile, and it can be deleted there', async () => {
    await showAgenda()
    fireEvent.click(screen.getByRole('button', { name: /Staff meeting, scheduled$/ }))
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'Edit event' })
    expect((within(dialog).getByLabelText('What') as HTMLInputElement).value).toBe('Staff meeting')
    expect(within(dialog).queryByText(/log it as/)).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe('/')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' })) })
    expect(invoke).toHaveBeenCalledWith('appointments:delete', 7, 'one')
    expect(screen.queryByRole('dialog', { name: 'Edit event' })).toBeNull()
  })

  it('stays on with the Appointments feature off; N adds an event with no record', async () => {
    useWorkspaceStore.setState({ features: { appointments: false, tasks: true } } as never)
    await showAgenda()
    expect(screen.queryByRole('button', { name: 'Appointments' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Events' })).toBeTruthy()
    expect(screen.getByText('9:00 am Staff meeting')).toBeTruthy()
    // Main sends only events then; the window asks the same way either way
    expect(invoke.mock.calls.some(c => c[0] === 'appointments:list')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await settle()
    const cell = document.querySelector(`[data-day="${today}"]`) as HTMLElement
    act(() => { cell.focus() })
    fireEvent.keyDown(cell, { key: 'n' })
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'New event' })
    // No record to choose while appointments are off
    expect(within(dialog).queryByText('With')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('What'), { target: { value: 'Training' } })
    fireEvent.change(within(dialog).getByLabelText('Where (optional)'), { target: { value: 'Room 2' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Add event' })) })
    const create = invoke.mock.calls.find(c => c[0] === 'appointments:create')!
    expect(create[1]).toMatchObject({ row_id: null, title: 'Training', start_at: `${today}T09:00`, location: 'Room 2', all_day: false })
  })

  it('an event can repeat and be all day', async () => {
    useWorkspaceStore.setState({ features: { appointments: false, tasks: true } } as never)
    await showAgenda()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Agenda' }), { key: 'n' })
    await settle()
    const dialog = screen.getByRole('dialog', { name: 'New event' })
    fireEvent.change(within(dialog).getByLabelText('What'), { target: { value: 'Day off' } })
    fireEvent.click(within(dialog).getByLabelText('All day'))
    fireEvent.change(within(dialog).getByLabelText('Repeats'), { target: { value: 'weekly' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Add event' })) })
    const create = invoke.mock.calls.find(c => c[0] === 'appointments:create')!
    expect(create[1]).toMatchObject({ row_id: null, title: 'Day off', start_at: today, all_day: true })
    expect(create[2]).toMatchObject({ freq: 'weekly', interval: 1 })
  })
})

describe('remembered layers', () => {
  it('a list saved before Events existed shows Events too', () => {
    expect([...readCalendarLayers('["appointments","tasks"]')].sort()).toEqual(['appointments', 'events', 'tasks'])
    expect([...readCalendarLayers(writeCalendarLayers(new Set(['deadlines'])))]).toEqual(['deadlines'])
    expect(readCalendarLayers(null).size).toBe(5)
    expect(readCalendarLayers('nonsense').size).toBe(5)
  })
})
