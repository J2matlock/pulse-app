/**
 * Where each optional feature shows once it's switched on, in the words of
 * the screens ("Settings → Deadlines & reminders"). Settings → Words & features
 * prints it under every switch, so someone turning a feature on knows where to
 * look next (UX review E-02 d). Keyed by FeatureKey so a new feature without a
 * line here fails typecheck.
 *
 * Text may contain {word} tokens; show it through useVocab().f.
 */
import type { FeatureKey } from './features'

export const FEATURE_PLACES: Record<FeatureKey, string> = {
  personFields: 'Add a column → Date of birth, and {a record}\'s page',
  priority: 'The {list}\'s "Show" menu, and the Dashboard',
  links: 'Add a column → Link to another {list}, and the "Linked" section on {a record}\'s page',
  stages: 'Right-click a dropdown column → "Use as the stage…", then the Table / Board switch',
  forms: 'The menu next to {a list} in the sidebar → "Forms…", and {a record}\'s page',
  attachments: 'The Files section on {a record}\'s page, and Settings → Data',
  contactsDirectory: 'The sidebar, and "Linked {contact:many}" on {a record}\'s page',

  requirements: 'Settings → Deadlines & reminders, the Dashboard, the {list}\'s Reports menu, and {a record}\'s page',
  timeTracking: 'The {activity} box, and the summary report',
  mileage: 'The {activity} box, and the summary report',
  measures: 'Settings → {Activity:many}, and the {activity} box',
  snippets: 'The sidebar, and any text box when you type "/"',

  checklists: 'The Checklist section on {a record}\'s page, and the Templates page',
  tasks: 'The sidebar, the Dashboard, and the Calendar',
  appointments: 'The Calendar, and "Schedule…" on {a record}\'s page',
  notifications: 'Settings → Deadlines & reminders → Reminders',
  focusMode: 'The sidebar, and the morning summary',

  letters: 'The sidebar, and "Make a letter…" on {a record}\'s page',
  summaryReport: 'The {list}\'s Reports menu → "Report for my supervisor…"',
  handoff: '"Print or save" on {a record}\'s page',
}
