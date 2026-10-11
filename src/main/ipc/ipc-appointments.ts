/**
 * ipc-appointments.ts — appointments and series (generalization W07 §5).
 */
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { APPT_STATUSES, DATE_RE, type ApptStatus, type EditScope } from '../../shared/appointments'
import { secureWrap, ok, fail, enforceWritable, validId, notifyCaseLogChanged } from './ipc-utils'
import {
  ApptError, listAppointments, recordAppointments, createAppointment, updateAppointment, deleteAppointment, restoreAppointments, setAppointmentStatus,
  countUpcomingForRecords, cancelUpcomingForRecords, endSeriesOn,
  type ApptSnapshot,
} from '../appointments'
import { calendarItems } from '../calendar'

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof ApptError) return fail(err.message)
    throw err
  }
}

export function announceAppointments(): void {
  BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send(IPC.APPOINTMENTS_CHANGED) })
}

const scopeOf = (v: unknown): EditScope | null => (v === undefined ? 'one' : v === 'one' || v === 'following' || v === 'all' ? v : null)

function validSnapshot(v: unknown): v is ApptSnapshot {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return ['appointments', 'series', 'createdAppointmentIds', 'createdSeriesIds'].every(k => Array.isArray(s[k]))
    && (s.createdAppointmentIds as unknown[]).every(validId) && (s.createdSeriesIds as unknown[]).every(validId)
    // Archiving many records at once can end many series in one step
    && (s.appointments as unknown[]).length <= 50_000 && (s.series as unknown[]).length <= 1000
}

const MAX_RECORDS = 1000
const validRowIds = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.length <= MAX_RECORDS && v.every(validId)

export function registerAppointmentHandlers(): void {
  secureWrap(IPC.APPT_LIST, 'ipc-appointments', (_e, range: unknown, filter?: unknown) => {
    const r = (range && typeof range === 'object' ? range : {}) as Record<string, unknown>
    if (typeof r.from !== 'string' || typeof r.to !== 'string' || !DATE_RE.test(r.from) || !DATE_RE.test(r.to)) return fail('Invalid dates')
    const f = (filter && typeof filter === 'object' ? filter : {}) as Record<string, unknown>
    if (f.gridId != null && !validId(f.gridId)) return fail('Invalid ID')
    if (f.rowId != null && !validId(f.rowId)) return fail('Invalid ID')
    if (f.status != null && (!Array.isArray(f.status) || !f.status.every(x => APPT_STATUSES.includes(x as ApptStatus)))) return fail('Invalid status')
    return action(() => listAppointments({ from: r.from as string, to: r.to as string }, {
      ...(f.gridId != null ? { gridId: f.gridId as number } : {}), ...(f.rowId != null ? { rowId: f.rowId as number } : {}),
      ...(f.status ? { status: f.status as ApptStatus[] } : {}),
    }))
  })

  secureWrap(IPC.APPT_FOR_RECORD, 'ipc-appointments', (_e, rowId: unknown) => {
    if (!validId(rowId)) return fail('Invalid ID')
    return ok(recordAppointments(rowId))
  })

  secureWrap(IPC.APPT_CREATE, 'ipc-appointments', (_e, input: unknown, rule?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const res = action(() => createAppointment(input as never, (rule ?? null) as never))
    if (res.ok) announceAppointments()
    return res
  })

  secureWrap(IPC.APPT_UPDATE, 'ipc-appointments', (_e, id: unknown, patch: unknown, scope?: unknown, rule?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const sc = scopeOf(scope)
    if (!validId(id) || !sc || !patch || typeof patch !== 'object') return fail('Invalid request')
    if (rule != null && typeof rule !== 'object') return fail('Invalid request')
    const res = action(() => updateAppointment(id, patch as never, sc, (rule ?? null) as never))
    if (res.ok) announceAppointments()
    return res
  })

  secureWrap(IPC.APPT_END_SERIES, 'ipc-appointments', (_e, id: unknown, lastDate: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id) || typeof lastDate !== 'string' || !DATE_RE.test(lastDate)) return fail('Invalid request')
    const res = action(() => endSeriesOn(id, lastDate))
    if (res.ok) announceAppointments()
    return res
  })

  secureWrap(IPC.APPT_DELETE, 'ipc-appointments', (_e, id: unknown, scope?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const sc = scopeOf(scope)
    if (!validId(id) || !sc) return fail('Invalid request')
    const res = action(() => deleteAppointment(id, sc))
    if (res.ok) announceAppointments()
    return res
  })

  secureWrap(IPC.APPT_RESTORE, 'ipc-appointments', (_e, snapshot: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validSnapshot(snapshot)) return fail('Invalid request')
    const res = action(() => restoreAppointments(snapshot))
    if (res.ok) announceAppointments()
    return res
  })

  secureWrap(IPC.APPT_SET_STATUS, 'ipc-appointments', (_e, id: unknown, status: unknown, opts?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id) || !APPT_STATUSES.includes(status as ApptStatus)) return fail('Invalid request')
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    if (o.noteContent != null && typeof o.noteContent !== 'string') return fail('Invalid note')
    const res = action(() => setAppointmentStatus(id, status as ApptStatus, {
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
  })

  secureWrap(IPC.APPT_UPCOMING_COUNT, 'ipc-appointments', (_e, rowIds: unknown) => {
    if (!validRowIds(rowIds)) return fail('Invalid request')
    return ok(countUpcomingForRecords(rowIds))
  })

  /** Archiving: end the records' series and remove their upcoming appointments (audit 1.13) */
  secureWrap(IPC.APPT_CANCEL_UPCOMING, 'ipc-appointments', (_e, rowIds: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validRowIds(rowIds)) return fail('Invalid request')
    const res = action(() => cancelUpcomingForRecords(rowIds))
    if (res.ok) announceAppointments()
    return res
  })

  secureWrap(IPC.CALENDAR_ITEMS, 'ipc-appointments', (_e, from: unknown, to: unknown, gridId?: unknown) => {
    if (typeof from !== 'string' || typeof to !== 'string' || !DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return fail('Invalid dates')
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    return ok(calendarItems(from, to, gridId == null ? undefined : gridId))
  })
}
