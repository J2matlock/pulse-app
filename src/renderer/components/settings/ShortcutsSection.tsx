import React from 'react'
import { useShortcutSections } from '../shared/KeyboardShortcutsModal'
import { useVocab } from '../../hooks/useVocab'

export function ShortcutsSection(): React.ReactElement {
  const { f } = useVocab(null)
  const sections = useShortcutSections()
  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Keyboard Shortcuts</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
        Press <kbd className="px-1.5 py-0.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm font-mono">?</kbd> anywhere to show this panel.
      </p>

      <div className="space-y-6">
        {sections.map(section => (
          <div key={section.title}>
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
              {f(section.title)}
            </h3>
            <div className="space-y-1">
              {section.shortcuts.map((row, i) => (
                <div key={i} className="flex items-center justify-between gap-4 py-1.5">
                  <span className="text-base text-slate-600 dark:text-slate-300">{f(row.description)}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {row.keys.map((key, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span className="text-slate-500 dark:text-slate-400 text-sm">+</span>}
                        <kbd className="inline-flex items-center px-2 py-0.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-mono shadow-xs">
                          {key}
                        </kbd>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
