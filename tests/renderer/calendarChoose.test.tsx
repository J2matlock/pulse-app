// @vitest-environment jsdom
/** The Calendar's "Which deadlines…" menu and each column's "Show on the Calendar" switch (calendar-flexibility plan, Part 1). */
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
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import CalendarView from '../../src/renderer/views/CalendarView'
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
