import React, { useId, useState } from 'react'
import { Printer } from 'lucide-react'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'

export interface ProfileSections {
  gridData: boolean
  deadlines: boolean
  checklist: boolean
  caseLog: boolean
  contactInfo: boolean
  scratchPad: boolean
  /** With caseLog: every note, not only the 10 most recent (C-21) */
  allNotes: boolean
}

/** Scrap notes stay out unless asked for: they're private jottings and the PDF leaves the app. */
export const DEFAULT_PROFILE_SECTIONS: ProfileSections = {
  gridData: true, deadlines: true, checklist: true, caseLog: true, contactInfo: true, scratchPad: false, allNotes: false,
}

type SectionKey = Exclude<keyof ProfileSections, 'allNotes'>

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
  const [sections, setSections] = useState<ProfileSections>({ ...DEFAULT_PROFILE_SECTIONS, checklist: checklistsOn })
  const howManyId = useId()

  const options: Array<[SectionKey, string]> = [
    ['gridData', `${t('record', { cap: true })} details`],
    ['deadlines', 'Deadlines'],
    ...(checklistsOn ? [['checklist', 'Open checklist items'] as [SectionKey, string]] : []),
    ['caseLog', t('activity', { many: true, cap: true })],
    ['contactInfo', 'Extra phone numbers and emails'],
    ['scratchPad', 'Scratch notes'],
  ]
  const nothing = options.every(([k]) => !sections[k])
  const notesOff = !sections.caseLog

  return (
    <Dialog open onClose={onClose} title={`Print or save: ${clientName}`}
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        {onPrint && (
          <SecondaryButton icon={<Printer className="w-4 h-4" />} disabled={nothing} onClick={() => onPrint(sections)}>Print…</SecondaryButton>
        )}
        <PrimaryButton disabled={nothing} onClick={() => onSave(sections)}>Save PDF…</PrimaryButton>
      </>}>
      <fieldset>
        <legend className="text-base font-medium text-slate-800 dark:text-slate-100 mb-1">What to include</legend>
        {options.map(([key, label]) => (
          <React.Fragment key={key}>
            <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
              <input type="checkbox" className="w-5 h-5" checked={sections[key]}
                onChange={e => setSections(s => ({ ...s, [key]: e.target.checked }))} />
              {label}
            </label>
            {/* How many notes: the last 10, or all of them for a full record (C-21) */}
            {key === 'caseLog' && (
              <div role="radiogroup" aria-label={`Which ${t('activity', { many: true })}`} aria-disabled={notesOff || undefined} className="ml-8">
                {([[false, 'The 10 most recent'], [true, 'All of them']] as const).map(([all, text]) => (
                  <label key={text} className={`flex items-center gap-2 min-h-[44px] text-base ${notesOff
                    ? 'text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    : 'text-slate-700 dark:text-slate-200 cursor-pointer'}`}>
                    <input type="radio" className="w-5 h-5" name={howManyId} disabled={notesOff}
                      checked={sections.allNotes === all}
                      onChange={() => setSections(s => ({ ...s, allNotes: all }))} />
                    {text}
                  </label>
                ))}
              </div>
            )}
          </React.Fragment>
        ))}
      </fieldset>
    </Dialog>
  )
}
