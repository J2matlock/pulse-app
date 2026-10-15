/**
 * The one-time hints: one small card per screen, shown the first time someone
 * new reaches it, then never again (UX pass Q7). Pure data, so tests and the
 * e2e helpers can import it. Each says *how* to do one thing on the screen;
 * what the screen is *for* is the screen's own job.
 *
 * Text goes through the vocabulary layer ({a record}, {contact}); quoted labels
 * must exist in the app (tests/renderer/help/faqLabelsExist.test.ts).
 */

/** Every one-time hint, plus `caseload`: the first look at the new list after setup */
export const HINT_IDS = ['caseload', 'grid', 'profile', 'dashboard', 'calendar', 'tasks', 'contacts', 'settings', 'help'] as const
export type HintId = typeof HINT_IDS[number]

export interface ScreenHintDef {
  /** The screens it belongs to (matched against the route's path) */
  route: RegExp
  /** What it sits beside; without one it sits bottom-right. Never shown if the target isn't there. */
  target?: string
  /** Which side of the target the card goes, as in the tour */
  position?: 'top' | 'bottom' | 'left' | 'right'
  text: string
}

/** `caseload` has no screen hint of its own: FirstLook shows it */
export const HINTS: Record<HintId, ScreenHintDef | null> = {
  caseload: null,
  grid: {
    route: /^\/grid(\/|$)/,
    target: '[data-tour="profile-icon"]',
    position: 'bottom',
    text: "This icon opens {a record}'s page: {activity:many}, deadlines and files together. Click a column name to sort.",
  },
  profile: {
    route: /^\/profile\//,
    target: '[data-tour="case-log"]',
    position: 'left',
    text: 'Write what happened in the {activity} box. Pick the kind first, like a visit or a call.',
  },
  dashboard: {
    route: /^\/dashboard$/,
    target: '[data-tour="dashboard-tabs"]',
    position: 'bottom',
    text: 'The most urgent is at the top. "What do the colors mean?" explains the stripes.',
  },
  calendar: {
    route: /^\/calendar$/,
    text: 'Click a day to see everything due that day, or to add an appointment.',
  },
  tasks: {
    route: /^\/tasks$/,
    target: '[data-tour="tasks-area"]',
    position: 'bottom',
    text: 'Tick the box when a task is done. Repeating tasks come back on their next date.',
  },
  contacts: {
    route: /^\/contacts$/,
    target: '[data-tour="add-provider"]',
    position: 'bottom',
    text: "After you add {a contact}, link them to {a record} from that {record}'s page.",
  },
  settings: {
    route: /^\/settings$/,
    target: '[data-tour="settings-backup-tab"]',
    position: 'right',
    text: 'Backups and your password are under Backup and Security. Changes save as you go.',
  },
  help: {
    route: /^\/help$/,
    text: 'Many answers have a "Show me" button that points at the thing on screen.',
  },
}

/** The screen hint for a route, if there is one */
export function hintForRoute(pathname: string): { id: HintId; hint: ScreenHintDef } | null {
  for (const id of HINT_IDS) {
    const hint = HINTS[id]
    if (hint && hint.route.test(pathname)) return { id, hint }
  }
  return null
}
