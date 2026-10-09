/** Desktop reminders (W11 §2): the daily summary's schedule, wording and dedupe. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
const shown: string[] = []
vi.mock('electron', () => ({
  Notification: class {
    static isSupported() { return true }
    body: string
    constructor(o: { body: string }) { this.body = o.body }
    on() {}
    show() { shown.push(this.body) }
  },
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp', isPackaged: false },
}))
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

import { dailyDue, dailySummaryText, reminderTick, setReminderSettings, getReminderSettings, reminderPatchSchema, DEFAULT_REMINDERS, apptRemindersDue, apptReminderText, resetSentAppointments, lockedReminders, snapshotForLock, setLockedSnapshot, lockedSnapshot, type ApptForReminder } from '../src/main/reminders'
import { localDateFromToday, localDateString } from '../src/shared/dates'

const at = (h: number, m = 0, day = 2) => new Date(2026, 9, day, h, m)
const on = { ...DEFAULT_REMINDERS, dailyEnabled: true, dailyTime: '08:30' }

describe('when the daily summary is due', () => {
  it('only once the time has come, once a day, and only when on', () => {
    expect(dailyDue(at(8, 29), on, null)).toBe(false)
    expect(dailyDue(at(8, 30), on, null)).toBe(true)
    expect(dailyDue(at(17, 0), on, '2026-10-01')).toBe(true)
    expect(dailyDue(at(17, 0), on, '2026-10-02')).toBe(false)
    expect(dailyDue(at(9, 0), { ...on, dailyEnabled: false }, null)).toBe(false)
    expect(dailyDue(at(0, 5, 3), { ...on, dailyTime: '00:00' }, '2026-10-02')).toBe(true)
  })

  it('says how much is due, never who', () => {
    expect(dailySummaryText({ dueToday: 3, overdue: 1 })).toBe('3 due today, 1 overdue')
    expect(dailySummaryText({ dueToday: 0, overdue: 2 })).toBe('2 overdue')
    expect(dailySummaryText({ dueToday: 0, overdue: 0 })).toBeNull()
  })

  it('only accepts real times', () => {
    expect(reminderPatchSchema.safeParse({ dailyTime: '07:05' }).success).toBe(true)
    expect(reminderPatchSchema.safeParse({ dailyTime: '24:00' }).success).toBe(false)
    expect(reminderPatchSchema.safeParse({ dailyTime: '7:05' }).success).toBe(false)
    expect(reminderPatchSchema.safeParse({ other: 1 }).success).toBe(false)
  })
})

describe('the reminder check', () => {
  beforeEach(() => {
    t = createTestDb(); shown.length = 0
    const g = seedGrid(t.db, { columnTypes: ['text', 'date'], rowCount: 2 })
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds) VALUES ('Due', '[]')").run().lastInsertRowid)
    t.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: rule }), g.columnIds[1])
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?), (?, ?, ?)')
      .run(g.rowIds[0], g.columnIds[1], localDateFromToday(0), g.rowIds[1], g.columnIds[1], localDateFromToday(-3))
  })
  afterEach(() => cleanupTestDb(t))

  const late = () => { const d = new Date(); d.setHours(23, 59); return d }
  const features = (v: boolean) => t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify({ notifications: v }))

  it('counts appointments in the workspace\'s word', () => {
    expect(dailySummaryText({ dueToday: 3, overdue: 1, appointments: 2 })).toBe('3 due today, 1 overdue, 2 appointments')
    expect(dailySummaryText({ dueToday: 0, overdue: 0, appointments: 1 })).toBe('1 appointment')
  })

  it('stays quiet until both the feature and the reminder are on', () => {
    expect(getReminderSettings()).toEqual(DEFAULT_REMINDERS)
    expect(reminderTick(late())).toEqual([])
    features(true)
    expect(reminderTick(late())).toEqual([])
    expect(shown).toEqual([])
  })

  it('sends the summary once a day', () => {
    features(true)
    t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('reminders_daily_enabled', 'true'), ('reminders_daily_time', '00:00')").run()
    expect(reminderTick(late())).toEqual(['1 due today, 1 overdue'])
    expect(reminderTick(late())).toEqual([])
    expect(shown).toEqual(['1 due today, 1 overdue'])
  })

  it('turning it on after today\'s time waits for tomorrow', () => {
    features(true)
    setReminderSettings({ dailyEnabled: true, dailyTime: '00:00' })
    expect(reminderTick(late())).toEqual([])
    expect(getReminderSettings()).toEqual({ ...DEFAULT_REMINDERS, dailyEnabled: true, dailyTime: '00:00' })
  })
})

describe('appointment reminders', () => {
  const appt = (start_at: string, extra: Partial<ApptForReminder> = {}): ApptForReminder =>
    ({ id: 1, start_at, all_day: 0, record_name: 'Jane Smith', record_kind: 'person', ...extra })

  it('are due from the lead time up to the start, once, and again if the time moves', () => {
    const a = appt('2026-10-02T15:00')
    expect(apptRemindersDue(at(14, 49), [a], 10, new Set())).toEqual([])
    expect(apptRemindersDue(at(14, 50), [a], 10, new Set())).toEqual([a])
    expect(apptRemindersDue(at(14, 59), [a], 10, new Set())).toEqual([a])
    expect(apptRemindersDue(at(15, 0), [a], 10, new Set())).toEqual([])
    expect(apptRemindersDue(at(14, 55), [a], 10, new Set(['1@2026-10-02T15:00']))).toEqual([])
    expect(apptRemindersDue(at(15, 25), [appt('2026-10-02T15:30')], 10, new Set(['1@2026-10-02T15:00']))).toHaveLength(1)
    expect(apptRemindersDue(at(14, 55), [a], 0, new Set())).toEqual([])
    expect(apptRemindersDue(at(14, 55), [appt('2026-10-02', { all_day: 1 })], 60, new Set())).toEqual([])
  })

  it('cross midnight', () => {
    expect(apptRemindersDue(at(23, 50), [appt('2026-10-03T00:05')], 30, new Set())).toHaveLength(1)
    expect(apptRemindersDue(at(23, 30), [appt('2026-10-03T00:05')], 30, new Set())).toEqual([])
  })

  it('show initials or a thing\'s name only when names are on', () => {
    t = createTestDb()
    expect(apptReminderText(appt('2026-10-02T15:00'), false)).toBe('Appointment at 3:00 pm')
    expect(apptReminderText(appt('2026-10-02T15:00'), true)).toBe('Appointment at 3:00 pm with J.S.')
    expect(apptReminderText(appt('2026-10-02T09:05', { record_name: '2017 Civic', record_kind: 'thing' }), true, '24h')).toBe('Appointment at 09:05 with 2017 Civic')
    expect(apptReminderText(appt('2026-10-02T15:00', { record_name: null }), true)).toBe('Appointment at 3:00 pm')
    cleanupTestDb(t)
  })

  it('only accepts the offered lead times', () => {
    expect(reminderPatchSchema.safeParse({ apptLeadMinutes: 15 }).success).toBe(true)
    expect(reminderPatchSchema.safeParse({ apptLeadMinutes: 7 }).success).toBe(false)
  })

  describe('the check', () => {
    beforeEach(() => { t = createTestDb(); shown.length = 0; resetSentAppointments() })
    afterEach(() => cleanupTestDb(t))

    it('reminds before scheduled appointments only, once each', () => {
      t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify({ notifications: true, appointments: true }))
      setReminderSettings({ apptLeadMinutes: 15, showNames: true })
      const g = seedGrid(t.db, { columnTypes: ['text'], rowCount: 1 })
      t.db.prepare("UPDATE rows SET display_name = 'Jane Smith' WHERE id = ?").run(g.rowIds[0])
      const now = new Date(); now.setSeconds(0, 0)
      const soon = new Date(now.getTime() + 10 * 60_000)
      const wall = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}T${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`
      const ins = t.db.prepare('INSERT INTO appointments (row_id, title, start_at, status) VALUES (?, ?, ?, ?)')
      ins.run(g.rowIds[0], 'Visit', wall, 'scheduled')
      ins.run(g.rowIds[0], 'Gone', wall, 'cancelled')
      const sent = reminderTick(now)
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatch(/^Appointment at .+ with J\.S\.$/)
      expect(reminderTick(now)).toEqual([])
      expect(shown).toHaveLength(1)
    })
  })
})

describe('while locked in the tray (W11 §3)', () => {
  const snap = (over: Partial<import('../src/main/reminders').LockedSnapshot> = {}): import('../src/main/reminders').LockedSnapshot => ({
    date: '2026-10-02', counts: { dueToday: 3, overdue: 1, appointments: 2 },
    settings: { ...DEFAULT_REMINDERS, dailyEnabled: true, dailyTime: '08:30', apptLeadMinutes: 10, showNames: true },
    lastDaily: null, notificationsOn: true, apptsOn: true, apptTimes: ['2026-10-02T15:00'], clock: '12h',
    words: { one: 'appointment', many: 'appointments', oneCap: 'Appointment', manyCap: 'Appointments' }, ...over,
  })

  it('uses the counts kept at lock time, once a day', () => {
    const s = snap()
    expect(lockedReminders(at(8, 30), s, new Set())).toEqual([{ text: '3 due today, 1 overdue, 2 appointments', route: '/dashboard' }])
    expect(lockedReminders(at(9, 0), s, new Set())).toEqual([])
  })

  it('does not trust counts from an earlier day', () => {
    const out = lockedReminders(at(8, 30, 3), snap(), new Set())
    expect(out).toHaveLength(1)
    expect(out[0].text).not.toMatch(/\d/)
  })

  it('reminds of appointment times only, never names, even with names on', () => {
    const sent = new Set<string>()
    const out = lockedReminders(at(14, 55), snap({ lastDaily: '2026-10-02' }), sent)
    expect(out).toEqual([{ text: 'Appointment at 3:00 pm', route: '/calendar?date=2026-10-02' }])
    expect(lockedReminders(at(14, 56), snap({ lastDaily: '2026-10-02' }), sent)).toEqual([])
  })

  it('stays quiet when reminders or the feature are off', () => {
    expect(lockedReminders(at(14, 55), snap({ notificationsOn: false }), new Set())).toEqual([])
    expect(lockedReminders(at(14, 55), snap({ apptsOn: false, settings: { ...DEFAULT_REMINDERS, apptLeadMinutes: 10 } }), new Set())).toEqual([])
  })

  describe('capturing at lock time', () => {
    beforeEach(() => { t = createTestDb(); shown.length = 0; resetSentAppointments() })
    afterEach(() => cleanupTestDb(t))

    it('keeps counts and times but nothing that names a record', () => {
      t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify({ notifications: true, appointments: true }))
      const g = seedGrid(t.db, { columnTypes: ['text'], rowCount: 1 })
      t.db.prepare("UPDATE rows SET display_name = 'Jane Smith' WHERE id = ?").run(g.rowIds[0])
      const d = new Date(); d.setHours(23, 0, 0, 0)
      const wall = `${localDateString(d)}T23:00`
      t.db.prepare('INSERT INTO appointments (row_id, title, start_at, status) VALUES (?, ?, ?, ?)').run(g.rowIds[0], 'Jane Smith intake', wall, 'scheduled')
      const s = snapshotForLock()!
      expect(s.apptTimes).toContain(wall)
      expect(JSON.stringify(s)).not.toMatch(/Jane|Smith|intake/)
    })

    it('a summary sent while locked is not sent again after unlocking', () => {
      t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify({ notifications: true }))
      setReminderSettings({ dailyEnabled: true, dailyTime: '00:00' })
      const s = snapshotForLock()!
      setLockedSnapshot(s)
      s.lastDaily = localDateString(new Date()) // as if sent while locked
      expect(reminderTick(new Date())).toEqual([])
      expect(t.db.prepare("SELECT value FROM settings WHERE key = 'reminders_last_daily'").get()).toEqual({ value: localDateString(new Date()) })
      expect(lockedSnapshot()).toBeNull()
    })
  })
})
