/**
 * export-ics.ts — calendar file of upcoming deadlines and follow-ups (C1).
 *
 * Workers live in Outlook or Google Calendar. This writes a standard .ics
 * file they can import, with a reminder the day before. Clients appear as
 * initials unless the user opts in to full names, and note text is never
 * included: a calendar is often synced to places Pulse can't protect.
 */

import { getDb } from './database'
import { atomicWriteFileAsync } from './export-shared'
import { localDateFromToday } from '../shared/dates'
import { featureOn, word } from './vocab'
import { loadDeadlines } from './deadlines'
import { isPersonKind } from '../shared/types'
import { OPEN_RECORD_SQL } from '../shared/appointments'
import { removedAppointments } from './appointments'
import { LIVE_GRID, LIVE_ROW } from '../shared/liveRecords'

export interface IcsOptions {
  /** Full client names instead of initials (and caseload task titles) */
  fullNames?: boolean
  /** How far ahead to include, in days (default 180) */
  horizonDays?: number
}

interface IcsItem {
  uid: string
  date: string
  summary: string
  /** Timed events (appointments): local wall times, written as floating times */
  start?: string
  end?: string | null
  /** All-day items running over several days: the last day (inclusive) */
  lastDate?: string
  /** Sent as cancelled, so a calendar that imported it before drops it */
  cancelled?: boolean
}

/** "Jane Smith" → "J.S."; "Smith, Jane" → "J.S." */
export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const ordered = trimmed.includes(',') ? trimmed.split(',').reverse().join(' ') : trimmed
  const letters = ordered.split(/\s+/).filter(Boolean).map(w => w[0]!.toUpperCase())
  return letters.length ? letters.join('.') + '.' : '?'
}

/** RFC 5545 text escaping. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length)
    // Don't split a multi-byte character
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
  }
  return parts.join('\r\n ')
}

function ymdCompact(ymd: string): string { return ymd.replace(/-/g, '') }

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y!, m! - 1, d! + 1)
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`
}

/** An all-day appointment that ends on a later day keeps its last day (AUDIT-116) */
function allDayEnd(start: string, end: string | null): Pick<IcsItem, 'lastDate'> {
  const last = end?.slice(0, 10)
  return last && /^\d{4}-\d{2}-\d{2}$/.test(last) && last > start.slice(0, 10) ? { lastDate: last } : {}
}

export function loadIcsItems(opts: IcsOptions = {}): IcsItem[] {
  const db = getDb()
  const from = localDateFromToday(-30)
  const to = localDateFromToday(opts.horizonDays ?? 180)
  // People are shown by initials unless full names are asked for; things and jobs by name
  const who = (name: string | null, kind: string | null) => {
    const n = (name ?? '').trim() || word('record', { cap: true })
    return opts.fullNames || !isPersonKind(kind) ? n : initials(n)
  }

  // Calendar rules with a lead time are in the file before the lead starts: the lead is about nagging, not about existing (audit D-33)
  const deadlines = loadDeadlines({ from, to, includeUpcoming: true }).map(d => ({
    row_id: d.row_id, column_id: d.column_id, name: d.client_name, kind: d.record_kind, what: d.column_name, due: d.due!,
  }))

  const followUps = db.prepare(`
    SELECT cl.id, r.display_name AS name, g.record_kind AS kind, cl.follow_up_date AS due
    FROM case_log cl
    JOIN rows r ON r.id = cl.row_id AND ${LIVE_ROW}
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE cl.follow_up_date BETWEEN ? AND ? AND cl.follow_up_completed = 0 AND cl.voided_at IS NULL
  `).all(from, to) as Array<{ id: number; name: string | null; kind: string | null; due: string }>

  const tasks = db.prepare(`
    SELECT ct.id, ct.title, ct.due_date AS due FROM caseload_tasks ct
    LEFT JOIN grids g ON g.id = ct.grid_id
    WHERE ct.is_completed = 0 AND ct.due_date BETWEEN ? AND ? AND (ct.grid_id IS NULL OR ${LIVE_GRID})
  `).all(from, to) as Array<{ id: number; title: string; due: string }>

  // Appointments (W07 §7): titles are free text that may name people, so without full names only "Appointment with J.S."
  const appointments = featureOn('appointments') ? db.prepare(`
    SELECT a.id, a.title, a.start_at, a.end_at, a.all_day, r.display_name AS name, g.record_kind AS kind
    FROM appointments a LEFT JOIN rows r ON r.id = a.row_id LEFT JOIN grids g ON g.id = r.grid_id
    WHERE a.status = 'scheduled' AND a.start_at >= ? AND a.start_at <= ? AND ${OPEN_RECORD_SQL}
  `).all(from, `${to}T99:99`) as Array<{ id: number; title: string; start_at: string; end_at: string | null; all_day: number; name: string | null; kind: string | null }> : []

  // Cancelled ones, ones whose record was archived or deleted, and ones removed lately go out as
  // cancelled with the same UID, so a calendar that imported them before drops them (audit S-30)
  const cancelled: IcsItem[] = []
  if (featureOn('appointments')) {
    const gone = db.prepare(`
      SELECT a.id, a.start_at, a.end_at, a.all_day FROM appointments a LEFT JOIN rows r ON r.id = a.row_id LEFT JOIN grids g ON g.id = r.grid_id
      WHERE a.start_at >= ? AND a.start_at <= ? AND (a.status = 'cancelled' OR (a.status = 'scheduled' AND NOT ${OPEN_RECORD_SQL}))
    `).all(from, `${to}T99:99`) as Array<{ id: number; start_at: string; end_at: string | null; all_day: number }>
    for (const a of [...gone, ...removedAppointments().filter(r => r.start_at >= from && r.start_at <= `${to}T99:99`)]) {
      cancelled.push({
        uid: `appointment-${a.id}@pulse`, date: a.start_at.slice(0, 10), summary: `Cancelled: ${word('appointment', { cap: true })}`, cancelled: true,
        ...(a.all_day ? allDayEnd(a.start_at, a.end_at) : { start: a.start_at, end: a.end_at }),
      })
    }
  }

  const items: IcsItem[] = [
    ...cancelled,
    ...appointments.map(a => ({
      uid: `appointment-${a.id}@pulse`, date: a.start_at.slice(0, 10),
      summary: opts.fullNames ? `${a.title}${a.name ? ` (${a.name})` : ''}` : `${word('appointment', { cap: true })}${a.name ? ` with ${who(a.name, a.kind)}` : ''}`,
      ...(a.all_day ? allDayEnd(a.start_at, a.end_at) : { start: a.start_at, end: a.end_at }),
    })),
    // Stable UIDs, so importing a newer file updates events instead of duplicating them
    ...deadlines.map(d => ({ uid: `deadline-${d.row_id}-${d.column_id}@pulse`, date: d.due.slice(0, 10), summary: `${who(d.name, d.kind)}: ${d.what}` })),
    ...followUps.map(f => ({ uid: `followup-${f.id}@pulse`, date: f.due.slice(0, 10), summary: `${who(f.name, f.kind)}: follow-up` })),
    // Task titles are free text that may name clients, so they're only included with full names on
    ...(opts.fullNames ? tasks : []).map(t => ({ uid: `task-${t.id}@pulse`, date: t.due.slice(0, 10), summary: `Task: ${t.title}` })),
  ]
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''))
}

export function buildIcs(items: IcsItem[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BaringaSoft//Pulse//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Pulse',
  ]
  for (const it of items) {
    if (it.start) {
      // Floating local time: the same wall-clock time wherever the calendar is (W07 §2)
      const t = (w: string) => `${w.slice(0, 10).replace(/-/g, '')}T${w.slice(11, 16).replace(':', '')}00`
      lines.push(
        'BEGIN:VEVENT',
        `UID:${it.uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${t(it.start)}`,
        ...(it.end ? [`DTEND:${t(it.end)}`] : [`DURATION:PT1H`]),
        `SUMMARY:${esc(it.summary)}`,
        ...(it.cancelled ? ['STATUS:CANCELLED'] : ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.summary)}`, 'TRIGGER:-PT30M', 'END:VALARM']),
        'END:VEVENT',
      )
      continue
    }
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymdCompact(it.date)}`,
      // DTEND is exclusive: the day after the last day
      `DTEND;VALUE=DATE:${nextDay(it.lastDate && it.lastDate > it.date ? it.lastDate : it.date)}`,
      `SUMMARY:${esc(it.summary)}`,
      'TRANSP:TRANSPARENT',
      // 9 AM the day before an all-day event
      ...(it.cancelled ? ['STATUS:CANCELLED'] : ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.summary)}`, 'TRIGGER:-PT15H', 'END:VALARM']),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

export async function exportIcs(destPath: string, opts: IcsOptions = {}): Promise<number> {
  const items = loadIcsItems(opts)
  await atomicWriteFileAsync(destPath, buildIcs(items), 'utf8')
  return items.length
}
