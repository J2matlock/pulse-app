import React from 'react'
import { Sparkles } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'

interface Props {
  open: boolean
  onClose: () => void
}

interface ReleaseEntry {
  version: string
  date: string
  items: string[]
}

/** Items name records, lists and notes with {word} tokens, filled with the workspace's words */
export const RELEASES: ReleaseEntry[] = [
  {
    version: '2.7.0',
    date: '2026-10-15',
    items: [
      'Your work is safer: a date that isn\'t a real date is never saved over the one you had, a half-written {activity} survives closing the window or a crash, and forms you were filling in come back after Pulse locks',
      'Bringing in a spreadsheet shows what Pulse guessed (names, columns, which dates repeat) before anything is added, and dates in the future are read as due dates',
      'The dashboard opens on what to do next, its counts agree everywhere, and "Print what\'s due" prints exactly what you see, in large black text',
      'Fewer questions: things you can undo just happen, with an Undo button, and double-clicks no longer make two of anything',
      'Easier to find your way: one deadline card everywhere, clearer words and buttons, quieter settings, a short first look instead of a long tour, and everything works from the keyboard',
      'New examples for home health nursing and foster home licensing, a new app icon, and a faster list with thousands of {record:many}',
    ],
  },
  {
    version: '2.6.0',
    date: '2026-10-13',
    items: [
      'Calendar events that aren\'t tied to anyone: a title, a time or all day, a place, details and repeats, like any calendar',
      'Choose which deadlines show on the Calendar, from the "Which deadlines" menu or a column\'s settings',
      'Click an empty day on the Calendar to add an event, a deadline for one of your {record:many} or a task due that day',
      'A date column with a deadline rule can show only the date: the colour stays and the words move to the tooltip',
      'The star has its own column in the {list}, and the deadline rule editor\'s colour steps fit their numbers and names',
    ],
  },
  {
    version: '2.5.0',
    date: '2026-10-12',
    items: [
      'Changing your password can now also re-encrypt your data, so an old password or a lost recovery key stops opening it',
      'Safer everyday work: scratch notes are never saved empty over what you wrote, undo no longer blanks a value, and Pulse refuses to open twice on the same data',
      'Reports and dashboard counts agree: overdue counts {record:many}, not deadlines, and big {list:many} no longer undercount',
      '"Export everything as CSV…" keeps each deadline\'s last-done date so it can be imported back, and monthly {appointment:many} on the 29th to 31st keep their day',
      'A "Skip this version" button on the update banner, and clearer keyboard focus, bigger buttons and dialogs that close with Esc',
      'Faster dashboard, exports and list, plus updated building blocks with the latest fixes',
    ],
  },
  {
    version: '2.4.0',
    date: '2026-10-11',
    items: [
      'Safer data: backups work in folders with apostrophes or accents, USB drives and network folders can be used, and a damaged backup is refused before it replaces anything',
      'Imports keep accented names from Excel and Windows files, read typed dates in deadline columns, and never stop halfway',
      'PDFs print Polish, Turkish, Cyrillic and Greek names, and spreadsheets you export are protected against formula tricks in every column',
      'Easier to use by keyboard and screen reader: the {list}, menus, dialogs and reordering all work without a mouse, with clearer contrast and Windows High Contrast support',
      'Dates Pulse can\'t read are marked "Not a date", late repeating items move past today when ticked off, and zoom goes up to 200%',
      'Faster sorting on big {list:many}, plain-language messages throughout, and an up-to-date Electron with the latest security fixes',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-10-11',
    items: [
      'Dates with a deadline say how they stand in words, like "due Oct 8 · in 3 days", and a deadline can be marked done',
      '{Activity:many} keep the day something happened as well as the day you wrote it, and dates in your {list} follow the day it happened',
      'Deleted {list:many} and columns wait in the Trash for 30 days, and made-up sample entries are marked with a ✦',
      'Clearer screens: larger text, plain words, visible focus, tidier toolbars, and ⌘ shortcuts on a Mac',
      'Many fixes: a new {list} shows right after setup, text stays inside its cell, Undo works from the Dashboard and Focus mode, and imports, restores and sample removal are safer',
    ],
  },
  {
    version: '2.2.0',
    date: '2026-10-10',
    items: [
      'Reports opens on your reports as cards: what each one answers and a glance at the answer',
      'Every example now comes with ready-made reports, and its sample data has a year of history so reports have something to show',
      'Reports split into lines are drawn as bars, and a sentence above each report says in plain words what it counts',
    ],
  },
  {
    version: '2.1.1',
    date: '2026-10-10',
    items: [
      'Reports are easier to build: start from a common report, filters and groupings start on sensible choices, and Save suggests a name',
      'Report groups follow their own order (stages, statuses), and dates read like "Jul 31, 2026" or "Oct 2026"',
      'Reports ask before deleting or before throwing away unsaved changes, and the PDF says what it covers',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-10-09',
    items: [
      'Twelve new examples: home services (lawn, pest control, HVAC, pool, chimney and gutters), bookkeeper and tax preparer, real estate transactions, speech / OT / PT practice, victim advocate, subcontractor insurance, horse barn, job search, home maintenance, family health, driving school and volunteer manager',
      'Deadlines on fixed dates (like "by April 30") now count as done when you finish a little early',
      'The dashboard card for visits, sessions or lessons running out is now called "Running low"',
    ],
  },
  {
    version: '2.0.1',
    date: '2026-10-09',
    items: [
      'New example: Tree service. Customers, jobs on a board from estimate to done, estimate follow-ups, equipment service by engine hours and crew certifications',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-10-08',
    items: [
      'Pulse is now free and open source (GNU GPL v3): no trial, no license key and no limit on how many {record:many} you keep',
      'Use your own words and track people, things or jobs; start from one of 38 ready-made examples, a spreadsheet, or blank',
      'New kinds of deadlines: every quarter, by miles or hours, sessions left on an authorization, step-by-step milestones, business days and extensions',
      'Link {list:many} together, move cards across a board, and keep {appointment:many} on a calendar',
      'Forms, encrypted files on {record:many} and {activity:many}, a report builder and dashboard cards you can arrange',
      'Desktop reminders, with an option to keep Pulse running in the background',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-02-22',
    items: [
      'Encrypted data with password protection and recovery keys',
      '{List:many} with fast scrolling and editing in place, saved automatically',
      'Dashboard with priority list and deadlines',
      '{Record} pages with scratch notes, {a activityLog}, checklists, and documents',
      'Tasks with recurrence and snooze',
      'Snippet library and letter templates',
      '{ContactDirectory} directory with categories, availability tracking, and vCard import/export',
      'Command palette (Ctrl+K), keyboard shortcuts, and undo/redo',
      'Multi-column sort, filters, grouping, and saved views',
      'Three-layer backup system (auto, scheduled, manual)',
      'CSV/PDF export, Excel/CSV import, and onboarding wizard',
      'Light and dark theme support',
    ],
  },
]

export function WhatsNewModal({ open, onClose }: Props): React.ReactElement | null {
  const { f } = useVocab(null)

  return (
    <Dialog open={open} onClose={onClose} title="What's new" size="lg"
      icon={<Sparkles className="w-6 h-6 text-amber-500 dark:text-amber-400" aria-hidden="true" />}
      footer={<PrimaryButton onClick={onClose} className="w-full">Got it</PrimaryButton>}>
      <div className="space-y-6">
              {RELEASES.map(release => (
                <section key={release.version}>
                  <div className="flex items-baseline gap-3 mb-2">
                    <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                      v{release.version}
                    </h3>
                    <span className="text-sm text-slate-500 dark:text-slate-400">{release.date}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {release.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-base text-slate-600 dark:text-slate-300">
                        <span className="text-green-500 mt-0.5 flex-shrink-0">+</span>
                        {f(item)}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
      </div>
    </Dialog>
  )
}
