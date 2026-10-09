/**
 * Note ("activity") types: Session, Phone, No-show… (plans/generalization/W03-activity.md §2).
 *
 * People's own types live in the activity_types table. The key is stored on
 * each note (case_log.log_type) and never changes; the label can. Types Pulse
 * writes itself are fixed here and never offered in pickers.
 */

export interface ActivityType {
  id: number
  key: string
  label: string
  /** An emoji (or short symbol) shown before the label */
  icon: string | null
  color: ActivityColor | null
  position: number
  is_archived: 0 | 1
}

export const SYSTEM_ACTIVITY_TYPES = ['system', 'manual', 'import', 'followup'] as const
export type SystemActivityType = (typeof SYSTEM_ACTIVITY_TYPES)[number]

const SYSTEM_LABELS: Record<SystemActivityType, string> = {
  system: 'System', manual: 'Manual', import: 'Import', followup: 'Follow-up',
}

export function isSystemActivityType(key: string): key is SystemActivityType {
  return (SYSTEM_ACTIVITY_TYPES as readonly string[]).includes(key)
}

/** The app's palette for type badges; the renderer maps each to light/dark classes */
export const ACTIVITY_COLORS = ['slate', 'blue', 'green', 'purple', 'orange', 'teal', 'amber', 'red'] as const
export type ActivityColor = (typeof ACTIVITY_COLORS)[number]

/** The five built-in types (migration 037), used until the real list has loaded */
export const DEFAULT_ACTIVITY_TYPES: readonly ActivityType[] = [
  { id: -1, key: 'note', label: 'Note', icon: '📝', color: 'slate', position: 0, is_archived: 0 },
  { id: -2, key: 'phone', label: 'Phone', icon: '📞', color: 'blue', position: 1, is_archived: 0 },
  { id: -3, key: 'meeting', label: 'Meeting', icon: '🤝', color: 'green', position: 2, is_archived: 0 },
  { id: -4, key: 'email', label: 'Email', icon: '✉️', color: 'purple', position: 3, is_archived: 0 },
  { id: -5, key: 'visit', label: 'Visit', icon: '🏠', color: 'orange', position: 4, is_archived: 0 },
]

export const SYSTEM_ACTIVITY_ICONS: Record<SystemActivityType, string> = {
  system: '🔧', manual: '✏️', import: '📥', followup: '🔄',
}

export const ACTIVITY_LABEL_MAX = 40
export const ACTIVITY_ICON_MAX = 8
export const ACTIVITY_KEY_PATTERN = /^[a-z0-9_]{1,30}$/

/** A stable key for a new type: "No-show" → "no_show", then "no_show_2" if taken. */
export function keyFromLabel(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 26) || 'type'
  const reserved = (k: string) => taken.has(k) || isSystemActivityType(k)
  if (!reserved(base)) return base
  for (let n = 2; ; n++) {
    const k = `${base}_${n}`
    if (!reserved(k)) return k
  }
}

/** A readable label for any key, including archived, system and unknown ones. */
export function labelFor(types: Pick<ActivityType, 'key' | 'label'>[], key: string): string {
  const found = types.find(t => t.key === key)
  if (found) return found.label
  if (isSystemActivityType(key)) return SYSTEM_LABELS[key]
  return key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) || 'Note'
}
