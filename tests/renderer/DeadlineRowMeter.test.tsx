// @vitest-environment jsdom
/** Marking a by-usage deadline done asks for the reading (W05 §7). */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async () => ({ ok: true, data: { previous: {}, sysLogId: 3 } }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { DeadlineRow } from '../../src/renderer/views/dashboard/DeadlineRow'
import { IPC } from '../../src/shared/ipc-channels'

const deadline = {
  rowId: 4, clientName: '2017 Civic', gridId: 1, gridName: 'Vehicles', columnId: 9, columnName: 'Oil change', dateValue: '2026-04-15',
  daysUntil: 3, alertRuleId: 2, threshold: null, intervalDays: null, ruleKind: 'meter' as const, due: '2026-10-05', detail: '120 mi left (about Oct 5, 2026)',
}

describe('meter deadlines on the dashboard', () => {
  it('show the engine\'s date and ask for the reading when marked done', async () => {
    const onMarkDone = vi.fn()
    render(<MemoryRouter><DeadlineRow deadline={deadline} onMarkDone={onMarkDone} /></MemoryRouter>)
    expect(screen.getByText('Oct 5, 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark Oil change done for 2017 Civic' }))
    fireEvent.change(screen.getByLabelText('Current reading'), { target: { value: '45,210' } })
    const dialog = screen.getByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Mark done' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_METER_DONE, 4, 9, 45210, null)
    expect(onMarkDone).toHaveBeenCalledWith(4, 9)
  })

  it('can be marked done on another day from the reading dialog (audit 1.22)', async () => {
    invoke.mockClear()
    render(<MemoryRouter><DeadlineRow deadline={deadline} onMarkDone={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Oil change done for 2017 Civic' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Current reading'), { target: { value: '45210' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done on another day…' }))
    fireEvent.change(within(dialog).getByLabelText('Day it was done'), { target: { value: '2026-01-02' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Mark done' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_METER_DONE, 4, 9, 45210, '2026-01-02')
  })
})

describe('Done on another day… (audit 1.22)', () => {
  it('starts the next cycle from the day it was really done', async () => {
    invoke.mockClear()
    invoke.mockImplementation(async () => ({ ok: true, data: { sysLogId: 5 } }))
    const interval = { ...deadline, ruleKind: 'interval' as const, columnName: 'Home visit', intervalDays: 30, interval: { days: 30, months: 0 }, due: undefined, detail: undefined }
    render(<MemoryRouter><DeadlineRow deadline={interval} onMarkDone={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Done on another day: Home visit for 2017 Civic' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Day it was done'), { target: { value: '2026-01-02' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Mark done' })) })
    // One step in main (L-25), dated the day it was done
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_MARK_DONE, 4, 9, { kind: 'repeat' }, null, '2026-01-02')
  })

  it('will not take a day in the future', () => {
    const interval = { ...deadline, ruleKind: 'interval' as const, intervalDays: 30, interval: { days: 30, months: 0 }, due: undefined, detail: undefined }
    render(<MemoryRouter><DeadlineRow deadline={interval} onMarkDone={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Done on another day: Oil change for 2017 Civic' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Day it was done'), { target: { value: '2999-01-01' } })
    expect((within(dialog).getByRole('button', { name: 'Mark done' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
