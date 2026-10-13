/**
 * Events (calendar-flexibility plan): appointments with no record get their
 * own calendar layer and stay on the calendar, in reminders and in the
 * calendar file when the Appointments feature is switched off; record
 * appointments stay gated by the feature as before.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { localDateFromToday, localDateString } from '../src/shared/dates'
import type { Appointment } from '../src/shared/appointments'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const shown = vi.hoisted(() => [] as string[])

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => (name === 'userData' ? '/tmp/pulse-test-calendar-events' : '/tmp'),
    getName: () => 'Pulse Test', getVersion: () => '0.0.0-test', commandLine: { appendSwitch: () => {} }, on: () => {},
  },
  ipcMain: { handle: (channel: string, h: (...args: unknown[]) => unknown) => { handlers.set(channel, h) }, on: () => {}, removeHandler: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class { static isSupported() { return true } body: string; constructor(o: { body: string }) { this.body = o.body } on() {} show() { shown.push(this.body) } },
  dialog: { showMessageBox: async () => ({ response: 1 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

let t: TestDb
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql), invalidateGridStmtCache: () => {} }
})
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

const fakeEvent = { senderFrame: { parent: null } }
const call = async <T = unknown>(channel: string, ...args: unknown[]): Promise<{ ok: boolean; data: T; error?: string }> =>
  await handlers.get(channel)!(fakeEvent, ...args) as { ok: boolean; data: T; error?: string }

const features = (on: Record<string, boolean>) =>
  t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify(on))

beforeAll(async () => {
  t = createTestDb()
  // contacts.ts must bind to the database mock before database.ts pulls it in
  await import('../src/main/contacts')
  const { registerAppointmentHandlers } = await import('../src/main/ipc/ipc-appointments')
  registerAppointmentHandlers()
  cleanupTestDb(t)
})

let g: { gridId: number; rowIds: number[] }
let other: { gridId: number; rowIds: number[] }
const day = localDateFromToday(2)
beforeEach(() => {
  t = createTestDb()
  shown.length = 0
  g = seedGrid(t.db, { name: 'Clients', rowCount: 1, columnCount: 1 })
  other = seedGrid(t.db, { name: 'Staff', rowCount: 1, columnCount: 1 })
  t.db.prepare("UPDATE rows SET display_name = 'Jane Smith' WHERE id = ?").run(g.rowIds[0])
  const ins = t.db.prepare('INSERT INTO appointments (row_id, title, start_at) VALUES (?, ?, ?)')
  ins.run(g.rowIds[0], 'Home visit', `${day}T10:00`)
  ins.run(other.rowIds[0], 'Supervision', `${day}T11:00`)
  ins.run(null, 'Staff meeting', `${day}T09:00`)
})
afterEach(() => cleanupTestDb(t))

const titles = (rows: Appointment[]) => rows.map(a => a.title)
const range = { from: localDateFromToday(0), to: localDateFromToday(7) }

describe('appointments:list and events', () => {
  it('sends events and record appointments with the feature on', async () => {
    features({ appointments: true })
    expect(titles((await call<Appointment[]>(IPC.APPT_LIST, range)).data)).toEqual(['Staff meeting', 'Home visit', 'Supervision'])
  })

  it('sends only events with the Appointments feature off', async () => {
    features({ appointments: false })
    const res = await call<Appointment[]>(IPC.APPT_LIST, range)
    expect(res.ok).toBe(true)
    expect(titles(res.data)).toEqual(['Staff meeting'])
    expect(res.data[0]).toMatchObject({ row_id: null, record_name: null })
    // Asking for one list doesn't bring the record ones back
    expect(titles((await call<Appointment[]>(IPC.APPT_LIST, range, { gridId: g.gridId, withEvents: true })).data)).toEqual(['Staff meeting'])
  })

  it('with one list chosen, keeps events (they belong to no list) only when asked', async () => {
    features({ appointments: true })
    expect(titles((await call<Appointment[]>(IPC.APPT_LIST, range, { gridId: g.gridId, withEvents: true })).data)).toEqual(['Staff meeting', 'Home visit'])
    expect(titles((await call<Appointment[]>(IPC.APPT_LIST, range, { gridId: g.gridId })).data)).toEqual(['Home visit'])
  })

  it('creates, repeats and deletes an event with no record', async () => {
    features({ appointments: false })
    const made = await call<{ ids: number[] }>(IPC.APPT_CREATE, { row_id: null, title: 'Training', start_at: `${day}T13:00`, end_at: `${day}T14:00`, all_day: false, location: 'Room 2', notes: null }, { freq: 'weekly', interval: 1, count: 3 })
    expect(made.ok).toBe(true)
    expect(made.data.ids).toHaveLength(3)
    const later = (await call<Appointment[]>(IPC.APPT_LIST, { from: day, to: localDateFromToday(30) })).data.filter(a => a.title === 'Training')
    expect(later.map(a => a.start_at.slice(0, 10))).toEqual([day, localDateFromToday(9), localDateFromToday(16)])
    expect((await call(IPC.APPT_DELETE, later[0]!.id, 'all')).ok).toBe(true)
    expect((await call<Appointment[]>(IPC.APPT_LIST, { from: day, to: localDateFromToday(30) })).data.some(a => a.title === 'Training')).toBe(false)
  })
})

describe('reminders for events', () => {
  function soonWall(minutes: number): { now: Date; wall: string } {
    const now = new Date(); now.setSeconds(0, 0)
    const at = new Date(now.getTime() + minutes * 60_000)
    return { now, wall: `${localDateString(at)}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` }
  }

  it('remind with the Appointments feature off; record appointments don\'t', async () => {
    const { reminderTick, setReminderSettings, resetSentAppointments } = await import('../src/main/reminders')
    resetSentAppointments()
    features({ notifications: true, appointments: false })
    setReminderSettings({ apptLeadMinutes: 15, showNames: false })
    const { now, wall } = soonWall(10)
    const ins = t.db.prepare('INSERT INTO appointments (row_id, title, start_at) VALUES (?, ?, ?)')
    ins.run(null, 'Dentist', wall)
    ins.run(g.rowIds[0], 'Visit', wall.replace(/:(\d\d)$/, (_m, mm: string) => `:${mm === '59' ? '58' : String(Number(mm) + 1).padStart(2, '0')}`))
    const sent = reminderTick(now)
    expect(sent).toEqual([expect.stringMatching(/^Event at \d/)])
    // The title only with names on
    expect(sent[0]).not.toMatch(/Dentist/)
  })

  it('show the title with names on', async () => {
    const { apptReminderText } = await import('../src/main/reminders')
    expect(apptReminderText({ id: 1, start_at: '2026-10-02T15:00', all_day: 0, record_name: null, record_kind: null, event: true, title: 'Dentist' }, true)).toBe('Event at 3:00 pm: Dentist')
    expect(apptReminderText({ id: 1, start_at: '2026-10-02T15:00', all_day: 0, record_name: null, record_kind: null, event: true, title: 'Dentist' }, false)).toBe('Event at 3:00 pm')
  })

  it('are kept for while locked, apart from record appointments, and remind then', async () => {
    const { snapshotForLock, lockedReminders } = await import('../src/main/reminders')
    features({ notifications: true, appointments: false })
    // Times today and tomorrow are kept
    const tomorrow = localDateFromToday(1)
    t.db.prepare('UPDATE appointments SET start_at = ? WHERE row_id IS NULL').run(`${tomorrow}T09:00`)
    t.db.prepare('UPDATE appointments SET start_at = ? WHERE row_id IS NOT NULL').run(`${tomorrow}T10:00`)
    const s = snapshotForLock()!
    expect(s.apptTimes).toEqual([])
    expect(s.eventTimes).toEqual([`${tomorrow}T09:00`])
    const [y, m, d] = tomorrow.split('-').map(Number) as [number, number, number]
    const out = lockedReminders(new Date(y, m - 1, d, 8, 55), { ...s, lastDaily: tomorrow, settings: { ...s.settings, apptLeadMinutes: 10 } }, new Set())
    expect(out).toEqual([{ text: 'Event at 9:00 am', route: `/calendar?date=${tomorrow}` }])
    features({ notifications: true, appointments: true })
    expect(snapshotForLock()!.apptTimes).toEqual([`${tomorrow}T10:00`])
    expect(JSON.stringify(s)).not.toMatch(/Staff meeting/)
  })
})

describe('events in the calendar file', () => {
  it('go out with the Appointments feature off, as "Event" unless full names are on', async () => {
    const { loadIcsItems } = await import('../src/main/export-ics')
    features({ appointments: false })
    const items = loadIcsItems().filter(i => i.uid.startsWith('appointment-') && !i.cancelled)
    expect(items).toEqual([expect.objectContaining({ summary: 'Event', start: `${day}T09:00` })])
    expect(loadIcsItems({ fullNames: true }).filter(i => i.uid.startsWith('appointment-') && !i.cancelled).map(i => i.summary)).toEqual(['Staff meeting'])
    features({ appointments: true })
    const both = loadIcsItems().filter(i => i.uid.startsWith('appointment-') && !i.cancelled).map(i => i.summary)
    expect(both).toHaveLength(3)
    expect(both).toContain('Event')
    expect(both).toContain('Appointment with J.S.')
  })

  it('a cancelled event goes out as a cancelled event', async () => {
    const { loadIcsItems } = await import('../src/main/export-ics')
    features({ appointments: false })
    t.db.prepare("UPDATE appointments SET status = 'cancelled' WHERE row_id IS NULL").run()
    const items = loadIcsItems().filter(i => i.uid.startsWith('appointment-'))
    expect(items).toEqual([expect.objectContaining({ summary: 'Cancelled: Event', cancelled: true })])
  })
})
