/**
 * Forms (generalization W08 §2–4): saving forms, and submitting one to add
 * a record or update one, optionally logging a note with the answers.
 * Fields refer to columns by id; a deleted column's field is dropped (and
 * counted, so the builder can say so).
 */
import { getDb } from './database'
import { setCellWithHistory } from './cell-write'
import { assignAutoNumbers } from './auto-number'
import { columnAffectsDisplayName, hasDisplayFormat, refreshDisplayNames } from './display-names'
import { addLink, removeLink } from './links'
import { isValidLogType, userTypeKeys } from './activity-types'
import { applyNoteDateUpdates, revertNoteDates, localDayOf } from './note-date-updates'
import { formInputSchema, NOT_FILLABLE, type Form, type FormChange, type FormField, type FormInput } from '../shared/forms'
import { linkColumnSpecs } from '../shared/links'
import { tagList, tagValueFromText } from '../shared/tagValue'

export class FormError extends Error {}

interface FormRow { id: number; grid_id: number; name: string; intro: string | null; fields: string; log_activity_type: string | null; position: number; created_at: string; updated_at: string }
interface Col { id: number; name: string; column_type: string; config: string | null; is_name_column: number }

function columnsOf(gridId: number): Map<number, Col> {
  return new Map((getDb().prepare('SELECT id, name, column_type, config, is_name_column FROM columns WHERE grid_id = ?').all(gridId) as Col[]).map(c => [c.id, c]))
}

function toForm(r: FormRow): Form {
  let fields: FormField[] = []
  try { fields = JSON.parse(r.fields) as FormField[] } catch { fields = [] }
  const cols = columnsOf(r.grid_id)
  const kept = fields.filter(f => f.kind !== 'column' || cols.has(f.columnId))
  return { ...r, fields: kept, ...(kept.length < fields.length ? { dropped: fields.length - kept.length } : {}) }
}

export function listForms(gridId: number): Form[] {
  return (getDb().prepare('SELECT * FROM forms WHERE grid_id = ? ORDER BY position, id').all(gridId) as FormRow[]).map(toForm)
}

export function getForm(id: number): Form | undefined {
  const r = getDb().prepare('SELECT * FROM forms WHERE id = ?').get(id) as FormRow | undefined
  return r ? toForm(r) : undefined
}

/** Check and save a form; columns must be this list's, once each, and fillable */
export function saveForm(input: FormInput): Form {
  const p = formInputSchema.safeParse(input)
  if (!p.success) throw new FormError(p.error.issues[0]?.message ?? 'Some of the form settings are missing or not allowed.')
  const v = p.data
  const db = getDb()
  if (!db.prepare('SELECT 1 FROM grids WHERE id = ? AND is_active = 1').get(v.grid_id)) throw new FormError('That list no longer exists.')
  const cols = columnsOf(v.grid_id)
  const seen = new Set<number>()
  for (const f of v.fields) {
    if (f.kind !== 'column') continue
    const c = cols.get(f.columnId)
    if (!c) throw new FormError('A field on this form is for a column that no longer exists.')
    if (seen.has(f.columnId)) throw new FormError(`"${c.name}" is on the form twice.`)
    if (NOT_FILLABLE.has(c.column_type)) throw new FormError(`"${c.name}" is filled in by Pulse, so it can't be on a form.`)
    seen.add(f.columnId)
  }
  if (!v.fields.some(f => f.kind !== 'section')) throw new FormError('Add at least one question.')
  if (v.log_activity_type && !userTypeKeys(false).has(v.log_activity_type)) throw new FormError('That kind of note no longer exists.')
  return db.transaction(() => {
    if (v.id !== undefined) {
      const changed = db.prepare("UPDATE forms SET name = ?, intro = ?, fields = ?, log_activity_type = ?, updated_at = datetime('now') WHERE id = ? AND grid_id = ?")
        .run(v.name, v.intro ?? null, JSON.stringify(v.fields), v.log_activity_type ?? null, v.id, v.grid_id).changes
      if (!changed) throw new FormError('That form no longer exists.')
      return getForm(v.id)!
    }
    const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM forms WHERE grid_id = ?').get(v.grid_id) as { p: number }).p
    const id = Number(db.prepare('INSERT INTO forms (grid_id, name, intro, fields, log_activity_type, position) VALUES (?, ?, ?, ?, ?, ?)')
      .run(v.grid_id, v.name, v.intro ?? null, JSON.stringify(v.fields), v.log_activity_type ?? null, pos).lastInsertRowid)
    return getForm(id)!
  })()
}

export function deleteForm(id: number): void {
  if (getDb().prepare('DELETE FROM forms WHERE id = ?').run(id).changes === 0) throw new FormError('That form no longer exists.')
}

/** A column's settings, parsed */
const configOf = (c: Col): Record<string, unknown> => {
  try { return JSON.parse(c.config || '{}') as Record<string, unknown> } catch { return {} }
}

function cleanValue(c: Col, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new FormError(`"${c.name}" has an answer that can't be saved.`)
  const v = raw.replace(/\0/g, '').trim()
  if (v === '') return null
  if (v.length > 100_000) throw new FormError(`"${c.name}" is too long.`)
  if ((c.column_type === 'date' || c.column_type === 'deadline') && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FormError(`"${c.name}" needs a date.`)
  if ((c.column_type === 'number' || c.column_type === 'currency') && !/^-?[\d,]*\.?\d+$/.test(v.replace(/^\$/, ''))) throw new FormError(`"${c.name}" needs a number.`)
  if (c.column_type === 'checkbox') return v === 'true' || v === '1' ? 'true' : 'false'
  // A Tags cell holds a JSON array; the form's box takes "urgent, spanish"
  if (c.column_type === 'tag') return tagValueFromText(tagList(v).join(','))
  return v
}

/** Links this record has through a link column (the other ends) */
function linkedIds(rowId: number, c: Col): number[] {
  const spec = linkColumnSpecs([c])[0]
  if (!spec) return []
  const [mine, other] = spec.direction === 'forward' ? ['from_row_id', 'to_row_id'] : ['to_row_id', 'from_row_id']
  return (getDb().prepare(`SELECT ${other} AS id FROM record_links WHERE link_type_id = ? AND ${mine} = ? ORDER BY id`).all(spec.typeId, rowId) as Array<{ id: number }>).map(r => r.id)
}

function setLinks(rowId: number, c: Col, ids: number[]): void {
  const spec = linkColumnSpecs([c])[0]
  if (!spec) return
  const current = linkedIds(rowId, c)
  const ends = (other: number): [number, number] => (spec.direction === 'forward' ? [rowId, other] : [other, rowId])
  for (const id of current) if (!ids.includes(id)) removeLink(spec.typeId, ...ends(id))
  for (const id of ids) if (!current.includes(id)) addLink(spec.typeId, ...ends(id), { quiet: true })
}

export type FormValues = Record<string, string | null | number[]>

/**
 * Submit a form: add a record (rowId null) or update one (only the changed
 * cells, with history), and log a note with the answers when the form says
 * to. Required answers are checked here as well as in the window.
 */
export function submitForm(formId: number, rowId: number | null, values: FormValues, noteAnswers: Record<string, string> = {}): FormChange {
  const db = getDb()
  const form = getForm(formId)
  if (!form) throw new FormError('That form no longer exists.')
  const cols = columnsOf(form.grid_id)
  if (rowId !== null && !db.prepare('SELECT 1 FROM rows WHERE id = ? AND grid_id = ? AND deleted_at IS NULL').get(rowId, form.grid_id)) throw new FormError('That record is no longer available.')

  const missing: string[] = []
  const cellValues = new Map<number, string | null>()
  const linkValues = new Map<number, number[]>()
  form.fields.forEach((f, i) => {
    if (f.kind === 'section') return
    if (f.kind === 'note') {
      if (f.required && !(noteAnswers[String(i)] ?? '').trim()) missing.push(f.label)
      return
    }
    const c = cols.get(f.columnId)!
    const required = f.required ?? configOf(c).required === true
    const key = String(f.columnId)
    if (c.column_type === 'link') {
      const raw = values[key]
      if (raw !== undefined && (!Array.isArray(raw) || raw.length > 200 || !raw.every(x => Number.isInteger(x) && x > 0))) throw new FormError(`"${c.name}" has an answer that can't be saved.`)
      const ids = raw !== undefined ? raw as number[] : rowId !== null ? linkedIds(rowId, c) : []
      if (raw !== undefined) linkValues.set(c.id, ids)
      if (required && ids.length === 0) missing.push(f.label || c.name)
      return
    }
    const raw = values[key]
    const v = raw !== undefined ? cleanValue(c, raw) : rowId !== null ? (db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, c.id) as { value: string | null } | undefined)?.value ?? null : null
    if (raw !== undefined) cellValues.set(c.id, v)
    // A required checkbox ("I agree") has to be ticked
    if (required && (v === null || (c.column_type === 'checkbox' && v !== 'true'))) missing.push(f.label || c.name)
  })
  if (missing.length) throw new FormError(`Please fill in: ${missing.join(', ')}.`)
  const noteType = form.log_activity_type && isValidLogType(form.log_activity_type) && userTypeKeys(false).has(form.log_activity_type) ? form.log_activity_type : null

  return db.transaction((): FormChange => {
    const change: FormChange = { rowId: 0, created: rowId === null, previous: {}, previousLinks: {}, noteId: null }
    let id = rowId
    const changedLines: string[] = []
    if (id === null) {
      const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM rows WHERE grid_id = ?').get(form.grid_id) as { p: number }).p
      id = Number(db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(form.grid_id, pos).lastInsertRowid)
      const ins = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
      for (const [colId, v] of cellValues) if (v !== null) ins.run(id, colId, v)
      assignAutoNumbers(form.grid_id, [id])
      if (hasDisplayFormat(form.grid_id)) refreshDisplayNames(form.grid_id, [id])
    } else {
      let names = false
      for (const [colId, v] of cellValues) {
        const before = setCellWithHistory(id, colId, v)
        if (before === v) continue
        change.previous[colId] = before
        changedLines.push(`${cols.get(colId)!.name}: ${v ?? '(cleared)'}`)
        if (columnAffectsDisplayName(form.grid_id, colId)) names = true
      }
      if (names) refreshDisplayNames(form.grid_id, [id])
      if (Object.keys(change.previous).length) db.prepare("UPDATE rows SET updated_at = datetime('now') WHERE id = ?").run(id)
    }
    for (const [colId, ids] of linkValues) {
      const c = cols.get(colId)!
      if (rowId !== null) change.previousLinks[colId] = linkedIds(id, c)
      setLinks(id, c, ids)
    }
    change.rowId = id
    if (noteType) {
      const answers = form.fields.flatMap((f, i) => (f.kind === 'note' && (noteAnswers[String(i)] ?? '').trim() ? [`${f.label}: ${noteAnswers[String(i)]!.trim()}`] : []))
      const lines = [...answers, ...changedLines]
      const content = lines.length ? `${form.name}\n${lines.join('\n')}` : `Filled in ${form.name}`
      change.noteId = Number(db.prepare("INSERT INTO case_log (row_id, content, log_type, source_action_id, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))")
        .run(id, content, noteType, `form:${formId}`).lastInsertRowid)
      try { applyNoteDateUpdates(id, noteType, undefined, change.noteId) } catch { /* dates are a convenience */ }
    }
    return change
  })()
}

/**
 * Undo a submit: void its note and put back the dates it moved; move the
 * record it made to the Trash (anything added to it since stays with it), or
 * put the old values and links back.
 */
export function undoFormSubmit(change: FormChange): void {
  const db = getDb()
  db.transaction(() => {
    if (change.noteId !== null) {
      db.prepare("UPDATE case_log SET voided_at = datetime('now'), voided_reason = 'The form was undone' WHERE id = ? AND voided_at IS NULL").run(change.noteId)
      revertNoteDates(change.noteId)
    }
    const row = db.prepare('SELECT grid_id FROM rows WHERE id = ?').get(change.rowId) as { grid_id: number } | undefined
    if (!row) return
    if (change.created) {
      db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(change.rowId)
      db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Moved to trash (the form was undone)', 'system', datetime('now'), datetime('now'))").run(change.rowId)
      return
    }
    const cols = columnsOf(row.grid_id)
    for (const [colId, v] of Object.entries(change.previous)) if (cols.has(Number(colId))) setCellWithHistory(change.rowId, Number(colId), v)
    for (const [colId, ids] of Object.entries(change.previousLinks)) { const c = cols.get(Number(colId)); if (c) setLinks(change.rowId, c, ids) }
    refreshDisplayNames(row.grid_id, [change.rowId])
  })()
}

/**
 * Redo a submit that made a record: bring that record back from the Trash
 * with its note and dates. False when it's gone (emptied from the Trash),
 * so the form is submitted again instead.
 */
export function redoFormSubmit(change: FormChange): boolean {
  if (!change.created) return false
  const db = getDb()
  return db.transaction((): boolean => {
    const row = db.prepare('SELECT deleted_at FROM rows WHERE id = ?').get(change.rowId) as { deleted_at: string | null } | undefined
    if (!row || row.deleted_at === null) return false
    db.prepare("UPDATE rows SET is_active = 1, deleted_at = NULL, updated_at = datetime('now') WHERE id = ?").run(change.rowId)
    db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Restored from trash (the form was redone)', 'system', datetime('now'), datetime('now'))").run(change.rowId)
    if (change.noteId !== null) {
      const note = db.prepare('SELECT log_type, occurred_at FROM case_log WHERE id = ? AND row_id = ?').get(change.noteId, change.rowId) as { log_type: string; occurred_at: string } | undefined
      if (note) {
        db.prepare('UPDATE case_log SET voided_at = NULL, voided_reason = NULL WHERE id = ?').run(change.noteId)
        applyNoteDateUpdates(change.rowId, note.log_type, localDayOf(note.occurred_at), change.noteId)
      }
    }
    return true
  })()
}
