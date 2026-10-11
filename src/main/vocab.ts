/**
 * vocab.ts — workspace words and feature switches for main-process text
 * (PDFs, CSV headers, import warnings) and for the WORKSPACE_* handlers.
 *
 * Not cached: two indexed settings reads cost microseconds, and a cache would
 * go stale when a backup is restored or the database is reset.
 *
 * Nothing that database.ts imports (contacts.ts, auth.ts, backup.ts, …) may
 * import this module: the cycle makes tests that mock the database bind to
 * the real one, and confuses TypeScript's inference in contacts.ts.
 */
import { getDb } from './database'
import { HUMAN_SERVICES_VOCAB, parseVocab, resolveVocab, term, type TermOptions, type Vocab, type VocabKey } from '../shared/vocab'
import { parseFeatures, isOn, type FeatureKey, type FeatureMap } from '../shared/features'
import type { WorkspaceState } from '../shared/ipc-contract'
import { parseMeasures } from '../shared/measures'

function readSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function workspaceVocab(): Partial<Vocab> {
  return parseVocab(readSetting('workspace_vocab')) ?? {}
}

export function workspaceFeatures(): FeatureMap {
  return parseFeatures(readSetting('workspace_features')) ?? {}
}

export function gridVocab(gridId: number): Partial<Vocab> | null {
  const row = getDb().prepare('SELECT vocab FROM grids WHERE id = ?').get(gridId) as { vocab: string | null } | undefined
  return parseVocab(row?.vocab)
}

/** Resolved words: the list's own (if given) → the workspace's → generic. */
export function vocabFor(gridId?: number | null): Vocab {
  return resolveVocab(workspaceVocab(), gridId ? gridVocab(gridId) : null)
}

/** One word for main-process text: word('record', { many: true }, gridId) → "clients". */
export function word(key: VocabKey, opts?: TermOptions, gridId?: number | null): string {
  return term(vocabFor(gridId), key, opts)
}

/**
 * Whether the workspace calls its records "clients". Pulse's built-in snippets,
 * letters and list templates are written for human services, so they are only
 * added to workspaces that use those words.
 */
export function usesHumanServicesWords(): boolean {
  return vocabFor().record.one.toLowerCase() === HUMAN_SERVICES_VOCAB.record.one
}

export function featureOn(key: FeatureKey): boolean {
  return isOn(workspaceFeatures(), key)
}

/** Holidays and weekend days as saved (Settings → Deadlines & reminders → Days off). */
export function workCalendarSetting(): { holidays: string[]; weekend: number[] } {
  const parse = (key: string): unknown => { try { return JSON.parse(readSetting(key) ?? 'null') } catch { return null } }
  const holidays = parse('workspace_holidays')
  const weekend = parse('workspace_weekend')
  return {
    holidays: Array.isArray(holidays) ? holidays.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [],
    weekend: Array.isArray(weekend) && weekend.every(n => Number.isInteger(n) && n >= 0 && n <= 6) ? weekend as number[] : [0, 6],
  }
}

export function getWorkspaceState(): WorkspaceState {
  const rows = getDb().prepare('SELECT id, vocab FROM grids WHERE vocab IS NOT NULL').all() as Array<{ id: number; vocab: string }>
  const byGrid: Record<number, Partial<Vocab>> = {}
  for (const r of rows) {
    const v = parseVocab(r.vocab)
    if (v) byGrid[r.id] = v
  }
  const measures = parseMeasures(readSetting('workspace_measures'))
  return { vocab: workspaceVocab(), features: workspaceFeatures(), gridVocab: byGrid, measures, calendar: workCalendarSetting() }
}
