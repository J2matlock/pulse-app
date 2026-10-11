/** Forms (W08 commit 1): migration 041, saving, submitting (create/update), required answers, notes, undo. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, createEmptyEncryptedDb, allMigrations, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({
  getDb: () => t.db,
  cachedStmt: (_k: string, sql: string) => t.db.prepare(sql),
  upsertCell: (rowId: number, columnId: number, value: string | null) => t.db.prepare(`INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)
    ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value`).run(rowId, columnId, value),
}))

import { saveForm, listForms, deleteForm, submitForm, undoFormSubmit, redoFormSubmit, FormError } from '../src/main/forms'
import { localDateString } from '../src/shared/dates'
import { saveLinkType } from '../src/main/links'
import { up as migration041 } from '../src/main/migrations/041_forms'
import { buildFormPdf, FormPrintError } from '../src/main/export-forms'

let g: { gridId: number; rowIds: number[]; columnIds: number[] }
let nameC: number, phone: number, dob: number, agree: number, auto: number
const cell = (rowId: number, col: number) => (t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, col) as { value: string | null } | undefined)?.value ?? null
const rowsOf = () => (t.db.prepare('SELECT id FROM rows WHERE grid_id = ? ORDER BY id').all(g.gridId) as Array<{ id: number }>).map(r => r.id)
const intake = () => saveForm({
  grid_id: g.gridId, name: 'Intake', intro: 'Welcome', log_activity_type: 'note',
  fields: [
    { kind: 'section', title: 'About you' },
    { kind: 'column', columnId: nameC, required: true },
    { kind: 'column', columnId: phone, label: 'Best phone', width: 'half' },
    { kind: 'column', columnId: dob },
    { kind: 'note', label: 'What brings you in?', required: true },
  ],
})

beforeEach(() => {
  t = createTestDb()
  g = seedGrid(t.db, { name: 'Clients', rowCount: 1, columnCount: 5 })
  ;[nameC, phone, dob, agree, auto] = g.columnIds as [number, number, number, number, number]
  t.db.prepare("UPDATE columns SET name = 'Name' WHERE id = ?").run(nameC)
  t.db.prepare("UPDATE columns SET name = 'Phone', column_type = 'phone' WHERE id = ?").run(phone)
  t.db.prepare("UPDATE columns SET name = 'Birth date', column_type = 'date' WHERE id = ?").run(dob)
  t.db.prepare("UPDATE columns SET name = 'Agrees', column_type = 'checkbox' WHERE id = ?").run(agree)
  t.db.prepare("UPDATE columns SET name = 'Number', column_type = 'auto_number', config = '{\"prefix\":\"C-\",\"pad\":3,\"next\":1}' WHERE id = ?").run(auto)
})
afterEach(() => cleanupTestDb(t))

describe('migration 041', () => {
  it('adds the forms table and is safe to run twice', () => {
    const e = createEmptyEncryptedDb()
    e.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) if (m.version <= 40) m.up(e.db)
    migration041(e.db)
    expect(() => migration041(e.db)).not.toThrow()
    expect((e.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('41')
    cleanupTestDb(e)
  })
})

describe('saving forms', () => {
  it('saves and lists them, and checks the fields', () => {
    const f = intake()
    expect(listForms(g.gridId)).toEqual([expect.objectContaining({ id: f.id, name: 'Intake', intro: 'Welcome', position: 0 })])
    const base = { grid_id: g.gridId, name: 'Bad' }
    expect(() => saveForm({ ...base, fields: [{ kind: 'column', columnId: phone }, { kind: 'column', columnId: phone }] })).toThrow(/twice/)
    expect(() => saveForm({ ...base, fields: [{ kind: 'column', columnId: auto }] })).toThrow(/filled in by Pulse/)
    expect(() => saveForm({ ...base, fields: [{ kind: 'column', columnId: 99999 }] })).toThrow(/no longer exists/)
    expect(() => saveForm({ ...base, fields: [{ kind: 'section', title: 'Only a heading' }] })).toThrow(/at least one question/)
    expect(() => saveForm({ ...base, fields: Array.from({ length: 81 }, () => ({ kind: 'note' as const, label: 'Q' })) })).toThrow(FormError)
    expect(() => saveForm({ ...base, log_activity_type: 'nope', fields: [{ kind: 'note', label: 'Q' }] })).toThrow(/kind of note/)
  })

  it('keep their fields when a column is renamed, and drop one whose column is deleted', () => {
    const f = intake()
    t.db.prepare("UPDATE columns SET name = 'Mobile' WHERE id = ?").run(phone)
    expect(listForms(g.gridId)[0]!.fields).toHaveLength(5)
    t.db.prepare('DELETE FROM columns WHERE id = ?').run(phone)
    expect(listForms(g.gridId)[0]).toMatchObject({ id: f.id, dropped: 1 })
    expect(listForms(g.gridId)[0]!.fields).toHaveLength(4)
    deleteForm(f.id)
    expect(listForms(g.gridId)).toEqual([])
  })
})

describe('submitting a form', () => {
  it('adds a record with numbers and a note of the answers; undo moves it to the Trash', () => {
    const f = intake()
    expect(() => submitForm(f.id, null, { [nameC]: 'Ada' }, {})).toThrow('Please fill in: What brings you in?.')
    expect(() => submitForm(f.id, null, { [nameC]: '  ' }, { 4: 'x' })).toThrow(/Please fill in: Name/)
    expect(() => submitForm(f.id, null, { [nameC]: 'Ada', [dob]: 'March 3' }, { 4: 'x' })).toThrow(/needs a date/)
    const change = submitForm(f.id, null, { [nameC]: 'Ada Park', [phone]: '555-0100', [dob]: '1990-03-03' }, { 4: 'Housing help' })
    expect(change).toMatchObject({ created: true, previous: {} })
    expect(cell(change.rowId, nameC)).toBe('Ada Park')
    expect(cell(change.rowId, auto)).toBe('C-001')
    expect(t.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(change.rowId)).toEqual({ display_name: 'Ada Park' })
    expect(t.db.prepare('SELECT content, log_type, source_action_id FROM case_log WHERE id = ?').get(change.noteId)).toEqual({ content: 'Intake\nWhat brings you in?: Housing help', log_type: 'note', source_action_id: `form:${f.id}` })
    undoFormSubmit(change)
    // To the Trash, not deleted: anything added to it since is kept (L-23)
    expect(t.db.prepare('SELECT is_active, deleted_at IS NOT NULL AS trashed FROM rows WHERE id = ?').get(change.rowId)).toEqual({ is_active: 0, trashed: 1 })
    expect(rowsOf()).toEqual([g.rowIds[0], change.rowId])
    // Redo brings that same record back, with its note
    expect(redoFormSubmit(change)).toBe(true)
    expect(t.db.prepare('SELECT is_active, deleted_at FROM rows WHERE id = ?').get(change.rowId)).toEqual({ is_active: 1, deleted_at: null })
    expect(t.db.prepare('SELECT voided_at FROM case_log WHERE id = ?').get(change.noteId)).toEqual({ voided_at: null })
  })

  it('redo submits again when the record is gone from the Trash', () => {
    const change = submitForm(intake().id, null, { [nameC]: 'Ada' }, { 4: 'x' })
    undoFormSubmit(change)
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(change.rowId)
    expect(redoFormSubmit(change)).toBe(false)
  })

  it('undo puts back the dates the form\'s note moved (L-23)', () => {
    const r = g.rowIds[0]!
    const lastSeen = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Last seen', 'date', 9, ?)").run(g.gridId, JSON.stringify({ note_updates: ['note'] })).lastInsertRowid)
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(r, lastSeen, '2026-01-05')
    const change = submitForm(intake().id, r, { [nameC]: 'Bo' }, { 4: 'Visit' })
    expect(cell(r, lastSeen)).toBe(localDateString())
    undoFormSubmit(change)
    expect(cell(r, lastSeen)).toBe('2026-01-05')
  })

  it('updates only what changed, keeping history, and undo puts it back', () => {
    const f = intake()
    const r = g.rowIds[0]!
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?), (?, ?, ?)').run(r, nameC, 'Bo', r, phone, '555-0000')
    const change = submitForm(f.id, r, { [nameC]: 'Bo', [phone]: '555-1111', [dob]: '' }, { 4: 'Follow-up' })
    expect(change.previous).toEqual({ [phone]: '555-0000' })
    expect(cell(r, phone)).toBe('555-1111')
    expect(t.db.prepare('SELECT content FROM case_log WHERE id = ?').get(change.noteId)).toEqual({ content: 'Intake\nWhat brings you in?: Follow-up\nPhone: 555-1111' })
    expect(t.db.prepare('SELECT old_value, new_value FROM cell_history WHERE row_id = ? AND column_id = ?').all(r, phone)).toEqual([{ old_value: '555-0000', new_value: '555-1111' }])
    undoFormSubmit(change)
    expect(cell(r, phone)).toBe('555-0000')
    expect(t.db.prepare('SELECT voided_at IS NOT NULL AS v FROM case_log WHERE id = ?').get(change.noteId)).toEqual({ v: 1 })
    // An existing value counts toward a required field left out of the answers
    expect(submitForm(f.id, r, {}, { 4: 'x' }).previous).toEqual({})
  })

  it('a required checkbox must be ticked; link fields set links', () => {
    const other = seedGrid(t.db, { name: 'Staff', rowCount: 2, columnCount: 1 })
    const lt = saveLinkType({ from_grid_id: g.gridId, to_grid_id: other.gridId, label_forward: 'Worker', label_backward: 'Clients', cardinality: 'many_to_one' })
    const linkCol = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Worker', 'link', 9, ?)").run(g.gridId, JSON.stringify({ link_type_id: lt.id, direction: 'forward' })).lastInsertRowid)
    const f = saveForm({ grid_id: g.gridId, name: 'Consent', fields: [{ kind: 'column', columnId: agree, required: true }, { kind: 'column', columnId: linkCol }] })
    expect(() => submitForm(f.id, g.rowIds[0]!, { [agree]: 'false' })).toThrow(/Agrees/)
    const change = submitForm(f.id, g.rowIds[0]!, { [agree]: 'true', [linkCol]: [other.rowIds[1]!] })
    expect(t.db.prepare('SELECT to_row_id FROM record_links WHERE from_row_id = ?').all(g.rowIds[0])).toEqual([{ to_row_id: other.rowIds[1] }])
    expect(change.previousLinks).toEqual({ [linkCol]: [] })
    undoFormSubmit(change)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM record_links').get()).toEqual({ n: 0 })
  })
})

describe('printing forms', () => {
  it('a blank has the title, intro, labels and date boxes; a long form runs onto more pages', () => {
    const f = intake()
    const { pdf, name } = buildFormPdf(f.id, null)
    const text = pdf.output()
    expect(name).toBe('Intake')
    for (const part of ['Intake', 'Welcome', 'About you', 'Name *', 'Best phone', 'Birth date', '____ / ____ / ________', 'What brings you in? *', 'Page 1 of 1', 'Clients']) expect(text).toContain(part)
    const long = saveForm({ grid_id: g.gridId, name: 'Long', fields: Array.from({ length: 30 }, (_, i) => ({ kind: 'note' as const, label: `Question ${i + 1}` })) })
    expect(buildFormPdf(long.id, null).pdf.getNumberOfPages()).toBeGreaterThan(1)
  })

  it('a filled one prints the saved answers', () => {
    const f = intake()
    const r = g.rowIds[0]!
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?), (?, ?, ?)').run(r, nameC, 'Bo Diaz', r, dob, '1990-03-03')
    const text = buildFormPdf(f.id, r).pdf.output()
    expect(text).toContain('Bo Diaz')
    expect(text).toContain('Mar 3, 1990')
    expect(() => buildFormPdf(f.id, 999999)).toThrow(FormPrintError)
  })
})
