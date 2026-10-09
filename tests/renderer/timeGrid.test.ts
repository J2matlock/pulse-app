/** Week/day grid math (W07 §6): lanes for overlaps, drops snapped to 15 minutes. */
import { describe, it, expect } from 'vitest'
import { layoutDay, dropTimes, snap } from '../../src/renderer/components/calendar/TimeGrid'
import type { Appointment } from '../../src/shared/appointments'

const a = (id: number, start: string, end: string | null) => ({ id, start_at: `2026-10-06T${start}`, end_at: end ? `2026-10-06T${end}` : null, all_day: 0 }) as Appointment

describe('time grid', () => {
  it('puts overlapping appointments side by side, others full width', () => {
    const out = layoutDay([a(1, '09:00', '10:00'), a(2, '09:30', '10:30'), a(3, '11:00', '11:30'), a(4, '09:45', '09:50')])
    const by = Object.fromEntries(out.map(o => [o.appt.id, [o.lane, o.lanes]]))
    expect(by).toEqual({ 1: [0, 3], 2: [1, 3], 4: [2, 3], 3: [0, 1] })
  })

  it('snaps and moves across days, keeping the length', () => {
    expect(snap(52)).toBe(45)
    expect(snap(53)).toBe(60)
    expect(dropTimes(a(1, '09:00', '09:50'), 1, 37, 'move')).toEqual({ start_at: '2026-10-07T09:30', end_at: '2026-10-07T10:20' })
    expect(dropTimes(a(1, '09:00', '09:50'), 0, 20, 'resize')).toEqual({ start_at: '2026-10-06T09:00', end_at: '2026-10-06T10:15' })
    expect(dropTimes(a(1, '09:00', '09:15'), 0, -60, 'resize').end_at).toBe('2026-10-06T09:15')
  })
})
