import React, { useRef } from 'react'
import { X, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
}

interface ReleaseEntry {
  version: string
  date: string
  items: string[]
}

const RELEASES: ReleaseEntry[] = [
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
      'Pulse is now free and open source (GNU GPL v3): no trial, no license key and no limit on how many records you keep',
      'Use your own words and track people, things or jobs; start from one of 38 ready-made examples, a spreadsheet, or blank',
      'New kinds of deadlines: every quarter, by miles or hours, sessions left on an authorization, step-by-step milestones, business days and extensions',
      'Link lists together, move cards across a board, and keep appointments on a calendar',
      'Forms, encrypted files on records and notes, a report builder and dashboard cards you can arrange',
      'Desktop reminders, with an option to keep Pulse running in the background',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-02-22',
    items: [
      'Encrypted SQLite database with password protection and recovery keys',
      'Grid view with virtual scrolling, inline editing, and auto-save',
      'Dashboard with priority list and deadlines',
      'Profiles with scrap notes, notes, checklists, and documents',
      'Tasks with recurrence and snooze',
      'Snippet library and letter templates',
      'Contacts directory with categories, availability tracking, and vCard import/export',
      'Command palette (Ctrl+K), keyboard shortcuts, and undo/redo',
      'Multi-column sort, filters, grouping, and saved views',
      'Three-layer backup system (auto, scheduled, manual)',
      'CSV/PDF export, Excel/CSV import, and onboarding wizard',
      'Light and dark theme support',
    ],
  },
]

export function WhatsNewModal({ open, onClose }: Props): React.ReactElement | null {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, open)

  return (
    <>
      {open && (
        <div
          ref={trapRef}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="What's new"
          onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        >
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/50" onClick={onClose} />
          <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold text-base">
                <Sparkles className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                What's New
              </div>
              <button
                onClick={onClose}
                className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
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
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={onClose}
                className="btn-primary w-full"
                style={{ minHeight: 44 }}
              >
                Got it
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
