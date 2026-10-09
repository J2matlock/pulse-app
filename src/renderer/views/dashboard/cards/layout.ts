/**
 * Dashboard cards (W10 §4): which cards there are, and the order and
 * visibility people chose (settings `dashboard_layout`). Cards added in a
 * later version show up at the end when they're on by default.
 */
import type { FeatureKey } from '../../../../shared/features'

export type CardKey = 'summary' | 'today' | 'requirements' | 'stages' | 'missingInfo' | 'dueForService' | 'quotas' | 'recentActivity'

export interface CardDef {
  key: CardKey
  /** Plain title; {tokens} are filled from the workspace words */
  title: string
  feature?: FeatureKey
  /** Only offered when a deadline rule of this kind exists */
  needsRuleKind?: 'meter' | 'quota'
  defaultOn: boolean
}

export const CARD_DEFS: CardDef[] = [
  { key: 'summary', title: 'Summary counts', defaultOn: true },
  { key: 'today', title: "Today's {appointment:many}", feature: 'appointments', defaultOn: true },
  { key: 'requirements', title: '{Requirement:many} this period', feature: 'requirements', defaultOn: true },
  { key: 'stages', title: '{Stage:many}', feature: 'stages', defaultOn: true },
  { key: 'missingInfo', title: 'Missing information', defaultOn: true },
  { key: 'dueForService', title: 'Due for service', needsRuleKind: 'meter', defaultOn: true },
  { key: 'quotas', title: 'Running low on visits', needsRuleKind: 'quota', defaultOn: true },
  { key: 'recentActivity', title: 'Recent {activity:many}', defaultOn: false },
]

export interface SavedLayout { order: string[]; hidden: string[] }

export function parseLayout(raw: string | null | undefined): SavedLayout | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    // Older or suggested layouts may be a plain list of the cards to show
    if (Array.isArray(v)) {
      const order = v.filter((x): x is string => typeof x === 'string')
      return { order, hidden: CARD_DEFS.map(c => c.key).filter(k => !order.includes(k)) }
    }
    if (v && typeof v === 'object') {
      const o = v as { order?: unknown; hidden?: unknown }
      const strings = (x: unknown) => Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : []
      return { order: strings(o.order), hidden: strings(o.hidden) }
    }
  } catch { /* unreadable: defaults */ }
  return null
}

/** Every card that can show here, in order, with whether it's on */
export function resolveLayout(saved: SavedLayout | null, available: (def: CardDef) => boolean): Array<{ def: CardDef; on: boolean }> {
  const defs = CARD_DEFS.filter(available)
  const byKey = new Map(defs.map(d => [d.key as string, d]))
  const ordered: CardDef[] = []
  for (const k of saved?.order ?? []) { const d = byKey.get(k); if (d && !ordered.includes(d)) ordered.push(d) }
  for (const d of defs) if (!ordered.includes(d)) ordered.push(d)
  return ordered.map(def => ({
    def,
    on: saved ? (saved.order.includes(def.key) ? !saved.hidden.includes(def.key) : saved.hidden.includes(def.key) ? false : def.defaultOn) : def.defaultOn,
  }))
}

export function layoutToSave(cards: Array<{ def: CardDef; on: boolean }>): SavedLayout {
  return { order: cards.map(c => c.def.key), hidden: cards.filter(c => !c.on).map(c => c.def.key) }
}
