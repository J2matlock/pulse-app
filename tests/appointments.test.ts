/** Appointments and series (W07 commits 1–2): validation, listing, materializing, edit/delete scopes, undo. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, createEmptyEncryptedDb, allMigrations, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({
  getDb: () => t.db,
  cachedStmt: (_k: string, sql: string) => t.db.prepare(sql),
  upsertCell: (rowId: number, columnId: number, value: string | null) => t.db.prepare(`INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)
    ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value`).run(rowId, columnId, value),
}))

import { createAppointment, listAppointments, updateAppointment, deleteAppointment, restoreAppointments, ensureMaterialized, rematerializeForRecord, recordAppointments, ApptError, setAppointmentStatus, appointmentsToday } from '../src/main/appointments'
import { seriesDates, addMinutes, minutesBetween, validWallTime, describeRule } from '../src/shared/appointments'
import { up as migration040 } from '../src/main/migrations/040_appointments'
import { addMissingActivityTypes } from '../src/main/activity-types'
import { localDateString } from '../src/shared/dates'

let g: { gridId: number; rowIds: number[]; columnIds: number[] }
const today = localDateString()
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localDateString(d) }
const all = () => t.db.prepare('SELECT id, title, start_at, end_at, status, is_exception, series_id, series_date FROM appointments ORDER BY start_at, id').all() as Array<{ id: number; title: string; start_at: string; end_at: string | null; status: string; is_exception: number; series_id: number | null; series_date: string | null }>

beforeEach(() => {
  t = createTestDb()
  g = seedGrid(t.db, { name: 'Clients', rowCount: 2, columnCount: 2 })
  t.db.prepare("UPDATE rows SET display_name = 'Jane Smith' WHERE id = ?").run(g.rowIds[0])
})
afterEach(() => cleanupTestDb(t))

describe('migration 040', () => {
  it('adds the tables and is safe to run twice', () => {
    const e = createEmptyEncryptedDb()
    e.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) if (m.version <= 39) m.up(e.db)
    migration040(e.db)
    expect(() => migration040(e.db)).not.toThrow()
    const tables = (e.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(r => r.name)
    expect(tables).toEqual(expect.arrayContaining(['appointments', 'appointment_series']))
    expect((e.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('40')
    cleanupTestDb(e)
  })
})

describe('date math', () => {
  it('walks wall times without time zones', () => {
    expect(addMinutes('2026-03-08T01:30', 60)).toBe('2026-03-08T02:30')
    expect(addMinutes('2026-10-06T23:30', 50)).toBe('2026-10-07T00:20')
    expect(minutesBetween('2026-10-06T15:00', '2026-10-06T15:50')).toBe(50)
    expect(validWallTime('2026-02-30T10:00')).toBe(false)
    expect(describeRule({ freq: 'weekly', interval: 2, byDay: [4, 2] })).toBe('Every 2 weeks on Tue, Thu')
  })

  it('makes weekly, every-other-week and monthly dates, clamping the 31st', () => {
    expect(seriesDates({ freq: 'weekly', interval: 1 }, '2026-10-06', '2026-10-27')).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'])
    expect(seriesDates({ freq: 'weekly', interval: 2, byDay: [2, 4] }, '2026-10-06', '2026-10-31')).toEqual(['2026-10-06', '2026-10-08', '2026-10-20', '2026-10-22'])
    expect(seriesDates({ freq: 'monthly', interval: 1 }, '2026-01-31', '2026-05-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
    expect(seriesDates({ freq: 'daily', interval: 1, count: 3 }, '2026-10-06', '2027-01-01')).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'])
    expect(seriesDates({ freq: 'daily', interval: 1, until: '2026-10-07' }, '2026-10-06', '2027-01-01')).toHaveLength(2)
    expect(seriesDates({ freq: 'daily', interval: 1 }, '2026-01-01', '2030-01-01')).toHaveLength(500)
  })
})

describe('single appointments', () => {
  it('are created, listed with their record, and checked', () => {
    const { ids } = createAppointment({ row_id: g.rowIds[0]!, title: ' Session ', start_at: `${today}T15:00`, end_at: `${today}T15:50`, location: '' })
    const [a] = listAppointments({ from: today, to: today })
    expect(a).toMatchObject({ id: ids[0], title: 'Session', record_name: 'Jane Smith', grid_id: g.gridId, location: null, status: 'scheduled', all_day: 0 })
    expect(() => createAppointment({ title: 'x', start_at: `${today}T15:00`, end_at: `${today}T14:00` })).toThrow(/after the start/)
    expect(() => createAppointment({ title: 'x', start_at: '2026-02-30T10:00' })).toThrow(ApptError)
    expect(() => createAppointment({ title: '', start_at: `${today}T10:00` })).toThrow(ApptError)
    createAppointment({ title: 'Staff day', start_at: today, all_day: true })
    expect(listAppointments({ from: today, to: today }).map(x => x.title)).toEqual(['Staff day', 'Session'])
  })

  it('hide appointments of records in the trash', () => {
    createAppointment({ row_id: g.rowIds[0]!, title: 'Visit', start_at: `${today}T09:00` })
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(g.rowIds[0])
    expect(listAppointments({ from: today, to: today })).toEqual([])
  })

  it('edit, delete and undo', () => {
    const { ids } = createAppointment({ title: 'Visit', start_at: `${today}T09:00` })
    const upd = updateAppointment(ids[0]!, { title: 'Home visit', start_at: `${today}T10:00` })
    expect(all()[0]).toMatchObject({ title: 'Home visit', start_at: `${today}T10:00`, is_exception: 0 })
    restoreAppointments(upd.snapshot)
    expect(all()[0]).toMatchObject({ title: 'Visit', start_at: `${today}T09:00` })
    const del = deleteAppointment(ids[0]!)
    expect(all()).toEqual([])
    restoreAppointments(del.snapshot)
    expect(all().map(a => a.id)).toEqual(ids)
  })
})

describe('series', () => {
  const weekly = () => createAppointment({ row_id: g.rowIds[0]!, title: 'Session', start_at: `${today}T15:00`, end_at: `${today}T15:50` }, { freq: 'weekly', interval: 1 })

  it('make six months of occurrences at the same wall time', () => {
    const { ids } = weekly()
    expect(ids.length).toBeGreaterThanOrEqual(26)
    expect(all().every(a => a.start_at.endsWith('T15:00') && a.end_at?.endsWith('T15:50'))).toBe(true)
    // Extending later adds more without repeating any
    ensureMaterialized(inDays(300))
    const dates = all().map(a => a.series_date)
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates.at(-1)! > inDays(290)).toBe(true)
  })

  it('drop a series whose record was deleted for good, instead of failing to fill it in', () => {
    weekly()
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(g.rowIds[0])
    expect(all()).toHaveLength(0)
    expect(() => ensureMaterialized(inDays(300))).not.toThrow()
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM appointment_series').get()).toEqual({ n: 0 })
    expect(listAppointments({ from: today, to: inDays(300) })).toHaveLength(0)
  })

  it('end on the date in a column, and follow it when it changes', () => {
    const [, until] = g.columnIds as [number, number]
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(g.rowIds[0], until, inDays(20))
    createAppointment({ row_id: g.rowIds[0]!, title: 'Session', start_at: `${today}T15:00` }, { freq: 'weekly', interval: 1, untilColumnId: until })
    expect(all()).toHaveLength(3)
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run(inDays(8), g.rowIds[0], until)
    rematerializeForRecord(g.rowIds[0]!)
    expect(all()).toHaveLength(2)
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run(inDays(30), g.rowIds[0], until)
    rematerializeForRecord(g.rowIds[0]!)
    expect(all()).toHaveLength(5)
  })

  it('change only one, keeping it when more are made', () => {
    weekly()
    const second = all()[1]!
    updateAppointment(second.id, { start_at: `${second.start_at.slice(0, 10)}T09:00`, end_at: `${second.start_at.slice(0, 10)}T09:30` }, 'one')
    expect(all().find(a => a.id === second.id)).toMatchObject({ is_exception: 1, start_at: `${second.series_date}T09:00` })
    deleteAppointment(all()[2]!.id, 'one')
    const before = all().length
    ensureMaterialized(inDays(400))
    expect(all().filter(a => a.series_date === second.series_date)).toHaveLength(1)
    expect(all().length).toBeGreaterThan(before)
    expect(all().some(a => a.series_date === inDays(14))).toBe(false)
  })

  it('change all future ones, not past or done ones', () => {
    weekly()
    const first = all()[0]!
    t.db.prepare("UPDATE appointments SET status = 'done' WHERE id = ?").run(first.id)
    updateAppointment(all()[1]!.id, { title: 'Therapy', start_at: `${all()[1]!.start_at.slice(0, 10)}T16:00`, end_at: `${all()[1]!.start_at.slice(0, 10)}T17:00` }, 'all')
    const rows = all()
    expect(rows[0]).toMatchObject({ title: 'Session', start_at: first.start_at })
    expect(rows.slice(1).every(a => a.title === 'Therapy' && a.start_at.endsWith('T16:00') && a.end_at!.endsWith('T17:00'))).toBe(true)
    expect(() => updateAppointment(rows[2]!.id, { start_at: `${inDays(30)}T16:00`, end_at: `${inDays(30)}T17:00` }, 'all')).toThrow(/This and following/)
  })

  it('split at "this and following", and undo puts the one series back', () => {
    weekly()
    const before = all()
    const third = before[2]!
    const change = updateAppointment(third.id, { title: 'New time', start_at: `${third.series_date}T11:00`, end_at: `${third.series_date}T12:00` }, 'following')
    const after = all()
    expect(after.slice(0, 2).every(a => a.title === 'Session' && a.series_id === before[0]!.series_id)).toBe(true)
    expect(after.slice(2).every(a => a.title === 'New time' && a.series_id !== before[0]!.series_id)).toBe(true)
    restoreAppointments(change.snapshot)
    expect(all()).toEqual(before)
  })

  it('delete the series but keep done ones; "this and following" ends it', () => {
    weekly()
    const rows = all()
    t.db.prepare("UPDATE appointments SET status = 'done' WHERE id = ?").run(rows[0]!.id)
    const following = deleteAppointment(rows[3]!.id, 'following')
    expect(all()).toHaveLength(3)
    ensureMaterialized(inDays(500))
    expect(all()).toHaveLength(3)
    restoreAppointments(following.snapshot)
    expect(all()).toHaveLength(rows.length)
    deleteAppointment(rows[2]!.id, 'all')
    expect(all().map(a => [a.id, a.status, a.series_id])).toEqual([[rows[0]!.id, 'done', null]])
  })

  it('show on the record\'s page: next five and last five', () => {
    weekly()
    t.db.prepare("UPDATE appointments SET status = 'done' WHERE id = ?").run(all()[0]!.id)
    const r = recordAppointments(g.rowIds[0]!)
    expect(r.upcoming).toHaveLength(5)
    expect(r.past.map(a => a.status)).toEqual(['done'])
  })
})

describe('marking appointments', () => {
  const notes = () => t.db.prepare('SELECT id, content, log_type, minutes, source_action_id, voided_at, created_at FROM case_log WHERE row_id = ? ORDER BY id').all(g.rowIds[0]) as Array<{ id: number; content: string; log_type: string; minutes: number | null; source_action_id: string; voided_at: string | null; created_at: string }>
  const yesterday = inDays(-1)

  it('done makes a note of its kind on the day it happened, with minutes when time is tracked, and moves dates', () => {
    t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify({ timeTracking: true }))
    const [, last] = g.columnIds as [number, number]
    t.db.prepare("UPDATE columns SET column_type = 'date', config = ? WHERE id = ?").run(JSON.stringify({ note_updates: ['phone'] }), last)
    const { ids } = createAppointment({ row_id: g.rowIds[0]!, title: 'Check-in call', start_at: `${yesterday}T15:00`, end_at: `${yesterday}T15:45`, activity_type_key: 'phone' })
    const change = setAppointmentStatus(ids[0]!, 'done')
    const [n] = notes()
    expect(n).toMatchObject({ content: 'Appointment: Check-in call', log_type: 'phone', minutes: 45, source_action_id: `appt:${ids[0]}` })
    expect(localDateString(new Date(n!.created_at.replace(' ', 'T') + 'Z'))).toBe(yesterday)
    expect(change).toMatchObject({ previous: 'scheduled', caseLogId: n!.id, updatedDates: [{ column_id: last, old_value: null, new_value: yesterday }] })
    expect(t.db.prepare('SELECT status, case_log_id FROM appointments WHERE id = ?').get(ids[0])).toEqual({ status: 'done', case_log_id: n!.id })
    // Back to scheduled voids the note
    expect(setAppointmentStatus(ids[0]!, 'scheduled')).toMatchObject({ voidedNoteId: n!.id, caseLogId: null })
    expect(notes()[0]!.voided_at).not.toBeNull()
  })

  it('done uses a visit when the kind is missing; no-show logs only if that kind exists', () => {
    const { ids } = createAppointment({ row_id: g.rowIds[0]!, title: 'Visit', start_at: `${yesterday}T09:00` })
    setAppointmentStatus(ids[0]!, 'done', { noteContent: 'Went well' })
    expect(notes().map(n => [n.content, n.log_type])).toEqual([['Went well', 'visit']])
    const second = createAppointment({ row_id: g.rowIds[0]!, title: 'Visit 2', start_at: `${yesterday}T10:00` }).ids[0]!
    setAppointmentStatus(second, 'no_show')
    expect(notes()).toHaveLength(1)
    addMissingActivityTypes([{ key: 'no_show', label: 'No-show' }])
    setAppointmentStatus(second, 'scheduled')
    setAppointmentStatus(second, 'no_show')
    expect(notes().at(-1)).toMatchObject({ content: 'No-show: Visit 2', log_type: 'no_show' })
  })

  it('appointments without a record change status without a note', () => {
    const { ids } = createAppointment({ title: 'Staff meeting', start_at: `${yesterday}T09:00` })
    expect(setAppointmentStatus(ids[0]!, 'done')).toMatchObject({ caseLogId: null })
  })
})

describe('today\'s appointments for the briefing', () => {
  it('counts scheduled ones and finds the first time, only with the feature on', () => {
    createAppointment({ title: 'Late', start_at: `${today}T16:00` })
    createAppointment({ title: 'Early', start_at: `${today}T08:30` })
    createAppointment({ title: 'All day', start_at: today, all_day: true })
    const done = createAppointment({ title: 'Done', start_at: `${today}T07:00` }).ids[0]!
    setAppointmentStatus(done, 'done')
    expect(appointmentsToday(today)).toEqual({ appointmentsToday: 0, firstAppointment: null })
    t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify({ appointments: true }))
    expect(appointmentsToday(today)).toEqual({ appointmentsToday: 3, firstAppointment: `${today}T08:30` })
  })
})
