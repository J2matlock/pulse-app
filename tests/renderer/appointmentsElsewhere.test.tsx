// @vitest-environment jsdom
/** Appointments elsewhere (W07 §7): the dashboard Today card and the profile section. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
import { localDateString } from '../../src/shared/dates'
const today = localDateString()
const appt = (id: number, start: string, title: string, status = 'scheduled') => ({ id, row_id: 4, series_id: null, title, start_at: start, end_at: null, all_day: 0, location: null, activity_type_key: null, status, case_log_id: null, notes: null, is_exception: 0, created_at: '', updated_at: '', record_name: 'Jane', grid_id: 2, grid_name: 'Clients' })
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'appointments:list') return { ok: true, data: [appt(1, `${today}T09:00`, 'Intake'), appt(2, `${today}T11:00`, 'Call', 'cancelled')] }
  if (channel === 'appointments:for-record') return { ok: true, data: { upcoming: [appt(3, '2099-01-05T10:00', 'Review')], past: [appt(4, '2020-01-05T10:00', 'Intake', 'done')] } }
  if (channel === 'appointments:set-status') return { ok: true, data: { previous: 'scheduled', caseLogId: 7, voidedNoteId: null, updatedDates: [], rowId: 4 } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { TodayCard } from '../../src/renderer/views/dashboard/cards/TodayCard'
import { RecordAppointments } from '../../src/renderer/components/profile/RecordAppointments'
import { setWords } from './vocabFixture'

beforeEach(() => { setWords(); invoke.mockClear() })

describe('Today card', () => {
  it('lists today\'s appointments in order, cancelled ones left out, with the calendar\'s actions', async () => {
    render(<MemoryRouter><TodayCard /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringMatching(/^9:00 amIntake · Jane/)])
    // The same actions everywhere (audit S-19), in the dashboard's short form with Edit and Delete under ⋯ (UX D-26): Done asks for an optional note
    for (const name of ['No-show (Intake)', 'Cancelled (Intake)', 'More (Intake)']) expect(screen.getByRole('button', { name })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More (Intake)' }))
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More (Intake)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done… (Intake)' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark done' })) })
    expect(invoke).toHaveBeenCalledWith('appointments:set-status', 1, 'done', {})
  })
})

describe('profile appointments', () => {
  it('have the same actions, and the Done form says a future one has not happened yet (audit S-19, Q4)', async () => {
    render(<MemoryRouter><RecordAppointments rowId={4} gridId={2} name="Jane" /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByRole('button', { name: 'Mark cancelled (Review)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to scheduled (Intake)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done… (Review)' }))
    // No separate question: the Done form opens with a warning line, and its own Never mind is the way out
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText(/is on a later day, so it hasn't happened yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Never mind' })).toBeTruthy()
  })

  it('shows what is coming up and what happened, and schedules for this record', async () => {
    render(<MemoryRouter><RecordAppointments rowId={4} gridId={2} name="Jane" /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByText('Review')).toBeTruthy()
    expect(screen.getByText(/· Done$/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Schedule/ }))
    expect(screen.getByRole('heading', { name: 'New appointment' })).toBeTruthy()
    expect(screen.getByText('Jane')).toBeTruthy()
  })
})
