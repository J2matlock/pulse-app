/**
 * ipc-appointments.ts — appointments and series (generalization W07 §5).
 */
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { APPT_STATUSES, DATE_RE, type ApptStatus } from '../../shared/appointments'
import { ok, fail, validId, notifyCaseLogChanged } from './ipc-utils'
import { handlersFor, idArg, idListArg } from './ipc-define'
import {
  ApptError, listAppointments, recordAppointments, createAppointment, updateAppointment, deleteAppointment, restoreAppointments, setAppointmentStatus,
  countUpcomingForRecords, cancelUpcomingForRecords, endSeriesOn,
  type ApptSnapshot,
} from '../appointments'
import { calendarItems, deadlineOptionsForDay } from '../calendar'
import { featureOn, word } from '../vocab'

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof ApptError) return fail(err.message)
    throw err
  }
}

export function announceAppointments(): void {
  BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send(IPC.APPOINTMENTS_CHANGED) })
}

const define = handlersFor('ipc-appointments')

const BAD = 'Invalid request'
/** Which appointments of a series an edit covers; just this one when left out */
const scopeArg = () => z.enum(['one', 'following', 'all'], BAD).default('one')
const dateArg = (message: string) => z.string(message).regex(DATE_RE, message)

function validSnapshot(v: unknown): v is ApptSnapshot {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return ['appointments', 'series', 'createdAppointmentIds', 'createdSeriesIds'].every(k => Array.isArray(s[k]))
    && (s.createdAppointmentIds as unknown[]).every(validId) && (s.createdSeriesIds as unknown[]).every(validId)
    // Archiving many records at once can end many series in one step
    && (s.appointments as unknown[]).length <= 50_000 && (s.series as unknown[]).length <= 1000
}

const MAX_RECORDS = 1000
const rowIdsArg = () => idListArg(BAD, BAD, { min: 1, max: MAX_RECORDS })

export function registerAppointmentHandlers(): void {
  define(IPC.APPT_LIST, [z.unknown(), z.unknown()], (range, filter) => {
    const r = (range && typeof range === 'object' ? range : {}) as Record<string, unknown>
    if (typeof r.from !== 'string' || typeof r.to !== 'string' || !DATE_RE.test(r.from) || !DATE_RE.test(r.to)) return fail('Invalid dates')
    const f = (filter && typeof filter === 'object' ? filter : {}) as Record<string, unknown>
    if (f.gridId != null && !validId(f.gridId)) return fail('Invalid ID')
    if (f.rowId != null && !validId(f.rowId)) return fail('Invalid ID')
    if (f.status != null && (!Array.isArray(f.status) || !f.status.every(x => APPT_STATUSES.includes(x as ApptStatus)))) return fail('Invalid status')
    return action(() => listAppointments({ from: r.from as string, to: r.to as string }, {
      ...(f.gridId != null ? { gridId: f.gridId as number } : {}), ...(f.rowId != null ? { rowId: f.rowId as number } : {}),
      ...(f.status ? { status: f.status as ApptStatus[] } : {}),
      ...(f.withEvents === true ? { withEvents: true } : {}),
      // Events (no record) stay on the calendar with the Appointments feature off; record appointments don't
      ...(featureOn('appointments') ? {} : { eventsOnly: true }),
    }))
  })

  define(IPC.APPT_FOR_RECORD, [idArg()], (rowId) => ok(recordAppointments(rowId)))

  define(IPC.APPT_CREATE, [z.unknown(), z.unknown()], (input, rule) => {
    const res = action(() => createAppointment(input as never, (rule ?? null) as never))
    if (res.ok) announceAppointments()
    return res
  }, { write: true })

  // Every check here answers the same message, so their order doesn't show
  define(IPC.APPT_UPDATE, [
    idArg(BAD),
    z.custom<object>(v => !!v && typeof v === 'object', BAD),
    scopeArg(),
    z.custom<object | null | undefined>(v => v == null || typeof v === 'object', BAD),
  ], (id, patch, scope, rule) => {
    const res = action(() => updateAppointment(id, patch as never, scope, (rule ?? null) as never))
    if (res.ok) announceAppointments()
    return res
  }, { write: true })

  define(IPC.APPT_END_SERIES, [idArg(BAD), dateArg(BAD)], (id, lastDate) => {
    const res = action(() => endSeriesOn(id, lastDate))
    if (res.ok) announceAppointments()
    return res
  }, { write: true })

  define(IPC.APPT_DELETE, [idArg(BAD), scopeArg()], (id, scope) => {
    const res = action(() => deleteAppointment(id, scope))
    if (res.ok) announceAppointments()
    return res
  }, { write: true })

  define(IPC.APPT_RESTORE, [z.custom<ApptSnapshot>(validSnapshot, BAD)], (snapshot) => {
    const res = action(() => restoreAppointments(snapshot))
    if (res.ok) announceAppointments()
    return res
  }, { write: true })

  define(IPC.APPT_SET_STATUS, [idArg(BAD), z.enum(APPT_STATUSES, BAD), z.unknown()], (id, status, opts) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    if (o.noteContent != null && typeof o.noteContent !== 'string') return fail('Invalid note')
    const res = action(() => setAppointmentStatus(id, status, {
      ...(typeof o.noteContent === 'string' ? { noteContent: o.noteContent } : {}),
      ...(typeof o.minutes === 'number' ? { minutes: o.minutes } : {}),
      ...(typeof o.miles === 'number' ? { miles: o.miles } : {}),
      ...(o.extra && typeof o.extra === 'object' ? { extra: o.extra as Record<string, number> } : {}),
    }))
    if (res.ok) {
      announceAppointments()
      if (res.data.rowId !== null && (res.data.caseLogId !== null || res.data.voidedNoteId !== null)) notifyCaseLogChanged(res.data.rowId)
    }
    return res
  }, { write: true })

  define(IPC.APPT_UPCOMING_COUNT, [rowIdsArg()], (rowIds) => ok(countUpcomingForRecords(rowIds)))

  /** Archiving: end the records' series and remove their upcoming appointments (audit 1.13) */
  define(IPC.APPT_CANCEL_UPCOMING, [rowIdsArg()], (rowIds) => {
    const res = action(() => cancelUpcomingForRecords(rowIds))
    if (res.ok) announceAppointments()
    return res
  }, { write: true })

  // to < from answers 'Invalid dates' before the list is checked, so the list stays in the body
  define(IPC.CALENDAR_ITEMS, [dateArg('Invalid dates'), dateArg('Invalid dates'), z.unknown()], (from, to, gridId) => {
    if (to < from) return fail('Invalid dates')
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    return ok(calendarItems(from, to, gridId == null ? undefined : gridId))
  })

  /** "Deadline for a record": the record's deadline columns, and what to store so each is due that day */
  define(IPC.CALENDAR_DEADLINE_OPTIONS, [idArg(), dateArg('Invalid date')], (rowId, due) => {
    const options = deadlineOptionsForDay(rowId, due)
    return options ? ok(options) : fail(`That ${word('record')} is no longer available.`)
  })
}
