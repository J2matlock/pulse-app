import React, { useEffect, useRef, useState } from 'react'
import { FileDown, Printer, X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'

export interface ProfileSections {
  gridData: boolean
  deadlines: boolean
  checklist: boolean
  caseLog: boolean
  contactInfo: boolean
  scratchPad: boolean
}

/** Scrap notes stay out unless asked for: they're private jottings and the PDF leaves the app. */
export const DEFAULT_PROFILE_SECTIONS: ProfileSections = {
  gridData: true, deadlines: true, checklist: true, caseLog: true, contactInfo: true, scratchPad: false,
}

/** "Print / PDF…": choose what goes on paper, then print it or save it as a PDF. */
export function ProfileExportDialog({ gridId, clientName, onSave, onPrint, onClose }: {
  gridId: number
  clientName: string
  onSave: (sections: ProfileSections) => void
  /** Print straight away (when absent, only "Save PDF…" is offered) */
  onPrint?: (sections: ProfileSections) => void
  onClose: () => void
}): React.ReactElement {
  const { t } = useVocab(gridId)
  const checklistsOn = useFeature('checklists')
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [sections, setSections] = useState<ProfileSections>({ ...DEFAULT_PROFILE_SECTIONS, checklist: checklistsOn })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const options: Array<[keyof ProfileSections, string]> = [
    ['gridData', `${t('record', { cap: true })} details`],
    ['deadlines', 'Deadlines'],
    ...(checklistsOn ? [['checklist', 'Open checklist items'] as [keyof ProfileSections, string]] : []),
    ['caseLog', `Recent ${t('activity', { many: true })} (last 10)`],
    ['contactInfo', 'Extra phone numbers and emails'],
    ['scratchPad', 'Scratch notes'],
  ]
  const nothing = options.every(([k]) => !sections[k])

  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="profile-export-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <FileDown className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="profile-export-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1 min-w-0 truncate">Print or save: {clientName}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <fieldset className="px-6 py-4">
          <legend className="text-base font-medium text-slate-800 dark:text-slate-100 mb-1">What to include</legend>
          {options.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
              <input type="checkbox" className="w-5 h-5" checked={sections[key]}
                onChange={e => setSections(s => ({ ...s, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          {onPrint && (
            <button type="button" className="btn-secondary" disabled={nothing} onClick={() => onPrint(sections)}><Printer className="w-4 h-4 inline mr-1" aria-hidden="true" />Print…</button>
          )}
          <button type="button" className="btn-primary" disabled={nothing} onClick={() => onSave(sections)}>Save PDF…</button>
        </div>
      </div>
    </div>
  )
}
