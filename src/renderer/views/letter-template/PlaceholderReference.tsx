import React, { useState } from 'react'
import { Info, ChevronDown, ChevronRight } from 'lucide-react'
import { useVocab } from '../../hooks/useVocab'

/** Exported for tests/renderer/vocabStaticText.test.tsx, which checks every label and description uses word tokens */
export const PLACEHOLDER_GROUPS = [
  {
    label: '{Record} details',
    items: [
      { key: '{{name}}', desc: 'Name of the {record}' },
      { key: '{{field:Column name}}', desc: 'Any column, formatted (dates written out)' },
      { key: '{{deadline:Column name}}', desc: 'When that column is next due' },
      { key: '{{linked:Owner.Phone}}', desc: 'A column of a linked {record}' },
    ]
  },
  {
    label: 'Your Profile (Settings)',
    items: [
      { key: '{{my_name}}', desc: 'Your name' },
      { key: '{{my_title}}', desc: 'Your title' },
      { key: '{{my_org}}', desc: 'Your organization' },
      { key: '{{my_phone}}', desc: 'Your phone' },
      { key: '{{my_email}}', desc: 'Your email' },
    ]
  },
  {
    label: 'Dates',
    items: [
      { key: '{{today}}', desc: 'Today, like Oct 2, 2026' },
      { key: '{{today:long}}', desc: 'Today, like October 2, 2026' },
    ]
  }
]

export function PlaceholderReference(): React.ReactElement {
  const { f } = useVocab(null)
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left
                   bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800
                   focus:outline-hidden focus:ring-3 focus:ring-inset focus:ring-blue-500 min-h-[44px]"
      >
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <span className="text-base font-medium text-slate-700 dark:text-slate-200 flex-1">
          Placeholder Reference
        </span>
        {open
          ? <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="px-4 py-4 space-y-4 bg-white dark:bg-slate-900/30">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Use these tags in your template content. They will be replaced with real values when you generate a letter.
          </p>

          {PLACEHOLDER_GROUPS.map(group => (
            <div key={group.label}>
              <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                {f(group.label)}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {group.items.map(item => (
                  <div key={item.key} className="flex items-baseline gap-2 py-1">
                    <code className="text-sm font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      {item.key}
                    </code>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      — {f(item.desc)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
            <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Older placeholders
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Templates made before keep working: {'{{client_name}}'}, {'{{case_manager_name}}'}, {'{{today_date}}'}, {'{{dob}}'}, {'{{age}}'}, and column names written in lowercase with underscores, like {'{{annual_assessment_due}}'}.
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              A placeholder Pulse doesn't recognize is left as typed, and you'll see a note about it when you fill in the document.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
