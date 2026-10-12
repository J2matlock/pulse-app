/**
 * Feature switches: each optional part of Pulse can be shown or hidden, so a
 * workspace only shows what its owner uses. Switching a feature off hides it;
 * it never deletes data, and switching it back on shows everything again.
 *
 * The core (lists, columns, deadline rules, notes, dashboard, reports,
 * backups, security) is always on and not listed here.
 * See plans/generalization/W01-workspace.md §3.
 */
import { z } from 'zod'

export type FeatureKey =
  | 'checklists' | 'tasks' | 'snippets' | 'letters' | 'contactsDirectory' | 'focusMode'
  | 'requirements' | 'timeTracking' | 'mileage' | 'measures' | 'priority'
  | 'summaryReport' | 'handoff' | 'personFields'
  | 'appointments' | 'stages' | 'links' | 'forms' | 'attachments' | 'notifications'

export type FeatureGroup = 'Records' | 'Notes & activity' | 'Planning' | 'Reports'

/** label and description may contain {word} tokens (fill with fillVocab / useVocab().f) */
export interface FeatureDef {
  key: FeatureKey
  label: string
  description: string
  group: FeatureGroup
  /** On for a new blank workspace */
  blankDefault: boolean
  /** Available in this version (later phases flip this when they ship) */
  available: boolean
}

/**
 * Every feature, in the order Settings shows them. Keyed by FeatureKey so a
 * key added to the union without an entry here fails typecheck (otherwise it
 * would be off forever and missing from Settings).
 */
const FEATURE_DEFS = {
  personFields: { group: 'Records', label: 'People details', description: 'Age from date of birth and other details that only apply to people.', blankDefault: true, available: true },
  priority: { group: 'Records', label: '{Priority:many}', description: 'Score how much attention each {record} needs and sort by it.', blankDefault: false, available: true },
  links: { group: 'Records', label: 'Linked lists', description: 'Connect lists, like customers and their vehicles.', blankDefault: false, available: true },
  stages: { group: 'Records', label: 'Stages and board', description: 'Move things through steps, like New → In progress → Done, on a board.', blankDefault: false, available: true },
  forms: { group: 'Records', label: 'Forms', description: 'Fill in or print a form to add or update one.', blankDefault: false, available: true },
  attachments: { group: 'Records', label: 'Files', description: 'Attach documents and photos, stored encrypted inside Pulse.', blankDefault: false, available: true },
  contactsDirectory: { group: 'Records', label: '{Contact} directory', description: 'A shared list of outside {contact:many} you can link to.', blankDefault: false, available: true },

  requirements: { group: 'Notes & activity', label: '{Requirement:many}', description: 'Set how many {activity:many} of a kind each {record} needs per period, and see who is behind.', blankDefault: false, available: true },
  timeTracking: { group: 'Notes & activity', label: 'Time on {activity:many}', description: 'Record minutes on {activity:many} and total them as units.', blankDefault: false, available: true },
  mileage: { group: 'Notes & activity', label: 'Mileage on {activity:many}', description: 'Record miles on {activity:many} for your monthly mileage claim.', blankDefault: false, available: true },
  measures: { group: 'Notes & activity', label: 'Your own numbers on {activity:many}', description: 'Add numbers like labor hours or parts cost to {activity:many} and total them.', blankDefault: false, available: true },
  snippets: { group: 'Notes & activity', label: 'Snippets', description: 'Type a short code to insert text you use often.', blankDefault: true, available: true },

  checklists: { group: 'Planning', label: 'Checklists', description: 'Step-by-step checklists on each {record}.', blankDefault: true, available: true },
  tasks: { group: 'Planning', label: 'Tasks', description: 'Your own to-do list, with repeating tasks.', blankDefault: true, available: true },
  appointments: { group: 'Planning', label: '{Appointment:many}', description: 'Schedule {appointment:many}, one-off or repeating, and see them on the calendar.', blankDefault: false, available: true },
  notifications: { group: 'Planning', label: 'Reminders', description: 'A desktop reminder each morning with how much is due.', blankDefault: false, available: true },
  focusMode: { group: 'Planning', label: 'Focus mode', description: 'Go through what needs attention one at a time.', blankDefault: false, available: true },

  letters: { group: 'Reports', label: 'Letters and documents', description: 'Fill in letters and documents from templates.', blankDefault: false, available: true },
  summaryReport: { group: 'Reports', label: 'Summary report', description: 'A report of activity and deadlines for a period, for a supervisor.', blankDefault: false, available: true },
  handoff: { group: 'Reports', label: 'Handoff packet', description: 'One PDF with everything about {a record}, for a transfer.', blankDefault: false, available: true },

} satisfies Record<FeatureKey, Omit<FeatureDef, 'key'>>

export const FEATURES: readonly FeatureDef[] = Object.entries(FEATURE_DEFS).map(([key, def]) => ({ key: key as FeatureKey, ...def }))

export type FeatureMap = Partial<Record<FeatureKey, boolean>>

const FEATURE_BY_KEY = new Map(FEATURES.map(f => [f.key, f]))

export const featureMapSchema = z.record(z.string(), z.boolean())
  .transform(m => Object.fromEntries(Object.entries(m).filter(([k]) => FEATURE_BY_KEY.has(k as FeatureKey))) as FeatureMap)

/** Whether a feature shows; falls back to the blank-workspace default. */
export function isOn(map: FeatureMap | null | undefined, key: FeatureKey): boolean {
  const def = FEATURE_BY_KEY.get(key)
  if (!def || !def.available) return false
  return map?.[key] ?? def.blankDefault
}

/** Parse stored JSON safely; unknown keys and bad values are dropped. */
export function parseFeatures(json: string | null | undefined): FeatureMap | null {
  if (!json) return null
  try {
    const parsed = featureMapSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * The switches an existing install gets (migration 036): everything it has
 * today stays visible; time and mileage follow the old settings.
 */
export function featuresForExistingInstall(old: { trackTime: boolean; trackMileage: boolean }): FeatureMap {
  return {
    personFields: true, priority: true, contactsDirectory: true,
    requirements: true, timeTracking: old.trackTime, mileage: old.trackMileage, snippets: true,
    checklists: true, tasks: true, focusMode: true,
    letters: true, summaryReport: true, handoff: true,
  }
}
