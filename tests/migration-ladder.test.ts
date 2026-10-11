/**
 * The migration ladder: a database left at every schema version a released
 * Pulse could have written, with the kind of data people have, upgraded to
 * the newest version the way the app runs migrations (applyMigration, one
 * transaction each).
 *
 * For each starting version k (0 = a new install):
 * - the upgrade reaches the latest schema_version;
 * - everything seeded at k is still there, with the changes later migrations
 *   promise (renamed columns, backfilled names and note dates);
 * - a second open has nothing to run, and even re-running every migration
 *   changes nothing (a lost schema_version write must not damage data);
 * - every shipped migration that fails at its very end leaves the database
 *   exactly as it found it.
 *
 * Opening a database from a newer Pulse, and a migration failing inside the
 * real openDatabase(), are covered with the error the lock screen shows in
 * tests/database-open.test.ts and tests/ipc-auth.test.ts (AUDIT-003).
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createEmptyEncryptedDb, cleanupTestDb, LATEST_SCHEMA_VERSION, type TestDb } from './helpers'
import { MIGRATIONS, applyMigration, type Migration } from '../src/main/migration-list'

let t: TestDb | null = null
afterEach(() => { if (t) cleanupTestDb(t); t = null })

function freshDb(): Database {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  return t.db
}

const versionOf = (db: Database): number =>
  Number((db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined)?.value ?? 0)

/** What the app's runner would run on this database */
const pending = (db: Database): Migration[] => MIGRATIONS.filter(m => m.version > versionOf(db))

function upgrade(db: Database): void {
  for (const m of pending(db)) applyMigration(db, m)
}

function runTo(db: Database, k: number): void {
  for (const m of MIGRATIONS) if (m.version <= k) applyMigration(db, m)
}

const tableExists = (db: Database, name: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)

const columnsOf = (db: Database, table: string) =>
  db.prepare('SELECT name, "notnull" AS nn, dflt_value, pk FROM pragma_table_info(?)').all(table) as
    Array<{ name: string; nn: number; dflt_value: string | null; pk: number }>

/**
 * Insert the values whose columns exist in this version of the table (older
 * versions lack some, and a few were renamed). Throws if the version needs a
 * value the seed didn't give, so the seed stays valid for every version.
 */
function insert(db: Database, table: string, values: Record<string, unknown>): number | null {
  if (!tableExists(db, table)) return null
  const cols = columnsOf(db, table)
  const missing = cols.filter(c => c.nn && c.dflt_value === null && !c.pk && !(c.name in values))
  if (missing.length) throw new Error(`Seed for ${table} at v${versionOf(db)} lacks ${missing.map(c => c.name).join(', ')}`)
  const use = cols.filter(c => c.name in values).map(c => c.name)
  const sql = `INSERT INTO "${table}" (${use.map(c => `"${c}"`).join(', ')}) VALUES (${use.map(() => '?').join(', ')})`
  return Number(db.prepare(sql).run(...use.map(c => values[c])).lastInsertRowid)
}

const ATTACHMENT_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x00, 0x0a, 0x7f, 0x80])
const NOTE_CREATED = '2025-12-31 23:30:00'

interface Seeded {
  version: number
  gridId: number
  nameCol: number
  dueCol: number
  rowA: number
  rowB: number
  ruleId: number
  noteId: number
  stepId: number
  taskId: number
  tagId: number
  viewId: number
  providerId: number | null
  linkId: number | null
  condId: number | null
  recordLinkId: number | null
  appointmentId: number | null
  attachmentId: number | null
}

/** Data a person could have had at this version, through the tables that existed then */
function seed(db: Database): Seeded {
  const version = versionOf(db)
  return db.transaction((): Seeded => {
    const gridId = insert(db, 'grids', { name: 'Ladder List' })!
    const nameCol = insert(db, 'columns', { grid_id: gridId, name: 'Name', column_type: 'text', position: 0, is_name_column: 1 })!
    const dueCol = insert(db, 'columns', { grid_id: gridId, name: 'Review due', column_type: 'date', position: 1 })!
    const rowA = insert(db, 'rows', { grid_id: gridId, position: 0 })!
    const rowB = insert(db, 'rows', { grid_id: gridId, position: 1 })!
    for (const [row, name, due] of [[rowA, 'Ada', '2026-03-01'], [rowB, 'Grace', '2028-02-29']] as const) {
      insert(db, 'cells', { row_id: row, column_id: nameCol, value: name })
      insert(db, 'cells', { row_id: row, column_id: dueCol, value: due })
    }
    const ruleId = insert(db, 'alert_rules', { name: 'Ladder review', thresholds: '[]', cycle_days: 365, interval_days: 365 })!
    const noteId = insert(db, 'case_log', {
      row_id: rowA, content: '<p>Ladder note: “quotes”, 100% & ünïcödé</p>', log_type: 'note',
      created_at: NOTE_CREATED, updated_at: NOTE_CREATED, follow_up_date: '2026-01-05',
    })!
    const stepId = insert(db, 'checklist_items', { row_id: rowA, title: 'Ladder step', due_date: '2026-02-01', position: 0 })!
    insert(db, 'scrap_notes', { row_id: rowB, content: '<p>Ladder scratch</p>' })
    const tagId = insert(db, 'tags', { grid_id: gridId, name: 'Ladder tag' })!
    insert(db, 'row_tags', { row_id: rowB, tag_id: tagId })
    insert(db, 'snippets', { trigger_text: ';ladder', expansion: 'Ladder expansion' })
    insert(db, 'settings', { key: 'ladder_setting', value: 'kept' })
    const taskId = insert(db, 'caseload_tasks', { grid_id: gridId, title: 'Ladder task', due_date: '2026-05-01' })!
    const viewId = insert(db, 'saved_views', { grid_id: gridId, name: 'Ladder view', config: '{}' })!
    const providerId = insert(db, 'providers', { name: 'Ladder Clinic' })
    const linkId = providerId === null ? null : insert(db, 'provider_client_links', { provider_id: providerId, row_id: rowA, grid_id: gridId })
    const condId = insert(db, 'cond_format_rules', { name: 'Ladder format', column_type_hint: 'date', column_type: 'date', rule_json: '[]', rules: '[]' })
    let recordLinkId: number | null = null
    const typeId = insert(db, 'link_types', { from_grid_id: gridId, to_grid_id: gridId, label_forward: 'Refers', label_backward: 'Referred by' })
    if (typeId !== null) recordLinkId = insert(db, 'record_links', { link_type_id: typeId, from_row_id: rowA, to_row_id: rowB })
    const appointmentId = insert(db, 'appointments', { row_id: rowA, title: 'Ladder visit', start_at: '2026-03-08T09:30' })
    const attachmentId = insert(db, 'attachments', {
      row_id: rowB, file_name: 'ladder.pdf', mime_type: 'application/pdf', size_bytes: ATTACHMENT_BYTES.length, sha256: 'ab'.repeat(32),
    })
    if (attachmentId !== null) insert(db, 'attachment_blobs', { attachment_id: attachmentId, data: ATTACHMENT_BYTES })
    return { version, gridId, nameCol, dueCol, rowA, rowB, ruleId, noteId, stepId, taskId, tagId, viewId, providerId, linkId, condId, recordLinkId, appointmentId, attachmentId }
  })()
}

const get = <T,>(db: Database, sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as T | undefined

function expectSeedKept(db: Database, s: Seeded): void {
  expect(get(db, 'SELECT name FROM grids WHERE id = ?', s.gridId)).toEqual({ name: 'Ladder List' })
  expect(db.prepare('SELECT id, name FROM columns WHERE grid_id = ? ORDER BY position').all(s.gridId))
    .toEqual([{ id: s.nameCol, name: 'Name' }, { id: s.dueCol, name: 'Review due' }])
  expect(db.prepare('SELECT row_id, column_id, value FROM cells WHERE row_id IN (?, ?) ORDER BY row_id, column_id').all(s.rowA, s.rowB)).toEqual([
    { row_id: s.rowA, column_id: s.nameCol, value: 'Ada' },
    { row_id: s.rowA, column_id: s.dueCol, value: '2026-03-01' },
    { row_id: s.rowB, column_id: s.nameCol, value: 'Grace' },
    { row_id: s.rowB, column_id: s.dueCol, value: '2028-02-29' },
  ])
  // Names are kept on the record for search and sorting (017, 024)
  expect(db.prepare('SELECT id, display_name, deleted_at FROM rows WHERE grid_id = ? ORDER BY position').all(s.gridId))
    .toEqual([{ id: s.rowA, display_name: 'Ada', deleted_at: null }, { id: s.rowB, display_name: 'Grace', deleted_at: null }])
  // cycle_days became interval_days (003); every older rule is an interval rule (038)
  expect(get(db, 'SELECT name, interval_days, kind, business_days FROM alert_rules WHERE id = ?', s.ruleId))
    .toEqual({ name: 'Ladder review', interval_days: 365, kind: 'interval', business_days: 0 })
  // Notes from before 044 happened when they were written
  expect(get(db, 'SELECT row_id, content, created_at, occurred_at, follow_up_date, voided_at FROM case_log WHERE id = ?', s.noteId)).toEqual({
    row_id: s.rowA, content: '<p>Ladder note: “quotes”, 100% & ünïcödé</p>', created_at: NOTE_CREATED,
    occurred_at: NOTE_CREATED, follow_up_date: '2026-01-05', voided_at: null,
  })
  expect(get(db, 'SELECT row_id, title, due_date, is_completed FROM checklist_items WHERE id = ?', s.stepId))
    .toEqual({ row_id: s.rowA, title: 'Ladder step', due_date: '2026-02-01', is_completed: 0 })
  expect(get(db, 'SELECT content FROM scrap_notes WHERE row_id = ?', s.rowB)).toEqual({ content: '<p>Ladder scratch</p>' })
  expect(get(db, 'SELECT tag_id FROM row_tags WHERE row_id = ?', s.rowB)).toEqual({ tag_id: s.tagId })
  expect(get(db, "SELECT expansion FROM snippets WHERE trigger_text = ';ladder'")).toEqual({ expansion: 'Ladder expansion' })
  expect(get(db, "SELECT value FROM settings WHERE key = 'ladder_setting'")).toEqual({ value: 'kept' })
  expect(get(db, 'SELECT grid_id, title, due_date FROM caseload_tasks WHERE id = ?', s.taskId))
    .toEqual({ grid_id: s.gridId, title: 'Ladder task', due_date: '2026-05-01' })
  expect(get(db, 'SELECT name FROM saved_views WHERE id = ?', s.viewId)).toEqual({ name: 'Ladder view' })
  if (s.providerId !== null) {
    expect(get(db, 'SELECT name FROM providers WHERE id = ?', s.providerId)).toEqual({ name: 'Ladder Clinic' })
    expect(get(db, 'SELECT provider_id, row_id, grid_id FROM provider_client_links WHERE id = ?', s.linkId))
      .toEqual({ provider_id: s.providerId, row_id: s.rowA, grid_id: s.gridId })
  }
  // The old column_type_hint / rule_json pair moved to column_type / rules (014)
  if (s.condId !== null) {
    expect(get(db, 'SELECT name, column_type, rules FROM cond_format_rules WHERE id = ?', s.condId))
      .toEqual({ name: 'Ladder format', column_type: 'date', rules: '[]' })
  }
  if (s.recordLinkId !== null) {
    expect(get(db, 'SELECT from_row_id, to_row_id FROM record_links WHERE id = ?', s.recordLinkId)).toEqual({ from_row_id: s.rowA, to_row_id: s.rowB })
  }
  if (s.appointmentId !== null) {
    expect(get(db, 'SELECT row_id, title, start_at, status FROM appointments WHERE id = ?', s.appointmentId))
      .toEqual({ row_id: s.rowA, title: 'Ladder visit', start_at: '2026-03-08T09:30', status: 'scheduled' })
  }
  if (s.attachmentId !== null) {
    expect(get(db, 'SELECT row_id, file_name, size_bytes FROM attachments WHERE id = ?', s.attachmentId))
      .toEqual({ row_id: s.rowB, file_name: 'ladder.pdf', size_bytes: ATTACHMENT_BYTES.length })
    const blob = get<{ data: Buffer }>(db, 'SELECT data FROM attachment_blobs WHERE attachment_id = ?', s.attachmentId)
    expect(Buffer.compare(blob!.data, ATTACHMENT_BYTES)).toBe(0)
  }
}

/** Every table's definition and every row, to tell whether anything changed */
function dump(db: Database): string {
  const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Array<{ type: string; name: string; sql: string | null }>
  const data = objects.filter(o => o.type === 'table').map(o => {
    const rows = db.prepare(`SELECT * FROM "${o.name}" ORDER BY 1`).all() as Array<Record<string, unknown>>
    return [o.name, rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString('hex') : v])))]
  })
  return JSON.stringify({ objects, data })
}

function expectHealthy(db: Database): void {
  expect(db.pragma('foreign_key_check')).toEqual([])
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
}

const STARTING_VERSIONS = MIGRATIONS.map(m => m.version).filter(v => v < LATEST_SCHEMA_VERSION)

describe('migration ladder', () => {
  it('covers every released version, contiguously', () => {
    expect(STARTING_VERSIONS).toEqual(Array.from({ length: LATEST_SCHEMA_VERSION - 1 }, (_, i) => i + 1))
  })

  it('a new install reaches the latest version, and the next open has nothing to run', () => {
    const db = freshDb()
    upgrade(db)
    expect(versionOf(db)).toBe(LATEST_SCHEMA_VERSION)
    expectHealthy(db)
    expect(pending(db)).toEqual([])
    const s = seed(db)
    expectSeedKept(db, s)
  })

  it.each(STARTING_VERSIONS)('from v%i: upgrades to the latest, keeps the data, and a second run changes nothing', k => {
    const db = freshDb()
    runTo(db, k)
    expect(versionOf(db)).toBe(k)
    const s = seed(db)

    upgrade(db)
    expect(versionOf(db)).toBe(LATEST_SCHEMA_VERSION)
    expectSeedKept(db, s)
    expectHealthy(db)

    // The next launch runs nothing...
    expect(pending(db)).toEqual([])
    const before = dump(db)
    upgrade(db)
    expect(dump(db)).toBe(before)
    // ...and if the version write had been lost, running every migration again is harmless.
    // One known difference (D-005): 036 freezes the human-services words and features on
    // any database that has lists, so lists made after 036 on a new install get them too
    for (const m of MIGRATIONS) applyMigration(db, m)
    expect(versionOf(db)).toBe(LATEST_SCHEMA_VERSION)
    if (k >= 36) db.prepare("DELETE FROM settings WHERE key IN ('workspace_vocab', 'workspace_features')").run()
    expect(dump(db)).toBe(before)
  })
})

describe('a migration that fails partway', () => {
  // VACUUM can't run in a transaction, so 016 can't be rolled back; it only adds indexes and compacts
  const TRANSACTIONAL = MIGRATIONS.filter(m => !m.noTransaction)

  it('016 is the only migration that runs outside a transaction', () => {
    expect(MIGRATIONS.filter(m => m.noTransaction).map(m => m.version)).toEqual([16])
  })

  it.each(TRANSACTIONAL.map(m => [m.version, m] as const))('v%i: failing after all its work leaves the database exactly as before', (_v, m) => {
    const db = freshDb()
    runTo(db, m.version - 1)
    seed(db)
    const before = dump(db)
    const failing: Migration = { ...m, up: d => { m.up(d); throw new Error('simulated failure at the end') } }
    expect(() => applyMigration(db, failing)).toThrow('simulated failure at the end')
    expect(versionOf(db)).toBe(m.version - 1)
    expect(dump(db)).toBe(before)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    // The real migration still runs afterwards (a fixed Pulse, or a retry)
    upgrade(db)
    expect(versionOf(db)).toBe(LATEST_SCHEMA_VERSION)
    expectHealthy(db)
  })
})
