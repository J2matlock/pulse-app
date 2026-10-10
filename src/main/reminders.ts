/**
 * Desktop reminders (generalization W11 §2): a daily summary of what's due
 * and a heads-up before each appointment, shown as system notifications
 * while Pulse is open and unlocked.
 *
 * Nothing runs while locked: the database is closed and the counts can't be
 * read. The daily summary never contains names; appointment reminders show
 * initials (or a thing's name) only when the person turns names on. The
 * schedule checks are pure so they can be tested without timers.
 */
import { Notification, BrowserWindow } from 'electron'
import { z } from 'zod'
import { getDb } from './database'
import { logger } from './logger'
import { logNonFatal } from './ipc/ipc-utils'
import { word, workspaceFeatures } from './vocab'
import { deadlineCounts } from './deadlines'
import { appointmentsToday } from './appointments'
import { initials } from './export-ics'
import { isOn } from '../shared/features'
import { localDateString } from '../shared/dates'
import { addDays } from '../shared/appointments'
import { formatTime } from '../shared/calendar'
import { isPersonKind } from '../shared/types'
import { IPC } from '../shared/ipc-channels'
import type { ReminderSettings } from '../shared/ipc-contract'

export const DEFAULT_REMINDERS: ReminderSettings = { dailyEnabled: false, dailyTime: '08:30', apptLeadMinutes: 0, showNames: false }

/** Minutes before an appointment to remind; 0 is off */
export const APPT_LEADS = [0, 5, 10, 15, 30, 60] as const

export const reminderPatchSchema = z.object({
  dailyEnabled: z.boolean().optional(),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  apptLeadMinutes: z.number().refine(n => (APPT_LEADS as readonly number[]).includes(n)).optional(),
  showNames: z.boolean().optional(),
}).strict()

const KEYS = {
  dailyEnabled: 'reminders_daily_enabled', dailyTime: 'reminders_daily_time', lastDaily: 'reminders_last_daily',
  apptLead: 'reminders_appt_lead', showNames: 'reminders_show_names',
} as const
const TICK_MS = 60_000

function readSetting(key: string): string | undefined {
  return (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
}

export function getReminderSettings(): ReminderSettings {
  const time = readSetting(KEYS.dailyTime)
  const lead = Number(readSetting(KEYS.apptLead))
  return {
    dailyEnabled: readSetting(KEYS.dailyEnabled) === 'true',
    dailyTime: time && reminderPatchSchema.shape.dailyTime.safeParse(time).success ? time : DEFAULT_REMINDERS.dailyTime,
    apptLeadMinutes: (APPT_LEADS as readonly number[]).includes(lead) ? lead : 0,
    showNames: readSetting(KEYS.showNames) === 'true',
  }
}

export function setReminderSettings(patch: z.infer<typeof reminderPatchSchema>): ReminderSettings {
  const save = getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  if (patch.dailyEnabled !== undefined) {
    save.run(KEYS.dailyEnabled, String(patch.dailyEnabled))
    // Turning it on after today's time has passed shouldn't fire straight away
    if (patch.dailyEnabled) save.run(KEYS.lastDaily, isPastTime(new Date(), patch.dailyTime ?? getReminderSettings().dailyTime) ? localDateString() : '')
  }
  if (patch.dailyTime !== undefined) save.run(KEYS.dailyTime, patch.dailyTime)
  if (patch.apptLeadMinutes !== undefined) save.run(KEYS.apptLead, String(patch.apptLeadMinutes))
  if (patch.showNames !== undefined) save.run(KEYS.showNames, String(patch.showNames))
  return getReminderSettings()
}

function isPastTime(now: Date, hhmm: string): boolean {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m
}

/** Due for today's summary: on, the time has come, and not already sent today. */
export function dailyDue(now: Date, settings: ReminderSettings, lastSent: string | null | undefined): boolean {
  return settings.dailyEnabled && isPastTime(now, settings.dailyTime) && lastSent !== localDateString(now)
}

/** The workspace's word for appointments, held so reminders can be worded while locked */
export interface ApptWords { one: string; many: string; oneCap: string; manyCap: string }

function apptWords(): ApptWords {
  return {
    one: word('appointment'), many: word('appointment', { many: true }),
    oneCap: word('appointment', { cap: true }), manyCap: word('appointment', { many: true, cap: true }),
  }
}

/** "3 due today, 1 overdue, 2 appointments"; null when there's nothing to say. Counts only, never names. */
export function dailySummaryText(c: { dueToday: number; overdue: number; appointments?: number }, words?: ApptWords): string | null {
  const parts: string[] = []
  if (c.dueToday > 0) parts.push(`${c.dueToday} due today`)
  if (c.overdue > 0) parts.push(`${c.overdue} overdue`)
  if (c.appointments) { const w = words ?? apptWords(); parts.push(`${c.appointments} ${c.appointments === 1 ? w.one : w.many}`) }
  return parts.length ? parts.join(', ') : null
}

/** A local wall-clock time "YYYY-MM-DDTHH:MM" as a Date */
function wallToDate(wall: string): Date {
  const [y, mo, d] = wall.slice(0, 10).split('-').map(Number) as [number, number, number]
  const [h, mi] = wall.slice(11, 16).split(':').map(Number) as [number, number]
  return new Date(y, mo - 1, d, h, mi)
}

export interface ApptForReminder { id: number; start_at: string; all_day: number; record_name: string | null; record_kind: string | null }

/**
 * Appointments whose reminder time has come: from `lead` minutes before the
 * start up to the start itself, not already sent. The key includes the time,
 * so moving an appointment reminds again at its new time.
 */
export function apptRemindersDue(now: Date, appts: ApptForReminder[], lead: number, sent: ReadonlySet<string>): ApptForReminder[] {
  if (lead <= 0) return []
  const t = now.getTime()
  return appts.filter(a => {
    if (a.all_day || a.start_at.length < 16 || sent.has(apptKey(a))) return false
    const start = wallToDate(a.start_at).getTime()
    return !sent.has(timeKey(a.start_at)) && t >= start - lead * 60_000 && t < start
  })
}

export const apptKey = (a: { id: number; start_at: string }) => `${a.id}@${a.start_at}`
/** Reminders sent while locked only know the time, so they're remembered by time */
const timeKey = (startAt: string) => `t@${startAt}`

/** "Appointment at 3:00 pm", plus "with J.S." (people) or the thing's name only when names are on */
export function apptReminderText(a: ApptForReminder, showNames: boolean, clock: '12h' | '24h' = '12h'): string {
  const base = `${word('appointment', { cap: true })} at ${formatTime(a.start_at, clock)}`
  if (!showNames || !a.record_name) return base
  return `${base} with ${isPersonKind(a.record_kind) ? initials(a.record_name) : a.record_name}`
}

/** Scheduled, timed appointments from now through the longest lead (crosses midnight) */
function upcomingAppointments(now: Date): ApptForReminder[] {
  const today = localDateString(now)
  return getDb().prepare(`
    SELECT a.id, a.start_at, a.all_day,
           CASE WHEN r.deleted_at IS NULL THEN NULLIF(r.display_name, '') END AS record_name, g.record_kind
    FROM appointments a LEFT JOIN rows r ON r.id = a.row_id LEFT JOIN grids g ON g.id = r.grid_id
    WHERE a.status = 'scheduled' AND a.all_day = 0 AND a.start_at >= ? AND a.start_at <= ?
      AND (a.row_id IS NULL OR (r.deleted_at IS NULL AND g.is_active = 1))
    ORDER BY a.start_at, a.id
  `).all(today, `${addDays(today, 1)}T99:99`) as ApptForReminder[]
}

/** Appointment reminders already shown; in memory only, so nothing about them is written to disk */
const sentAppts = new Set<string>()

function clockFormat(): '12h' | '24h' {
  return readSetting('clock_format') === '24h' ? '24h' : '12h'
}

// ── While locked in the tray (W11 §3) ─────────────────────────────────────────
// The database is closed, so what reminders need is captured at lock time and
// held in memory only: counts, settings and appointment *times* — no names.

export interface LockedSnapshot {
  /** The day the counts are for */
  date: string
  counts: { dueToday: number; overdue: number; appointments: number }
  settings: ReminderSettings
  lastDaily: string | null
  notificationsOn: boolean
  apptsOn: boolean
  /** Scheduled, timed appointments today and tomorrow, "YYYY-MM-DDTHH:MM" */
  apptTimes: string[]
  clock: '12h' | '24h'
  words: ApptWords
}

let locked: LockedSnapshot | null = null

/** Capture what reminders need before the database closes; null if it's already closed */
export function snapshotForLock(now = new Date()): LockedSnapshot | null {
  if (!dbOpen()) return null
  try {
    const today = localDateString(now)
    const features = workspaceFeatures()
    const apptsOn = isOn(features, 'appointments')
    return {
      date: today,
      counts: { ...deadlineCounts(today), appointments: appointmentsToday(today).appointmentsToday },
      settings: getReminderSettings(),
      lastDaily: readSetting(KEYS.lastDaily) ?? null,
      notificationsOn: isOn(features, 'notifications'),
      apptsOn,
      apptTimes: apptsOn ? [...new Set(upcomingAppointments(now).map(a => a.start_at))] : [],
      clock: clockFormat(),
      words: apptWords(),
    }
  } catch (err) {
    logNonFatal('reminders', 'snapshot for lock', err)
    return null
  }
}

export function setLockedSnapshot(snap: LockedSnapshot | null): void { locked = snap }
export function lockedSnapshot(): LockedSnapshot | null { return locked }

/** What to show while locked: the summary from the cached counts, and appointment times. Pure apart from `sent` and `snap.lastDaily`. */
export function lockedReminders(now: Date, snap: LockedSnapshot, sent: Set<string>): Array<{ text: string; route: string }> {
  if (!snap.notificationsOn) return []
  const out: Array<{ text: string; route: string }> = []
  const today = localDateString(now)
  if (dailyDue(now, snap.settings, snap.lastDaily)) {
    snap.lastDaily = today
    // Counts from an earlier day would be wrong, and the database can't be read
    const text = snap.date === today ? dailySummaryText(snap.counts, snap.words) : 'Unlock to see what\'s due today.'
    if (text) out.push({ text, route: '/dashboard' })
  }
  if (snap.apptsOn && snap.settings.apptLeadMinutes > 0) {
    const due = apptRemindersDue(now, snap.apptTimes.map((start_at, i) => ({ id: -1 - i, start_at, all_day: 0, record_name: null, record_kind: null })), snap.settings.apptLeadMinutes, sent)
    for (const a of due) {
      sent.add(timeKey(a.start_at))
      out.push({ text: `${snap.words.oneCap} at ${formatTime(a.start_at, snap.clock)}`, route: `/calendar?date=${a.start_at.slice(0, 10)}` })
    }
  }
  return out
}

/** After unlocking: keep a summary sent while locked from being sent again */
function absorbLockedSnapshot(now: Date): void {
  if (!locked) return
  const today = localDateString(now)
  if (locked.lastDaily === today && readSetting(KEYS.lastDaily) !== today) {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(KEYS.lastDaily, today)
  }
  locked = null
}

function dbOpen(): boolean {
  try { getDb(); return true } catch { return false }
}

function focusWindow(route: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(IPC.REMINDER_OPEN, route)
}

function show(body: string, route: string): boolean {
  if (!Notification.isSupported()) return false
  const n = new Notification({ title: 'Pulse', body, silent: false })
  n.on('click', () => focusWindow(route))
  n.show()
  return true
}

/** One check; returns what it sent, for tests and logs. */
export function reminderTick(now = new Date()): string[] {
  if (!dbOpen()) {
    if (!locked) return []
    const due = lockedReminders(now, locked, sentAppts)
    for (const r of due) show(r.text, r.route)
    return due.map(r => r.text)
  }
  const out: string[] = []
  try {
    absorbLockedSnapshot(now)
    const features = workspaceFeatures()
    if (!isOn(features, 'notifications')) return []
    const settings = getReminderSettings()
    if (dailyDue(now, settings, readSetting(KEYS.lastDaily))) {
      // Mark first, so a failure can't repeat the notification every minute
      getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(KEYS.lastDaily, localDateString(now))
      const text = dailySummaryText({ ...deadlineCounts(localDateString(now)), appointments: appointmentsToday(localDateString(now)).appointmentsToday })
      if (text) { show(text, '/dashboard'); out.push(text) }
    }
    if (settings.apptLeadMinutes > 0 && isOn(features, 'appointments')) {
      const clock = clockFormat()
      for (const a of apptRemindersDue(now, upcomingAppointments(now), settings.apptLeadMinutes, sentAppts)) {
        sentAppts.add(apptKey(a))
        const text = apptReminderText(a, settings.showNames, clock)
        show(text, `/calendar?date=${a.start_at.slice(0, 10)}`)
        out.push(text)
      }
    }
  } catch (err) {
    logNonFatal('reminders', 'reminder tick', err)
  }
  return out
}

/** For tests: forget which appointment reminders were shown */
export function resetSentAppointments(): void { sentAppts.clear(); locked = null }

/** A sample notification so people can check their system shows them. */
export function sendTestReminder(): boolean {
  return show('Reminders are working. This is what the daily summary looks like.', '/settings')
}

let timer: ReturnType<typeof setInterval> | null = null

export function startReminders(): void {
  if (timer) return
  timer = setInterval(() => { reminderTick() }, TICK_MS)
  logger.info('reminders', 'Reminder checks started')
}

export function stopReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
}
