import React, { useRef } from 'react'
import { X, Keyboard } from 'lucide-react'
import { motion } from 'motion/react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'

interface Props {
  open: boolean
  onClose: () => void
}

export interface ShortcutRow {
  keys: string[]
  description: string
}

export interface ShortcutSection {
  title: string
  shortcuts: ShortcutRow[]
}

export const SECTIONS: ShortcutSection[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: ['Ctrl', 'K'],          description: 'Open command palette' },
      { keys: ['Ctrl', 'L'],          description: 'Lock the app' },
      { keys: ['Ctrl', '\\'],         description: 'Toggle sidebar' },
      { keys: ['?'],                   description: 'Show keyboard shortcuts' },
      { keys: ['Ctrl', '='],          description: 'Zoom in' },
      { keys: ['Ctrl', '-'],          description: 'Zoom out' },
      { keys: ['Ctrl', '0'],          description: 'Reset zoom' },
    ],
  },
  {
    title: 'Grid Navigation',
    shortcuts: [
      { keys: ['Arrow keys'],          description: 'Move between cells' },
      { keys: ['Tab'],                 description: 'Move to next cell (wraps to next row)' },
      { keys: ['Shift', 'Tab'],        description: 'Move to previous cell' },
      { keys: ['Home'],                description: 'Jump to first column in row' },
      { keys: ['End'],                 description: 'Jump to last column in row' },
    ],
  },
  {
    title: 'Grid Editing',
    shortcuts: [
      { keys: ['Enter'],               description: 'Start editing focused cell' },
      { keys: ['F2'],                  description: 'Start editing focused cell' },
      { keys: ['Escape'],              description: 'Cancel edit' },
      { keys: ['Ctrl', 'C'],          description: 'Copy cell value to clipboard' },
      { keys: ['Ctrl', 'Shift', 'C'], description: 'Copy "Column: Value" to clipboard' },
      { keys: ['Ctrl', 'V'],          description: 'Paste clipboard value into cell' },
      { keys: ['Ctrl', 'H'],          description: 'Find and replace (in Grid view)' },
      { keys: ['Ctrl', 'N'],          description: 'Add new {record} (in Grid view)' },
    ],
  },
  {
    title: 'Tasks',
    shortcuts: [
      { keys: ['Ctrl', 'Shift', 'T'], description: 'Add new task' },
    ],
  },
  {
    title: 'Contacts',
    shortcuts: [
      { keys: ['Ctrl', 'Shift', 'P'], description: 'Go to {ContactDirectory}' },
      { keys: ['N'],                   description: 'Add new {contact} (in {ContactDirectory})' },
      { keys: ['/'],                   description: 'Focus search (in Contacts view)' },
    ],
  },
]

export function KeyboardShortcutsModal({ open, onClose }: Props): React.ReactElement | null {
  const { t, f } = useVocab()
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
          aria-label="Keyboard shortcuts"
          onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        >
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/50" onClick={onClose} />
          <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative w-full max-w-xl bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold text-base">
                <Keyboard className="w-5 h-5" />
                Keyboard Shortcuts
              </div>
              <button
                onClick={onClose}
                className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                aria-label="Close"
                title="Close (Escape)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Hint banner */}
            <div className="px-6 py-2.5 bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-700 dark:text-blue-300 font-medium flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded-sm border border-blue-300 dark:border-blue-600 bg-white dark:bg-slate-700 text-sm font-mono">?</kbd>
              Press <strong>?</strong> anywhere to show this panel
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
              {SECTIONS.map(section => (
                <section key={section.title}>
                  <h3 className="text-base font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                    {section.title}
                  </h3>
                  <div className="space-y-1">
                    {section.shortcuts.map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-4 py-1.5">
                        <span className="text-base text-slate-600 dark:text-slate-300">{f(row.description)}</span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {row.keys.map((key, j) => (
                            <React.Fragment key={j}>
                              {j > 0 && <span className="text-slate-500 dark:text-slate-400 text-sm">+</span>}
                              <kbd className="inline-flex items-center px-2 py-0.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-base font-mono shadow-xs">
                                {key}
                              </kbd>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Getting Started tips */}
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Getting Started</h3>
              <ul className="text-sm text-slate-500 dark:text-slate-400 space-y-1 list-disc list-inside">
                <li>Click column headers to sort</li>
                <li>Right-click {t('record', { article: true })} for options</li>
                <li>Type <kbd className="px-1 py-0.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm font-mono">/</kbd> in text fields for snippets</li>
              </ul>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
