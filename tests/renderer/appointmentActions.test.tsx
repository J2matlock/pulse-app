// @vitest-environment jsdom
/** Appointment actions (W07): undoing "done" sets it back and restores dates the note moved. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'appointments:set-status') return { ok: true, data: { previous: 'scheduled', caseLogId: 9, voidedNoteId: null, updatedDates: [{ column_id: 4, column_name: 'Last visit', old_value: '2026-09-01', new_value: '2026-10-01' }], rowId: 3 } }
  if (channel === 'appointments:delete') return { ok: true, data: { snapshot: { appointments: [], series: [], createdAppointmentIds: [], createdSeriesIds: [] }, ids: [5] } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { setAppointmentStatus, deleteAppointment } from '../../src/renderer/utils/appointmentActions'
import { useUndoStore } from '../../src/renderer/stores/undoStore'
import type { Appointment } from '../../src/shared/appointments'

const appt = { id: 5, title: 'Session', row_id: 3 } as Appointment
const calls = (ch: string) => invoke.mock.calls.filter(c => c[0] === ch).map(c => c.slice(1))

beforeEach(() => { invoke.mockClear(); useUndoStore.getState().clear() })

describe('appointment actions', () => {
  it('undo "done" puts the status and the moved dates back', async () => {
    await act(async () => { await setAppointmentStatus(appt, 'done', { noteContent: 'Fine' }) })
    expect(calls('appointments:set-status')).toEqual([[5, 'done', { noteContent: 'Fine' }]])
    await act(async () => { await useUndoStore.getState().undo() })
    expect(calls('appointments:set-status').at(-1)).toEqual([5, 'scheduled'])
    expect(calls('cell:update')).toEqual([[3, 4, '2026-09-01']])
  })

  it('undo a delete restores main\'s snapshot', async () => {
    await act(async () => { await deleteAppointment(appt, 'all') })
    expect(calls('appointments:delete')).toEqual([[5, 'all']])
    await act(async () => { await useUndoStore.getState().undo() })
    expect(calls('appointments:restore')).toHaveLength(1)
  })
})
