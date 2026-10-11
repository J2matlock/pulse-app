/**
 * Seed generator for tests that need a realistic workspace: N records × M
 * custom columns in one list, with every kind of data a read path might trip
 * over — deadlines in each state, archived and trashed records, records
 * linked to a second list, notes, tasks, appointments and attachments.
 *
 * Deterministic: the same options give the same data (a seeded PRNG, and
 * every date counted from `today`, which callers can pin). Trashed and
 * archived records carry the same kinds of child data as active ones, so a
 * soft-delete leak shows up in any read path that forgets the filter.
 *
 * Writes straight to the tables in one transaction, so 5,000 × 40 seeds in
 * seconds; it doesn't go through IPC handlers and never needs electron.
 */
import { createHash } from 'crypto'
import type { Database } from 'better-sqlite3'
import { localDateString } from '../src/shared/dates'
import { addDays } from '../src/shared/ymd'

export interface SeedOptions {
  /** Records in the main list (N). Default 50. */
  records?: number
  /** Custom columns besides the name and deadline columns (M). Default 10. */
  customColumns?: number
  /** "Today" as YYYY-MM-DD; deadlines and dates count from it. Default: the local date now. */
  today?: string
  /** PRNG seed. Default 1. */
  seed?: number
  /** Every k-th record (1-based) is trashed. 0 = none. Default 10. */
  trashEvery?: number
  /** Every k-th record (1-based) is archived, unless it's trashed. 0 = none. Default 7. */
  archiveEvery?: number
  /** Records in the second (linked) list. Default max(2, ceil(N / 5)). */
  linkedRecords?: number
  /** Notes per record. Default 2. */
  notesPerRecord?: number
  /** List-level tasks. Default 12. */
  tasks?: number
  /** Appointments per record. Default 1. */
  appointmentsPerRecord?: number
  /** Every k-th record (1-based) gets attachments. 0 = none. Default 5. */
  attachmentEvery?: number
}

export interface SeedResult {
  today: string
  gridId: number
  linkedGridId: number
  ruleId: number
  nameColumnId: number
  deadlineColumnId: number
  /** The M custom columns, in position order */
  customColumnIds: number[]
  /** Every record in the main list, in position order */
  rowIds: number[]
  activeRowIds: number[]
  archivedRowIds: number[]
  trashedRowIds: number[]
  linkedRowIds: number[]
  linkTypeId: number
  /** Main-list record → the record it links to in the linked list */
  links: Array<{ fromRowId: number; toRowId: number }>
  /** Intended days until the deadline per main-list record; null = no date entered */
  deadlineDays: Map<number, number | null>
  noteIds: number[]
  taskIds: number[]
  appointmentIds: number[]
  attachmentIds: number[]
  /** Attachment id → the exact bytes stored, for round-trip checks */
  attachmentBytes: Map<number, Buffer>
}

/** The rule every deadline column uses: due 30 days after the date entered. */
export const SEED_INTERVAL_DAYS = 30

/**
 * Days until due, cycled across records: no date, plenty of time, each
 * warning band (green 30, yellow 14, orange 7, red 3), due today, and overdue.
 */
export const DEADLINE_MIX: ReadonlyArray<number | null> = [null, 25, 12, 6, 2, 0, -1, -45]

export const SEED_THRESHOLDS = [
  { daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' },
  { daysBefore: 14, bgClass: 'alert-yellow', label: 'Approaching' },
  { daysBefore: 7, bgClass: 'alert-orange', label: 'Due soon' },
  { daysBefore: 3, bgClass: 'alert-red', label: 'Urgent' },
  { daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' },
]

const CUSTOM_TYPES = ['text', 'number', 'date', 'dropdown', 'checkbox', 'phone', 'email', 'currency'] as const
const DROPDOWN_OPTIONS = ['Open', 'Waiting', 'Closed']

const FIRST = ['Ada', 'Ben', 'Chloé', 'Dmitri', 'Eun-ji', 'Farah', 'Grzegorz', 'Hana', 'Ignacio', 'José', 'Kofi', 'Łucja', 'Mateo', 'Nnamdi', 'Ömer', 'Priya']
const LAST = ['Park', 'Ortiz', 'Dubois', 'Иванов', '李', "O'Brien", 'Nguyen', 'Şahin', 'Müller', 'Peña', 'Smith', 'García']
/** Text values that have broken spreadsheets, LIKE searches and CSV exports before */
const TRICKY_TEXT = ['=SUM(A1:A9)', '50% done_ok', '+1 call back', 'Line one\nline two', 'Comma, "quoted"', '@mention', '-3 days', '']

/** mulberry32: tiny, fast, good enough for test data, and deterministic */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]
}

function customValue(type: (typeof CUSTOM_TYPES)[number], i: number, rand: () => number, today: string): string | null {
  if (rand() < 0.1) return null  // some blanks in every column
  switch (type) {
    case 'text': return TRICKY_TEXT[i % TRICKY_TEXT.length] || `Note ${i}`
    case 'number': return String(Math.floor(rand() * 1000) - 100)
    case 'date': return addDays(today, Math.floor(rand() * 400) - 200)
    case 'dropdown': return pick(rand, DROPDOWN_OPTIONS)
    case 'checkbox': return rand() < 0.5 ? 'true' : 'false'
    case 'phone': return `555-01${String(i % 100).padStart(2, '0')}`
    case 'email': return `person${i}@example.org`
    case 'currency': return (rand() * 5000).toFixed(2)
  }
}

/** A SQLite-style UTC timestamp ('YYYY-MM-DD HH:MM:SS') on a given calendar date */
function stamp(ymd: string, hour = 15): string {
  return `${ymd} ${String(hour).padStart(2, '0')}:00:00`
}

/**
 * Seed a full workspace into a migrated test database (see createTestDb).
 * Record kinds cycle by position: every `trashEvery`-th is trashed, every
 * `archiveEvery`-th (not trashed) is archived, the rest are active.
 */
export function seedWorkspace(db: Database, opts: SeedOptions = {}): SeedResult {
  const n = opts.records ?? 50
  const m = opts.customColumns ?? 10
  const today = opts.today ?? localDateString()
  const rand = prng(opts.seed ?? 1)
  const trashEvery = opts.trashEvery ?? 10
  const archiveEvery = opts.archiveEvery ?? 7
  const linkedN = opts.linkedRecords ?? Math.max(2, Math.ceil(n / 5))
  const notesPer = opts.notesPerRecord ?? 2
  const taskCount = opts.tasks ?? 12
  const apptsPer = opts.appointmentsPerRecord ?? 1
  const attachEvery = opts.attachmentEvery ?? 5

  const run = db.transaction((): SeedResult => {
    const insGrid = db.prepare("INSERT INTO grids (name, position, record_kind) VALUES (?, ?, ?)")
    const insCol = db.prepare('INSERT INTO columns (grid_id, name, column_type, position, is_name_column, config) VALUES (?, ?, ?, ?, ?, ?)')
    const insRow = db.prepare('INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, ?, ?)')
    const insCell = db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')

    const ruleId = Number(db.prepare(
      'INSERT INTO alert_rules (name, description, interval_days, thresholds, is_system) VALUES (?, ?, ?, ?, 0)'
    ).run('Seed: every 30 days', 'Seeded test rule', SEED_INTERVAL_DAYS, JSON.stringify(SEED_THRESHOLDS)).lastInsertRowid)

    // ── Main list ───────────────────────────────────────────────────────────
    const gridId = Number(insGrid.run('Seed List', 0, 'person').lastInsertRowid)
    const nameColumnId = Number(insCol.run(gridId, 'Name', 'text', 0, 1, '{}').lastInsertRowid)
    const deadlineColumnId = Number(insCol.run(gridId, 'Last review', 'date', 1, 0, JSON.stringify({ alert_rule_id: ruleId })).lastInsertRowid)
    const customColumnIds: number[] = []
    const customTypes: Array<(typeof CUSTOM_TYPES)[number]> = []
    for (let c = 0; c < m; c++) {
      const type = CUSTOM_TYPES[c % CUSTOM_TYPES.length]
      const config = type === 'dropdown' ? JSON.stringify({ options: DROPDOWN_OPTIONS }) : '{}'
      customColumnIds.push(Number(insCol.run(gridId, `Field ${c + 1} (${type})`, type, c + 2, 0, config).lastInsertRowid))
      customTypes.push(type)
    }

    const rowIds: number[] = []
    const activeRowIds: number[] = []
    const archivedRowIds: number[] = []
    const trashedRowIds: number[] = []
    const deadlineDays = new Map<number, number | null>()
    for (let i = 0; i < n; i++) {
      const created = stamp(addDays(today, -(i % 365) - 1))
      const rowId = Number(insRow.run(gridId, i, created, created).lastInsertRowid)
      rowIds.push(rowId)
      insCell.run(rowId, nameColumnId, `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]} ${i + 1}`)
      const days = DEADLINE_MIX[i % DEADLINE_MIX.length]
      deadlineDays.set(rowId, days)
      if (days !== null) insCell.run(rowId, deadlineColumnId, addDays(today, days - SEED_INTERVAL_DAYS))
      for (let c = 0; c < m; c++) {
        const v = customValue(customTypes[c], i + c, rand, today)
        if (v !== null) insCell.run(rowId, customColumnIds[c], v)
      }
    }

    const trash = db.prepare('UPDATE rows SET is_active = 0, deleted_at = ? WHERE id = ?')
    const archive = db.prepare("UPDATE rows SET is_active = 0, archived_at = ?, archived_reason = 'Seeded archive' WHERE id = ?")
    rowIds.forEach((rowId, i) => {
      const k = i + 1
      if (trashEvery > 0 && k % trashEvery === 0) {
        trash.run(stamp(addDays(today, -1)), rowId)
        trashedRowIds.push(rowId)
      } else if (archiveEvery > 0 && k % archiveEvery === 0) {
        archive.run(stamp(addDays(today, -2)), rowId)
        archivedRowIds.push(rowId)
      } else {
        activeRowIds.push(rowId)
      }
    })

    // ── Linked list and links ───────────────────────────────────────────────
    const linkedGridId = Number(insGrid.run('Seed Households', 1, 'thing').lastInsertRowid)
    const linkedNameCol = Number(insCol.run(linkedGridId, 'Household', 'text', 0, 1, '{}').lastInsertRowid)
    const linkedRowIds: number[] = []
    for (let j = 0; j < linkedN; j++) {
      const rowId = Number(insRow.run(linkedGridId, j, stamp(today), stamp(today)).lastInsertRowid)
      insCell.run(rowId, linkedNameCol, `Household ${j + 1}`)
      linkedRowIds.push(rowId)
    }
    const linkTypeId = Number(db.prepare(
      "INSERT INTO link_types (from_grid_id, to_grid_id, label_forward, label_backward, cardinality) VALUES (?, ?, 'Household', 'Members', 'many_to_one')"
    ).run(gridId, linkedGridId).lastInsertRowid)
    const insLink = db.prepare('INSERT INTO record_links (link_type_id, from_row_id, to_row_id) VALUES (?, ?, ?)')
    const insLinkHist = db.prepare("INSERT INTO record_link_history (link_type_id, from_row_id, to_row_id, action) VALUES (?, ?, ?, 'add')")
    const links: Array<{ fromRowId: number; toRowId: number }> = []
    rowIds.forEach((fromRowId, i) => {
      if (i % 2 === 0) return  // every other record has a household, trashed ones (every 10th) included
      const toRowId = linkedRowIds[Math.floor(i / 2) % linkedRowIds.length]
      insLink.run(linkTypeId, fromRowId, toRowId)
      insLinkHist.run(linkTypeId, fromRowId, toRowId)
      links.push({ fromRowId, toRowId })
    })

    // ── Notes ───────────────────────────────────────────────────────────────
    const insNote = db.prepare(
      'INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, occurred_at, follow_up_date, follow_up_completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const logTypes = ['note', 'visit', 'phone']
    const noteIds: number[] = []
    const firstNoteOf = new Map<number, number>()
    rowIds.forEach((rowId, i) => {
      for (let k = 0; k < notesPer; k++) {
        const when = stamp(addDays(today, -(k * 9 + (i % 5))))
        // Some open follow-ups: one overdue, one ahead
        const followUp = k === 0 && i % 3 === 0 ? addDays(today, i % 2 === 0 ? -2 : 4) : null
        const id = Number(insNote.run(rowId, `Seed note ${k + 1} for record ${i + 1}`, logTypes[(i + k) % logTypes.length], when, when, when, followUp, 0).lastInsertRowid)
        noteIds.push(id)
        if (k === 0) firstNoteOf.set(rowId, id)
      }
    })

    // ── Tasks ───────────────────────────────────────────────────────────────
    const insTask = db.prepare(
      'INSERT INTO caseload_tasks (grid_id, title, due_date, recurrence_rule, is_completed, completed_at, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const taskIds: number[] = []
    for (let t = 0; t < taskCount; t++) {
      const done = t % 4 === 3
      const due = t % 6 === 5 ? null : addDays(today, (t % 5) * 3 - 6)
      const recur = t % 5 === 0 ? JSON.stringify({ type: t % 10 === 0 ? 'monthly' : 'weekly', interval: 1 }) : null
      taskIds.push(Number(insTask.run(gridId, `Seed task ${t + 1}`, due, recur, done ? 1 : 0, done ? stamp(addDays(today, -1)) : null, t).lastInsertRowid))
    }

    // ── Appointments ────────────────────────────────────────────────────────
    const insAppt = db.prepare(
      'INSERT INTO appointments (row_id, title, start_at, end_at, all_day, status, case_log_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const statuses = ['scheduled', 'done', 'cancelled', 'no_show'] as const
    const appointmentIds: number[] = []
    rowIds.forEach((rowId, i) => {
      for (let k = 0; k < apptsPer; k++) {
        const offset = ((i + k) % 9) - 4  // four days back to four ahead
        const date = addDays(today, offset)
        const allDay = (i + k) % 7 === 6
        const status = offset >= 0 ? 'scheduled' : statuses[(i + k) % statuses.length]
        const start = allDay ? date : `${date}T${String(9 + (i % 8)).padStart(2, '0')}:30`
        const end = allDay ? null : `${date}T${String(10 + (i % 8)).padStart(2, '0')}:00`
        const noteId = status === 'done' ? firstNoteOf.get(rowId) ?? null : null
        appointmentIds.push(Number(insAppt.run(rowId, `Seed visit ${i + 1}`, start, end, allDay ? 1 : 0, status, noteId).lastInsertRowid))
      }
    })
    // One appointment that isn't for any record
    appointmentIds.push(Number(insAppt.run(null, 'Team meeting', `${addDays(today, 1)}T13:00`, `${addDays(today, 1)}T14:00`, 0, 'scheduled', null).lastInsertRowid))

    // ── Attachments ─────────────────────────────────────────────────────────
    const insAtt = db.prepare(
      'INSERT INTO attachments (row_id, case_log_id, file_name, mime_type, size_bytes, sha256, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const insBlob = db.prepare('INSERT INTO attachment_blobs (attachment_id, data) VALUES (?, ?)')
    const attachmentIds: number[] = []
    const attachmentBytes = new Map<number, Buffer>()
    const addAttachment = (rowId: number, noteId: number | null, fileName: string, mime: string, data: Buffer) => {
      const sha = createHash('sha256').update(data).digest('hex')
      const id = Number(insAtt.run(rowId, noteId, fileName, mime, data.length, sha, null).lastInsertRowid)
      insBlob.run(id, data)
      attachmentIds.push(id)
      attachmentBytes.set(id, data)
    }
    if (attachEvery > 0) {
      rowIds.forEach((rowId, i) => {
        if ((i + 1) % attachEvery !== 0) return
        addAttachment(rowId, null, `consent-${i + 1}.txt`, 'text/plain', Buffer.from(`Consent form for record ${i + 1}\n`, 'utf8'))
        // Binary bytes including 0x00, attached to a note
        const bytes = Buffer.from(Array.from({ length: 64 }, (_, b) => (b * 7 + i) % 256))
        addAttachment(rowId, firstNoteOf.get(rowId) ?? null, `scan-${i + 1}.png`, 'image/png', bytes)
      })
    }

    return {
      today, gridId, linkedGridId, ruleId, nameColumnId, deadlineColumnId, customColumnIds,
      rowIds, activeRowIds, archivedRowIds, trashedRowIds, linkedRowIds, linkTypeId, links,
      deadlineDays, noteIds, taskIds, appointmentIds, attachmentIds, attachmentBytes,
    }
  })

  return run()
}
