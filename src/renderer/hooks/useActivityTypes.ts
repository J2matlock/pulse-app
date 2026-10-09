import { useEffect, useMemo } from 'react'
import { useActivityTypeStore } from '../stores/activityTypeStore'
import {
  isSystemActivityType, labelFor, SYSTEM_ACTIVITY_ICONS, type ActivityColor, type ActivityType,
} from '../../shared/activityTypes'

/** Light/dark backgrounds for note entries, by palette key */
export const ACTIVITY_BG: Record<ActivityColor, string> = {
  slate: 'bg-slate-50 dark:bg-slate-800/50',
  blue: 'bg-blue-50 dark:bg-blue-900/20',
  green: 'bg-green-50 dark:bg-green-900/20',
  purple: 'bg-purple-50 dark:bg-purple-900/20',
  orange: 'bg-orange-50 dark:bg-orange-900/20',
  teal: 'bg-teal-50 dark:bg-teal-900/20',
  amber: 'bg-amber-50 dark:bg-amber-900/20',
  red: 'bg-red-50 dark:bg-red-900/20',
}

/** Swatch colors for the type editor */
export const ACTIVITY_SWATCH: Record<ActivityColor, string> = {
  slate: 'bg-slate-400', blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500',
  orange: 'bg-orange-500', teal: 'bg-teal-500', amber: 'bg-amber-500', red: 'bg-red-500',
}

// Pulse's own entries keep the look they always had
const SYSTEM_BG: Record<string, string> = {
  system: 'bg-slate-50/50 dark:bg-slate-900/30',
  manual: ACTIVITY_BG.slate,
  import: ACTIVITY_BG.teal,
  followup: ACTIVITY_BG.amber,
}

export interface ActivityTypesApi {
  /** Types people can pick for a new note, in their order */
  active: ActivityType[]
  /** Every type people ever made, archived ones included */
  all: ActivityType[]
  label: (key: string) => string
  icon: (key: string) => string
  bgClass: (key: string) => string
  isArchived: (key: string) => boolean
}

/** Note types from the shared store; loads them the first time they're needed. */
export function useActivityTypes(): ActivityTypesApi {
  const types = useActivityTypeStore(s => s.types)
  const isLoaded = useActivityTypeStore(s => s.isLoaded)
  useEffect(() => { if (!isLoaded) void useActivityTypeStore.getState().load() }, [isLoaded])

  return useMemo(() => {
    const sorted = [...types].sort((a, b) => a.position - b.position || a.id - b.id)
    const byKey = new Map(sorted.map(t => [t.key, t]))
    return {
      active: sorted.filter(t => !t.is_archived),
      all: sorted,
      label: (key: string) => labelFor(sorted, key),
      icon: (key: string) => byKey.get(key)?.icon ?? (isSystemActivityType(key) ? SYSTEM_ACTIVITY_ICONS[key] : '📝'),
      bgClass: (key: string) => {
        if (isSystemActivityType(key)) return SYSTEM_BG[key]!
        const color = byKey.get(key)?.color
        return color ? ACTIVITY_BG[color] : ACTIVITY_BG.slate
      },
      isArchived: (key: string) => byKey.get(key)?.is_archived === 1,
    }
  }, [types])
}
