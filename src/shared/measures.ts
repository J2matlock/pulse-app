/**
 * Your own numbers on notes: labor hours, parts cost, boxes delivered…
 * (plans/generalization/W03-activity.md §3). Minutes and miles stay built in.
 *
 * Definitions live in settings `workspace_measures`; each note keeps its
 * values in case_log.extra_measures as `{ [key]: number }`. A measure's key
 * is made once from its first label and never changes.
 */
import { z } from 'zod'
import { textLength } from './textLength'

export type MeasureKind = 'number' | 'currency' | 'hours'

export interface MeasureDef {
  key: string
  label: string
  /** Shown after number values, e.g. "boxes" */
  unit?: string
  kind: MeasureKind
  decimals: 0 | 1 | 2
  archived?: boolean
}

export const MAX_ACTIVE_MEASURES = 10
export const MEASURE_LABEL_MAX = 40
export const MEASURE_UNIT_MAX = 20
/** Keys used by the built-in measures, never given to custom ones */
export const BUILTIN_MEASURE_KEYS = ['minutes', 'miles'] as const

const LIMITS: Record<MeasureKind, number> = { number: 1e7, currency: 1e7, hours: 24 }

export const measureDefSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,30}$/),
  label: z.string().trim().check(textLength({ min: 1, max: MEASURE_LABEL_MAX })),
  unit: z.string().trim().check(textLength({ max: MEASURE_UNIT_MAX })).optional(),
  kind: z.enum(['number', 'currency', 'hours']),
  decimals: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  archived: z.boolean().optional(),
}).strict()

/** Saved definitions; anything malformed is dropped rather than failing. */
export function parseMeasures(raw: string | null | undefined): MeasureDef[] {
  if (!raw) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(data)) return []
  return data.flatMap(d => {
    const r = measureDefSchema.safeParse(d)
    return r.success ? [r.data as MeasureDef] : []
  })
}

/** A note's custom values; anything that isn't a finite number is ignored. */
export function parseExtraMeasures(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {}
  let data: unknown
  try { data = JSON.parse(raw) } catch { return {} }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  return Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>
}

/** Round a value the way its measure keeps it, or say what's wrong in plain words. */
export function cleanMeasureValue(def: MeasureDef, value: unknown): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return `${def.label} must be a number of 0 or more.`
  const max = LIMITS[def.kind]
  if (value > max) return def.kind === 'hours' ? `${def.label} can be up to 24 hours.` : `${def.label} is too large.`
  const places = def.kind === 'number' ? def.decimals : 2
  // Shift by the decimal string, not by multiplying: 1.255 * 100 is 125.4999…
  // (tiny values already print as "1e-7", where plain multiplying is fine)
  if (/e/i.test(String(value))) return Math.round(value * 10 ** places) / 10 ** places
  return Number(`${Math.round(Number(`${value}e${places}`))}e-${places}`)
}

/** "Labor 1.5 h", "Parts $84.20", "Boxes 3 boxes" */
export function formatMeasure(def: MeasureDef, value: number): string {
  if (def.kind === 'currency') return `${def.label} ${value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
  if (def.kind === 'hours') return `${def.label} ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} h`
  const n = value.toLocaleString('en-US', { minimumFractionDigits: def.decimals, maximumFractionDigits: def.decimals })
  return def.unit ? `${def.label} ${n} ${def.unit}` : `${def.label} ${n}`
}

/** Input step for a measure's box */
export function measureStep(def: MeasureDef): string {
  if (def.kind === 'currency') return '0.01'
  if (def.kind === 'hours') return '0.25'
  return def.decimals === 0 ? '1' : def.decimals === 1 ? '0.1' : '0.01'
}
