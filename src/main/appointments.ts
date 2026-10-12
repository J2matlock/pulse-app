/**
 * Appointments and recurring series (generalization W07 §3–4).
 *
 * A series' occurrences are real rows up to `materialized_until` (six months
 * ahead, extended on unlock and as the calendar moves past it). Each
 * occurrence remembers the date it was made for (`series_date`); dates
 * deleted on their own are kept in the template's `exdates`, so neither
 * comes back when more occurrences are made.
 *
 * Every change returns a snapshot of what it touched, so one undo step can
 * put it all back (`restoreAppointments`).
 */
import { getDb } from './database'
import { localDateString } from '../shared/dates'
import type { NoteDateUpdate, NoteDateRevert } from '../shared/types'
import { isValidLogType, userTypeKeys } from './activity-types'
import { cleanExtraMeasures } from './measures'
import { applyNoteDateUpdates, revertNoteDates } from './note-date-updates'
import { featureOn, word } from './vocab'
import {
  addMinutes, addMonths, addDays, parseYmd, apptInputSchema, apptPatchSchema, minutesBetween, seriesDates, seriesRuleSchema,
  MATERIALIZE_MONTHS, MAX_HORIZON_MONTHS, DATE_RE, OPEN_RECORD_SQL,
  type Appointment, type ApptInput, type ApptPatch, type EditScope, type SeriesRule, type SeriesTemplate, type ApptStatus,
} from '../shared/appointments'

export class ApptError extends Error {}

/** The note written when an appointment is closed without happening */
const CLOSED_NOTE_PREFIX = { cancelled: 'Cancelled', no_show: 'No-show' } satisfies Record<Exclude<ApptStatus, 'scheduled' | 'done'>, string>

interface ApptRow extends Omit<Appointment, 'record_name' | 'grid_id' | 'grid_name'> { series_date: string | null }
interface SeriesRow { id: number; rule: string; template: string; materialized_until: string; created_at: string }
type StoredTemplate = SeriesTemplate & { first: string; exdates?: string[] }

/** What a change touched, for undo */
export interface ApptSnapshot {
  appointments: ApptRow[]
  series: SeriesRow[]
  createdAppointmentIds: number[]
  createdSeriesIds: number[]
}

export interface ApptChange { snapshot: ApptSnapshot; ids: number[] }

const SELECT = `
  SELECT a.*, CASE WHEN r.deleted_at IS NULL AND g.is_active = 1 THEN COALESCE(NULLIF(r.display_name, ''), '(unnamed)') END AS record_name,
         r.grid_id, g.name AS grid_name, ser.rule AS series_rule
  FROM appointments a LEFT JOIN rows r ON r.id = a.row_id LEFT JOIN grids g ON g.id = r.grid_id
  LEFT JOIN appointment_series ser ON ser.id = a.series_id`

// ── Reading ──────────────────────────────────────────────────────────────────


export interface ApptFilter { gridId?: number; rowId?: number; status?: ApptStatus[] }

/** Appointments starting in a date range (inclusive), in time order; records in the trash, and archived records' scheduled ones, are left out */
export function listAppointments(range: { from: string; to: string }, filter: ApptFilter = {}): Appointment[] {
  if (!DATE_RE.test(range.from) || !DATE_RE.test(range.to)) throw new ApptError('Choose the dates to show.')
  ensureMaterialized(range.to)
  const where = ["a.start_at >= ?", "a.start_at <= ?", OPEN_RECORD_SQL]
  const params: unknown[] = [range.from, `${range.to}T99:99`]
  if (filter.gridId !== undefined) { where.push('r.grid_id = ?'); params.push(filter.gridId) }
  if (filter.rowId !== undefined) { where.push('a.row_id = ?'); params.push(filter.rowId) }
  if (filter.status?.length) { where.push(`a.status IN (${filter.status.map(() => '?').join(',')})`); params.push(...filter.status) }
  return getDb().prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.start_at, a.id`).all(...params) as Appointment[]
}

/**
 * A record's next and last few appointments, for its page, with how many
 * there are in all (the lists stop at five; the section's count shouldn't).
 * Upcoming counts what's on the calendar so far: a repeating series without
 * an end keeps adding more as time goes on.
 */
export function recordAppointments(rowId: number, today = localDateString(), limit = 5): { upcoming: Appointment[]; past: Appointment[]; upcomingTotal: number; pastTotal: number } {
  ensureMaterialized(addMonths(today, 1))
  const db = getDb()
  const upcomingWhere = "a.row_id = ? AND a.start_at >= ? AND a.status = 'scheduled'"
  const pastWhere = "a.row_id = ? AND (a.start_at < ? OR a.status != 'scheduled')"
  const count = (where: string) => (db.prepare(`SELECT COUNT(*) AS n FROM appointments a WHERE ${where}`).get(rowId, today) as { n: number }).n
  return {
    upcoming: db.prepare(`${SELECT} WHERE ${upcomingWhere} ORDER BY a.start_at LIMIT ?`).all(rowId, today, limit) as Appointment[],
    past: db.prepare(`${SELECT} WHERE ${pastWhere} ORDER BY a.start_at DESC LIMIT ?`).all(rowId, today, limit) as Appointment[],
    upcomingTotal: count(upcomingWhere),
    pastTotal: count(pastWhere),
  }
}

// ── Snapshots and undo ───────────────────────────────────────────────────────

function tracker(seriesIds: number[], apptIds: number[]): ApptSnapshot {
  const db = getDb()
  const series = seriesIds.length ? db.prepare(`SELECT * FROM appointment_series WHERE id IN (${seriesIds.map(() => '?').join(',')})`).all(...seriesIds) as SeriesRow[] : []
  const appts = new Map<number, ApptRow>()
  if (seriesIds.length) for (const a of db.prepare(`SELECT * FROM appointments WHERE series_id IN (${seriesIds.map(() => '?').join(',')})`).all(...seriesIds) as ApptRow[]) appts.set(a.id, a)
  if (apptIds.length) for (const a of db.prepare(`SELECT * FROM appointments WHERE id IN (${apptIds.map(() => '?').join(',')})`).all(...apptIds) as ApptRow[]) appts.set(a.id, a)
  return { appointments: [...appts.values()], series, createdAppointmentIds: [], createdSeriesIds: [] }
}

/** Put appointments back as a snapshot had them (undo) */
export function restoreAppointments(snap: ApptSnapshot): void {
  const db = getDb()
  db.transaction(() => {
    for (const id of snap.createdAppointmentIds) db.prepare('DELETE FROM appointments WHERE id = ?').run(id)
    // A series this change made may have made more since (browsing far ahead)
    for (const id of snap.createdSeriesIds) db.prepare('DELETE FROM appointments WHERE series_id = ?').run(id)
    // Never REPLACE a series row: that deletes it first, and its occurrences lose their series
    for (const s of snap.series) {
      const changed = db.prepare('UPDATE appointment_series SET rule = ?, template = ?, materialized_until = ?, created_at = ? WHERE id = ?')
        .run(s.rule, s.template, s.materialized_until, s.created_at, s.id).changes
      if (changed === 0) {
        db.prepare('INSERT INTO appointment_series (id, rule, template, materialized_until, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(s.id, s.rule, s.template, s.materialized_until, s.created_at)
      }
    }
    // Occurrences a change added to a series it then shortened, etc.
    for (const s of snap.series) {
      const keep = new Set(snap.appointments.filter(a => a.series_id === s.id).map(a => a.id))
      for (const a of db.prepare('SELECT id FROM appointments WHERE series_id = ?').all(s.id) as Array<{ id: number }>) if (!keep.has(a.id)) db.prepare('DELETE FROM appointments WHERE id = ?').run(a.id)
    }
    const cols = ['id', 'row_id', 'series_id', 'title', 'start_at', 'end_at', 'all_day', 'location', 'activity_type_key', 'status', 'case_log_id', 'notes', 'is_exception', 'series_date', 'created_at', 'updated_at'] as const
    const ins = db.prepare(`INSERT OR REPLACE INTO appointments (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    for (const a of snap.appointments) {
      // A note it links to may be gone by now
      const note = a.case_log_id !== null && db.prepare('SELECT 1 FROM case_log WHERE id = ?').get(a.case_log_id) ? a.case_log_id : null
      ins.run(...cols.map(c => (c === 'case_log_id' ? note : a[c])))
    }
    for (const id of snap.createdSeriesIds) db.prepare('DELETE FROM appointment_series WHERE id = ?').run(id)
  })()
}

// ── Removed appointments, for calendar files (audit 1.36) ────────────────────

/**
 * Scheduled appointments removed in the last 30 days, kept (times only, no
 * names) so the next calendar file can send them as cancelled; otherwise
 * Outlook or Google keeps showing them.
 */
export interface RemovedAppointment { id: number; start_at: string; end_at: string | null; all_day: number; removed: string }
const REMOVED_KEY = 'calendar_removed_appointments'
const REMOVED_DAYS = 30
const REMOVED_MAX = 5000

function readRemoved(): RemovedAppointment[] {
  const raw = (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(REMOVED_KEY) as { value: string } | undefined)?.value
  try { const v = raw ? JSON.parse(raw) as unknown : []; return Array.isArray(v) ? v as RemovedAppointment[] : [] } catch { return [] }
}

/** Delete appointments, remembering the scheduled ones for the next calendar file */
function removeAppointments(ids: number[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const today = localDateString()
  const gone: RemovedAppointment[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    gone.push(...(db.prepare(`SELECT id, start_at, end_at, all_day FROM appointments WHERE status = 'scheduled' AND id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk) as Array<Omit<RemovedAppointment, 'removed'>>).map(a => ({ ...a, removed: today })))
    db.prepare(`DELETE FROM appointments WHERE id IN (${chunk.map(() => '?').join(',')})`).run(...chunk)
  }
  if (gone.length === 0) return
  const since = addDays(today, -REMOVED_DAYS)
  const kept = [...readRemoved().filter(r => r.removed >= since && !gone.some(g => g.id === r.id)), ...gone].slice(-REMOVED_MAX)
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(REMOVED_KEY, JSON.stringify(kept))
}

/** Appointments removed lately (and not brought back by undo), for calendar files */
export function removedAppointments(today = localDateString()): RemovedAppointment[] {
  const since = addDays(today, -REMOVED_DAYS)
  const exists = getDb().prepare('SELECT 1 FROM appointments WHERE id = ?')
  return readRemoved().filter(r => r.removed >= since && !exists.get(r.id))
}

// ── Writing ──────────────────────────────────────────────────────────────────

function checkRecord(rowId: number | null | undefined): number | null {
  if (rowId == null) return null
  if (!getDb().prepare('SELECT 1 FROM rows WHERE id = ? AND deleted_at IS NULL').get(rowId)) throw new ApptError(`That ${word('record')} is no longer available.`)
  return rowId
}

function parsed<T>(r: { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } }): T {
  if (!r.success) throw new ApptError(r.error.issues[0]?.message ?? 'Some of the appointment details are missing or not allowed.')
  return r.data
}

const insertSql = `INSERT INTO appointments (row_id, series_id, title, start_at, end_at, all_day, location, activity_type_key, notes, series_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

function templateOf(input: { row_id: number | null; title: string; start_at: string; end_at?: string | null; all_day?: boolean; location: string | null; activity_type_key?: string | null; notes: string | null }): StoredTemplate {
  return {
    row_id: input.row_id, title: input.title, first: input.start_at.slice(0, 10),
    time: input.all_day ? null : input.start_at.slice(11, 16),
    duration_min: input.end_at ? (input.all_day ? null : minutesBetween(input.start_at, input.end_at)) : null,
    location: input.location, activity_type_key: input.activity_type_key ?? null, notes: input.notes,
  }
}

function untilFromColumn(rule: SeriesRule, rowId: number | null): string | null {
  if (!rule.untilColumnId || rowId == null) return null
  const v = (getDb().prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, rule.untilColumnId) as { value: string | null } | undefined)?.value
  return v && DATE_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null
}

/** The furthest a series is filled in: two years past today, or past its first date if that's later */
function horizonOf(first: string, today: string): string {
  return addMonths(first > today ? first : today, MAX_HORIZON_MONTHS)
}

/**
 * Make a series' occurrences through `through`; dates already made, or
 * deleted on their own, are skipped. Future scheduled occurrences past a
 * shortened end (the "until" column changed) are removed. Returns new ids.
 */
function materialize(series: SeriesRow, through: string, today = localDateString()): number[] {
  const db = getDb()
  const rule = seriesRuleSchema.parse(JSON.parse(series.rule))
  const t = JSON.parse(series.template) as StoredTemplate
  // Its record was deleted for good (trash emptied, list or sample data
  // removed): the occurrences went with it, so the series goes too, rather
  // than failing the foreign key on every later fill-in
  if (t.row_id != null && !db.prepare('SELECT 1 FROM rows WHERE id = ?').get(t.row_id)) {
    db.prepare('DELETE FROM appointment_series WHERE id = ?').run(series.id)
    return []
  }
  // Two years ahead of today (or of its first date), so long-running series keep going
  const target = [through, horizonOf(t.first, today)].sort()[0]!
  const dates = seriesDates(rule, t.first, target, untilFromColumn(rule, t.row_id))
  const wanted = new Set(dates)
  const existing = new Set((db.prepare('SELECT series_date FROM appointments WHERE series_id = ? AND series_date IS NOT NULL').all(series.id) as Array<{ series_date: string }>).map(r => r.series_date))
  removeAppointments((db.prepare("SELECT id, series_date FROM appointments WHERE series_id = ? AND status = 'scheduled' AND is_exception = 0 AND series_date >= ?").all(series.id, today) as Array<{ id: number; series_date: string }>)
    .filter(r => r.series_date <= target && !wanted.has(r.series_date)).map(r => r.id))
  const ex = new Set(t.exdates ?? [])
  const ins = db.prepare(insertSql)
  const ids: number[] = []
  for (const d of dates) {
    if (existing.has(d) || ex.has(d)) continue
    const start = t.time ? `${d}T${t.time}` : d
    const end = t.time && t.duration_min ? addMinutes(start, t.duration_min) : null
    ids.push(Number(ins.run(t.row_id, series.id, t.title, start, end, t.time ? 0 : 1, t.location, t.activity_type_key, t.notes, d).lastInsertRowid))
  }
  if (target > series.materialized_until) db.prepare('UPDATE appointment_series SET materialized_until = ? WHERE id = ?').run(target, series.id)
  return ids
}

/** Make occurrences of every series through this date (called on unlock and as the calendar moves) */
export function ensureMaterialized(until: string = addMonths(localDateString(), MATERIALIZE_MONTHS)): void {
  const db = getDb()
  const stale = db.prepare('SELECT * FROM appointment_series WHERE materialized_until < ?').all(until) as SeriesRow[]
  if (stale.length === 0) return
  db.transaction(() => { for (const s of stale) materialize(s, until) })()
}

/** A series whose "until" comes from a column, after that cell changed */
export function rematerializeForRecord(rowId: number): void {
  const db = getDb()
  const series = (db.prepare('SELECT * FROM appointment_series').all() as SeriesRow[]).filter(s => {
    try { return (JSON.parse(s.template) as StoredTemplate).row_id === rowId && !!(JSON.parse(s.rule) as SeriesRule).untilColumnId } catch { return false }
  })
  if (series.length) db.transaction(() => { for (const s of series) materialize(s, s.materialized_until) })()
}

export function createAppointment(input: ApptInput, rule?: SeriesRule | null): ApptChange {
  const v = parsed(apptInputSchema.safeParse(input))
  const rowId = checkRecord(v.row_id)
  const db = getDb()
  return db.transaction((): ApptChange => {
    const snapshot: ApptSnapshot = { appointments: [], series: [], createdAppointmentIds: [], createdSeriesIds: [] }
    if (!rule) {
      const id = Number(db.prepare(insertSql).run(rowId, null, v.title, v.start_at, v.end_at ?? null, v.all_day ? 1 : 0, v.location, v.activity_type_key ?? null, v.notes, null).lastInsertRowid)
      snapshot.createdAppointmentIds.push(id)
      return { snapshot, ids: [id] }
    }
    const r = parsed(seriesRuleSchema.safeParse(rule))
    if (r.untilColumnId && rowId === null) throw new ApptError(`Choose the ${word('record')} whose date ends the series.`)
    const template = templateOf({ ...v, row_id: rowId, end_at: v.end_at ?? null })
    const through = addMonths(localDateString(), MATERIALIZE_MONTHS)
    const seriesId = Number(db.prepare('INSERT INTO appointment_series (rule, template, materialized_until) VALUES (?, ?, ?)')
      .run(JSON.stringify(r), JSON.stringify(template), template.first > through ? template.first : through).lastInsertRowid)
    const series = db.prepare('SELECT * FROM appointment_series WHERE id = ?').get(seriesId) as SeriesRow
    const ids = materialize({ ...series, materialized_until: '0000-00-00' }, [through, template.first].sort().reverse()[0]!)
    if (ids.length === 0) throw new ApptError('That series has no dates. Check the end date.')
    snapshot.createdSeriesIds.push(seriesId)
    snapshot.createdAppointmentIds.push(...ids)
    return { snapshot, ids }
  })()
}

function rowOf(id: number): ApptRow {
  const a = getDb().prepare('SELECT * FROM appointments WHERE id = ?').get(id) as ApptRow | undefined
  if (!a) throw new ApptError('That appointment no longer exists.')
  return a
}

/** The appointment with a patch applied, checked as a whole */
function merged(a: ApptRow, patch: ApptPatch) {
  const p = parsed(apptPatchSchema.safeParse(patch))
  const allDay = p.all_day ?? !!a.all_day
  return parsed(apptInputSchema.safeParse({
    row_id: p.row_id !== undefined ? p.row_id : a.row_id,
    title: p.title ?? a.title,
    start_at: p.start_at ?? a.start_at,
    end_at: p.end_at !== undefined ? p.end_at : a.end_at,
    all_day: allDay,
    location: p.location !== undefined ? p.location : a.location,
    activity_type_key: p.activity_type_key !== undefined ? p.activity_type_key : a.activity_type_key,
    notes: p.notes !== undefined ? p.notes : a.notes,
  }))
}

function seriesRow(id: number): SeriesRow {
  return getDb().prepare('SELECT * FROM appointment_series WHERE id = ?').get(id) as SeriesRow
}

/** End a series the day before `date`, removing its scheduled occurrences from then on */
function endSeriesBefore(s: SeriesRow, date: string): void {
  const db = getDb()
  const rule = JSON.parse(s.rule) as SeriesRule
  const until = addDays(date, -1)
  const next: SeriesRule = { ...rule, until: rule.until && rule.until < until ? rule.until : until }
  delete next.count
  db.prepare('UPDATE appointment_series SET rule = ? WHERE id = ?').run(JSON.stringify(next), s.id)
  removeAppointments((db.prepare("SELECT id FROM appointments WHERE series_id = ? AND status = 'scheduled' AND COALESCE(series_date, substr(start_at, 1, 10)) >= ?").all(s.id, date) as Array<{ id: number }>).map(r => r.id))
}

/**
 * The rule for the new series "This and following" starts on `newFirst`
 * (moved from `from`): a "10 times" series keeps only the times it has
 * left, and weekly days shift with the moved day (Tue/Thu moved to Wed
 * becomes Wed/Fri). Null when no times are left.
 */
export function followingRule(rule: SeriesRule, first: string, from: string, newFirst: string, untilColumn?: string | null): SeriesRule | null {
  const r: SeriesRule = { ...rule }
  if (rule.count) {
    const used = seriesDates(rule, first, addDays(from, -1), untilColumn).length
    if (rule.count - used <= 0) return null
    r.count = rule.count - used
  }
  if (rule.freq === 'weekly' && rule.byDay?.length && newFirst !== from) {
    const shift = (parseYmd(newFirst).getDay() - parseYmd(from).getDay() + 7) % 7
    if (shift) r.byDay = [...new Set(rule.byDay.map(d => (d + shift) % 7))].sort()
  }
  return r
}

/**
 * Change an appointment, or its series from here on. A new rule (how it
 * repeats, or when it ends) always applies from this one on, as "This and
 * following" does (audit S-18).
 */
export function updateAppointment(id: number, patch: ApptPatch, scope: EditScope = 'one', newRule?: SeriesRule | null): ApptChange {
  const db = getDb()
  const ruleChange = newRule ? parsed(seriesRuleSchema.safeParse(newRule)) : null
  if (ruleChange) scope = 'following'
  return db.transaction((): ApptChange => {
    const a = rowOf(id)
    const v = merged(a, patch)
    const rowId = checkRecord(v.row_id)
    if (ruleChange && a.series_id === null) throw new ApptError('Only a repeating appointment has a pattern to change.')
    if (ruleChange?.untilColumnId && rowId === null) throw new ApptError(`Choose the ${word('record')} whose date ends the series.`)
    if (a.series_id === null || scope === 'one') {
      const snapshot = tracker([], [id])
      db.prepare(`UPDATE appointments SET row_id = ?, title = ?, start_at = ?, end_at = ?, all_day = ?, location = ?, activity_type_key = ?, notes = ?,
        is_exception = CASE WHEN series_id IS NULL THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?`)
        .run(rowId, v.title, v.start_at, v.end_at ?? null, v.all_day ? 1 : 0, v.location, v.activity_type_key ?? null, v.notes, id)
      return { snapshot, ids: [id] }
    }
    const s = seriesRow(a.series_id)
    const snapshot = tracker([s.id], [])
    const t = JSON.parse(s.template) as StoredTemplate
    const rule = JSON.parse(s.rule) as SeriesRule
    const from = a.series_date ?? a.start_at.slice(0, 10)
    if (scope === 'all') {
      if (v.start_at.slice(0, 10) !== a.start_at.slice(0, 10)) throw new ApptError('To move the dates of a series, choose "This and following".')
      const next: StoredTemplate = { ...templateOf({ ...v, row_id: rowId, end_at: v.end_at ?? null }), first: t.first, exdates: t.exdates }
      db.prepare('UPDATE appointment_series SET template = ? WHERE id = ?').run(JSON.stringify(next), s.id)
      // Past and done occurrences are never changed, nor ones edited on their own
      const today = localDateString()
      const future = db.prepare("SELECT id, series_date, start_at FROM appointments WHERE series_id = ? AND status = 'scheduled' AND is_exception = 0 AND substr(start_at, 1, 10) >= ?").all(s.id, today) as Array<{ id: number; series_date: string | null; start_at: string }>
      for (const f of future) {
        const day = f.start_at.slice(0, 10)
        const start = next.time ? `${day}T${next.time}` : day
        const end = next.time && next.duration_min ? addMinutes(start, next.duration_min) : null
        db.prepare("UPDATE appointments SET row_id = ?, title = ?, start_at = ?, end_at = ?, all_day = ?, location = ?, activity_type_key = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
          .run(rowId, next.title, start, end, next.time ? 0 : 1, next.location, next.activity_type_key, next.notes, f.id)
      }
      if (!future.some(f => f.id === id)) {
        // The one being edited is in the past or done: it takes the change too
        db.prepare("UPDATE appointments SET row_id = ?, title = ?, start_at = ?, end_at = ?, all_day = ?, location = ?, activity_type_key = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
          .run(rowId, v.title, v.start_at, v.end_at ?? null, v.all_day ? 1 : 0, v.location, v.activity_type_key ?? null, v.notes, id)
      }
      return { snapshot, ids: [id] }
    }
    // This and following: the old series ends the day before; a new one starts here
    endSeriesBefore(s, from)
    const next = { ...templateOf({ ...v, row_id: rowId, end_at: v.end_at ?? null }) }
    const r = ruleChange ?? followingRule(rule, t.first, from, next.first, untilFromColumn(rule, t.row_id))
    if (!r) return { snapshot, ids: [] }
    const newId = Number(db.prepare('INSERT INTO appointment_series (rule, template, materialized_until) VALUES (?, ?, ?)')
      .run(JSON.stringify(r), JSON.stringify(next), '0000-00-00').lastInsertRowid)
    const ids = materialize(seriesRow(newId), [s.materialized_until, next.first].sort().reverse()[0]!)
    if (ruleChange && ids.length === 0) throw new ApptError('That pattern has no dates from this one on. Check the end date.')
    snapshot.createdSeriesIds.push(newId)
    snapshot.createdAppointmentIds.push(...ids)
    return { snapshot, ids }
  })()
}

/** "End this series on…": the last day it happens; scheduled ones after it go (audit S-18) */
export function endSeriesOn(id: number, lastDate: string): ApptChange {
  if (!DATE_RE.test(lastDate)) throw new ApptError('Choose the last day.')
  const db = getDb()
  return db.transaction((): ApptChange => {
    const a = rowOf(id)
    if (a.series_id === null) throw new ApptError("That appointment doesn't repeat.")
    const s = seriesRow(a.series_id)
    const snapshot = tracker([s.id], [])
    endSeriesBefore(s, addDays(lastDate, 1))
    return { snapshot, ids: [id] }
  })()
}

export function deleteAppointment(id: number, scope: EditScope = 'one'): ApptChange {
  const db = getDb()
  return db.transaction((): ApptChange => {
    const a = rowOf(id)
    if (a.series_id === null || scope === 'one') {
      const snapshot = a.series_id ? tracker([a.series_id], [id]) : tracker([], [id])
      if (a.series_id !== null && a.series_date) {
        const s = seriesRow(a.series_id)
        const t = JSON.parse(s.template) as StoredTemplate
        t.exdates = [...new Set([...(t.exdates ?? []), a.series_date])]
        db.prepare('UPDATE appointment_series SET template = ? WHERE id = ?').run(JSON.stringify(t), s.id)
      }
      removeAppointments([id])
      return { snapshot, ids: [id] }
    }
    const s = seriesRow(a.series_id)
    const snapshot = tracker([s.id], [])
    if (scope === 'following') {
      endSeriesBefore(s, a.series_date ?? a.start_at.slice(0, 10))
      return { snapshot, ids: [id] }
    }
    // The whole series: done, missed and cancelled ones stay, as do scheduled ones already past
    removeAppointments((db.prepare("SELECT id FROM appointments WHERE series_id = ? AND status = 'scheduled' AND substr(start_at, 1, 10) >= ?").all(s.id, localDateString()) as Array<{ id: number }>).map(r => r.id))
    db.prepare('UPDATE appointments SET series_id = NULL WHERE series_id = ?').run(s.id)
    db.prepare('DELETE FROM appointment_series WHERE id = ?').run(s.id)
    return { snapshot, ids: [id] }
  })()
}


// ── Done, no-show, cancelled (W07 §4) ────────────────────────────────────────

export interface StatusOptions {
  /** The note's text; "Appointment: {title}" when empty */
  noteContent?: string
  minutes?: number | null
  miles?: number | null
  extra?: Record<string, number> | null
}

export interface StatusChange {
  previous: ApptStatus
  /** The note made for this change, if any */
  caseLogId: number | null
  /** The note voided because the appointment left that status */
  voidedNoteId: number | null
  /** Dates moved by the note (A1), with what they held, for undo */
  updatedDates: NoteDateUpdate[]
  /** Dates put back because the earlier note was voided (audit 1.23) */
  revertedDates: NoteDateRevert[]
  rowId: number | null
}

/** A local wall time as a stored UTC timestamp; never later than now */
function noteTimestamp(wall: string): string {
  const [y, mo, d] = wall.slice(0, 10).split('-').map(Number) as [number, number, number]
  const [h, mi] = wall.length > 10 ? wall.slice(11, 16).split(':').map(Number) as [number, number] : [12, 0]
  const at = new Date(y, mo - 1, d, h, mi)
  const when = at.getTime() > Date.now() ? new Date() : at
  return when.toISOString().replace('T', ' ').slice(0, 19)
}

function noteTypeFor(a: ApptRow): string {
  if (a.activity_type_key && isValidLogType(a.activity_type_key) && userTypeKeys(false).has(a.activity_type_key)) return a.activity_type_key
  const types = userTypeKeys(false)
  return types.has('visit') ? 'visit' : [...types][0] ?? 'note'
}

/**
 * Mark an appointment done, missed (no-show), cancelled, or back to
 * scheduled. Done makes a note of the appointment's kind (dated the day
 * it happened, with its length as minutes when time is tracked), which
 * counts toward requirements and visit limits and moves dates that follow
 * notes. No-show and cancelled make a note only when those kinds exist.
 * Leaving a status voids the note it made.
 */
export function setAppointmentStatus(id: number, status: ApptStatus, opts: StatusOptions = {}): StatusChange {
  const db = getDb()
  return db.transaction((): StatusChange => {
    const a = rowOf(id)
    const change: StatusChange = { previous: a.status, caseLogId: null, voidedNoteId: null, updatedDates: [], revertedDates: [], rowId: a.row_id }
    if (a.status === status) return change
    if (a.case_log_id !== null) {
      db.prepare("UPDATE case_log SET voided_at = datetime('now'), voided_reason = ? WHERE id = ? AND voided_at IS NULL")
        .run(`The appointment was changed to ${status.replace('_', '-')}`, a.case_log_id)
      change.voidedNoteId = a.case_log_id
      // "Back to scheduled" (or a different outcome) puts back the dates the old note moved
      change.revertedDates = revertNoteDates(a.case_log_id)
    }
    let noteId: number | null = null
    if (a.row_id !== null && !db.prepare('SELECT 1 FROM rows WHERE id = ? AND deleted_at IS NULL').get(a.row_id)) throw new ApptError(`That ${word('record')} is no longer available.`)
    if (a.row_id !== null && status !== 'scheduled') {
      const userTypes = userTypeKeys(false)
      const type = status === 'done' ? noteTypeFor(a) : userTypes.has(status) ? status : null
      if (type) {
        const content = opts.noteContent?.trim()
          || (status === 'done' ? `${word('appointment', { cap: true })}: ${a.title}` : `${CLOSED_NOTE_PREFIX[status]}: ${a.title}`)
        if (content.length > 100_000) throw new ApptError(`That ${word('activity')} is too long.`)
        let minutes = opts.minutes ?? null
        if (minutes === null && status === 'done' && featureOn('timeTracking') && a.end_at && !a.all_day) minutes = Math.max(0, Math.min(1440, minutesBetween(a.start_at, a.end_at)))
        if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) throw new ApptError('Minutes must be a whole number up to 1,440.')
        const miles = opts.miles ?? null
        if (miles !== null && (!Number.isFinite(miles) || miles < 0 || miles > 2000)) throw new ApptError('Miles must be a number up to 2,000.')
        const extra = cleanExtraMeasures(opts.extra ?? null)
        if (extra && typeof extra === 'object') throw new ApptError(extra.error)
        const at = noteTimestamp(a.start_at)
        // It happened at the appointment's time; created_at stays when it was recorded
        noteId = Number(db.prepare(`INSERT INTO case_log (row_id, content, log_type, minutes, miles, extra_measures, source_action_id, occurred_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(a.row_id, content, type, minutes || null, miles, extra, `appt:${id}`, at).lastInsertRowid)
        if (status === 'done') change.updatedDates = applyNoteDateUpdates(a.row_id, type, a.start_at.slice(0, 10) > localDateString() ? localDateString() : a.start_at.slice(0, 10), noteId)
      }
    }
    db.prepare("UPDATE appointments SET status = ?, case_log_id = ?, updated_at = datetime('now') WHERE id = ?").run(status, noteId, id)
    change.caseLogId = noteId
    return change
  })()
}

/** How many days back "needs an outcome" looks (S-09) */
export const OUTCOME_LOOKBACK_DAYS = 14

/**
 * Appointments from the last two weeks still marked scheduled: nobody said
 * whether they happened, so no note was written and nothing was counted (S-09).
 * Archived records and deleted lists are left out, as on the calendar, or the
 * briefing would count appointments nobody can find.
 */
export function appointmentsNeedingOutcome(today = localDateString()): number {
  if (!featureOn('appointments')) return 0
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - OUTCOME_LOOKBACK_DAYS)
  const from = localDateString(d)
  const r = getDb().prepare(`
    SELECT COUNT(*) AS n FROM appointments a LEFT JOIN rows r ON r.id = a.row_id LEFT JOIN grids g ON g.id = r.grid_id
    WHERE a.status = 'scheduled' AND a.start_at >= ? AND a.start_at < ? AND ${OPEN_RECORD_SQL}
  `).get(from, today) as { n: number }
  return r.n
}

/** Today's scheduled appointments, for the briefing (W07 §7) */
export function appointmentsToday(today = localDateString()): { appointmentsToday: number; firstAppointment: string | null } {
  if (!featureOn('appointments')) return { appointmentsToday: 0, firstAppointment: null }
  const r = getDb().prepare(`
    SELECT COUNT(*) AS n, MIN(CASE WHEN a.all_day = 0 THEN a.start_at END) AS first
    FROM appointments a LEFT JOIN rows r ON r.id = a.row_id LEFT JOIN grids g ON g.id = r.grid_id
    WHERE a.status = 'scheduled' AND a.start_at >= ? AND a.start_at <= ? AND ${OPEN_RECORD_SQL}
  `).get(today, `${today}T99:99`) as { n: number; first: string | null }
  return { appointmentsToday: r.n, firstAppointment: r.first }
}

// ── Archiving a record (audit 1.13) ──────────────────────────────────────────

/** The records' scheduled appointments from today on (including their series' future dates already made) */
function upcomingIds(rowIds: number[], today: string): number[] {
  if (rowIds.length === 0) return []
  return (getDb().prepare(`SELECT id FROM appointments WHERE status = 'scheduled' AND substr(start_at, 1, 10) >= ?
    AND row_id IN (${rowIds.map(() => '?').join(',')})`).all(today, ...rowIds) as Array<{ id: number }>).map(r => r.id)
}

/** The series made for these records */
function seriesOfRecords(rowIds: number[]): SeriesRow[] {
  const ids = new Set(rowIds)
  return (getDb().prepare('SELECT * FROM appointment_series').all() as SeriesRow[]).filter(s => {
    try { const r = (JSON.parse(s.template) as StoredTemplate).row_id; return r != null && ids.has(r) } catch { return false }
  })
}

/** How many upcoming appointments archiving these records would leave behind */
export function countUpcomingForRecords(rowIds: number[], today = localDateString()): number {
  ensureMaterialized()
  return upcomingIds(rowIds, today).length
}

/**
 * Cancel the records' upcoming appointments: their series end yesterday
 * (the way "This and following" delete ends one), and scheduled ones from
 * today on are removed. What already happened stays. One snapshot undoes it.
 */
export function cancelUpcomingForRecords(rowIds: number[], today = localDateString()): ApptChange {
  const db = getDb()
  return db.transaction((): ApptChange => {
    const series = seriesOfRecords(rowIds)
    const ids = upcomingIds(rowIds, today)
    const snapshot = tracker(series.map(s => s.id), ids)
    for (const s of series) endSeriesBefore(s, today)
    removeAppointments(ids)
    return { snapshot, ids }
  })()
}
