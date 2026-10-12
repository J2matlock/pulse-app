/**
 * Forms in starters and shared workspaces (W08 §6): fields name columns, and
 * are matched to the list's columns when applied.
 */
import type { Database } from 'better-sqlite3-multiple-ciphers'
import type { StarterForm } from '../shared/starters/schema'
import { NOT_FILLABLE, type FormField } from '../shared/forms'
import { listForms, saveForm, FormError } from './forms'
import { userTypeKeys } from './activity-types'

/** A list's forms for a file, by column name */
export function portableForms(db: Database, gridId: number): StarterForm[] {
  const names = new Map((db.prepare('SELECT id, name FROM columns WHERE grid_id = ?').all(gridId) as Array<{ id: number; name: string }>).map(c => [c.id, c.name]))
  return listForms(gridId).map(f => ({
    name: f.name,
    ...(f.intro ? { intro: f.intro } : {}),
    ...(f.log_activity_type ? { log_activity_type: f.log_activity_type } : {}),
    fields: f.fields.flatMap((x): StarterForm['fields'] => {
      if (x.kind !== 'column') return [x]
      const name = names.get(x.columnId)
      if (!name) return []
      const { columnId: _id, ...rest } = x
      return [{ ...rest, column: name }]
    }),
  }))
}

/** Add a file's forms to a list; fields for columns it doesn't have are left out, with a warning */
export function applyPortableForms(db: Database, gridId: number, listName: string, forms: StarterForm[]): string[] {
  const warnings: string[] = []
  const cols = new Map((db.prepare('SELECT id, name, column_type FROM columns WHERE grid_id = ?').all(gridId) as Array<{ id: number; name: string; column_type: string }>)
    .map(c => [c.name.trim().toLowerCase(), c]))
  const types = userTypeKeys(false)
  for (const f of forms) {
    const missing: string[] = []
    const seen = new Set<number>()
    const fields = f.fields.flatMap((x): FormField[] => {
      if (x.kind !== 'column') return [x]
      const c = cols.get(x.column.trim().toLowerCase())
      if (!c || NOT_FILLABLE.has(c.column_type) || seen.has(c.id)) { if (!c) missing.push(x.column); return [] }
      seen.add(c.id)
      const { column: _name, ...rest } = x
      return [{ ...rest, columnId: c.id }]
    })
    if (missing.length) warnings.push(`The form "${f.name}" in ${listName} left out ${missing.join(', ')}, which ${missing.length === 1 ? "isn't a column" : "aren't columns"} there.`)
    try {
      saveForm({ grid_id: gridId, name: f.name, intro: f.intro ?? null, fields, log_activity_type: f.log_activity_type && types.has(f.log_activity_type) ? f.log_activity_type : null })
    } catch (err) {
      if (!(err instanceof FormError)) throw err
      warnings.push(`The form "${f.name}" in ${listName} wasn't added: ${err.message}`)
    }
  }
  return warnings
}
