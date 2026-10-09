/**
 * Definitions of people's own numbers on notes (plans/generalization/W03-activity.md §3.2),
 * kept in settings `workspace_measures`. Values live on each note.
 */
import { getDb } from './database'
import { keyFromLabel } from '../shared/activityTypes'
import {
  BUILTIN_MEASURE_KEYS, MAX_ACTIVE_MEASURES, MEASURE_LABEL_MAX, MEASURE_UNIT_MAX,
  cleanMeasureValue, parseMeasures, type MeasureDef, type MeasureKind,
} from '../shared/measures'

/** A problem the person can fix; the message is shown as is. */
export class MeasureError extends Error {}

const SETTING = 'workspace_measures'

export function listMeasures(): MeasureDef[] {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(SETTING) as { value: string } | undefined
  return parseMeasures(row?.value)
}

function store(defs: MeasureDef[]): void {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTING, JSON.stringify(defs))
}

export interface MeasureInput { key?: unknown; label: unknown; unit?: unknown; kind: unknown; decimals?: unknown }

export function saveMeasure(input: MeasureInput): MeasureDef {
  const label = typeof input.label === 'string' ? input.label.replace(/\s+/g, ' ').trim() : ''
  if (!label) throw new MeasureError('Give the number a name, like "Labor".')
  if (label.length > MEASURE_LABEL_MAX) throw new MeasureError(`Names can be up to ${MEASURE_LABEL_MAX} characters.`)
  const kind = (['number', 'currency', 'hours'] as const).find(k => k === input.kind) as MeasureKind | undefined
  if (!kind) throw new MeasureError('Choose what kind of number it is.')
  const unit = kind === 'number' && typeof input.unit === 'string' && input.unit.trim() ? input.unit.trim().slice(0, MEASURE_UNIT_MAX) : undefined
  const decimals = kind === 'number' && (input.decimals === 1 || input.decimals === 2) ? input.decimals : (kind === 'number' ? 0 : 2)

  const defs = listMeasures()
  const clash = defs.find(d => !d.archived && d.label.toLowerCase() === label.toLowerCase() && d.key !== input.key)
  if (clash) throw new MeasureError(`There's already a number called "${label}".`)

  if (typeof input.key === 'string') {
    const i = defs.findIndex(d => d.key === input.key)
    if (i < 0) throw new MeasureError('That number no longer exists.')
    // The kind can change; values already saved keep the number they were
    defs[i] = { ...defs[i]!, label, kind, decimals, ...(unit ? { unit } : { unit: undefined }) }
    store(defs)
    return defs[i]!
  }
  if (defs.filter(d => !d.archived).length >= MAX_ACTIVE_MEASURES) {
    throw new MeasureError(`You can have up to ${MAX_ACTIVE_MEASURES} numbers. Archive one you no longer use first.`)
  }
  const key = keyFromLabel(label, new Set([...defs.map(d => d.key), ...BUILTIN_MEASURE_KEYS]))
  const def: MeasureDef = { key, label, kind, decimals, ...(unit ? { unit } : {}) }
  store([...defs, def])
  return def
}

/**
 * Add an example's numbers that the workspace doesn't have yet (by key),
 * up to the active limit. Returns the labels that didn't fit.
 */
export function addMissingMeasures(defs: Array<Omit<MeasureDef, 'archived'>>): { added: number; skipped: string[] } {
  const current = listMeasures()
  const have = new Set(current.map(d => d.key))
  const labels = new Set(current.filter(d => !d.archived).map(d => d.label.toLowerCase()))
  let active = current.filter(d => !d.archived).length
  const next = [...current]
  const skipped: string[] = []
  for (const d of defs) {
    if (have.has(d.key) || labels.has(d.label.toLowerCase())) continue
    if (active >= MAX_ACTIVE_MEASURES) { skipped.push(d.label); continue }
    next.push({ key: d.key, label: d.label, kind: d.kind, decimals: d.decimals, ...(d.unit ? { unit: d.unit } : {}) })
    have.add(d.key); labels.add(d.label.toLowerCase()); active++
  }
  if (next.length !== current.length) store(next)
  return { added: next.length - current.length, skipped }
}

export function setMeasureArchived(key: string, archived: boolean): void {
  const defs = listMeasures()
  const def = defs.find(d => d.key === key)
  if (!def) throw new MeasureError('That number no longer exists.')
  if (!archived && def.archived && defs.filter(d => !d.archived).length >= MAX_ACTIVE_MEASURES) {
    throw new MeasureError(`You can have up to ${MAX_ACTIVE_MEASURES} numbers. Archive another one first.`)
  }
  def.archived = archived || undefined
  store(defs)
}

/**
 * Check a note's custom values: known measures only (archived ones only on
 * edit and restore), each rounded the way its measure keeps it. Returns the
 * JSON to store (null when empty) or a plain-language problem.
 */
export function cleanExtraMeasures(extra: unknown, opts: { allowArchived?: boolean } = {}): string | null | { error: string } {
  if (extra == null) return null
  if (typeof extra !== 'object' || Array.isArray(extra)) return { error: 'Invalid numbers' }
  const entries = Object.entries(extra as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (entries.length > MAX_ACTIVE_MEASURES) return { error: 'Too many numbers on one note' }
  const defs = new Map(listMeasures().map(d => [d.key, d]))
  const out: Record<string, number> = {}
  for (const [key, value] of entries) {
    const def = defs.get(key)
    if (!def || (def.archived && !opts.allowArchived)) return { error: 'One of these numbers is no longer in use. Reload and try again.' }
    const v = cleanMeasureValue(def, value)
    if (typeof v === 'string') return { error: v }
    out[key] = v
  }
  return Object.keys(out).length ? JSON.stringify(out) : null
}
