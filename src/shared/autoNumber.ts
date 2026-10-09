/**
 * Auto-number columns: J-0001, J-0002… (plans/generalization/W02-list-kinds.md §4).
 * Shared so the add-column form can preview what main will assign.
 */

export interface AutoNumberConfig {
  prefix: string
  /** Minimum digits, zero-padded */
  pad: number
  /** The number the next record gets */
  next: number
}

export const AUTO_NUMBER_PREFIX_MAX = 20
export const AUTO_NUMBER_PAD_MAX = 10
export const DEFAULT_AUTO_NUMBER: AutoNumberConfig = { prefix: '', pad: 4, next: 1 }

/** Read a column's config, falling back to safe values for anything missing or odd. */
export function parseAutoNumberConfig(raw: unknown): AutoNumberConfig {
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'string') { try { obj = JSON.parse(raw) as Record<string, unknown> } catch { obj = {} } }
  else if (raw && typeof raw === 'object') obj = raw as Record<string, unknown>
  const prefix = typeof obj['prefix'] === 'string' ? obj['prefix'].replace(/[\r\n\t]/g, '').slice(0, AUTO_NUMBER_PREFIX_MAX) : DEFAULT_AUTO_NUMBER.prefix
  const pad = Number.isInteger(obj['pad']) ? Math.min(AUTO_NUMBER_PAD_MAX, Math.max(0, obj['pad'] as number)) : DEFAULT_AUTO_NUMBER.pad
  const next = Number.isSafeInteger(obj['next']) && (obj['next'] as number) > 0 ? obj['next'] as number : DEFAULT_AUTO_NUMBER.next
  return { prefix, pad, next }
}

export function formatAutoNumber(cfg: Pick<AutoNumberConfig, 'prefix' | 'pad'>, n: number): string {
  return cfg.prefix + String(n).padStart(cfg.pad, '0')
}

/** The number in a value like "J-0042" (its last run of digits), or null. */
export function autoNumberValue(value: string | null | undefined): number | null {
  const m = /(\d+)\D*$/.exec(value ?? '')
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) ? n : null
}
