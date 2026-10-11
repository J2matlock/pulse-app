import React, { useState } from 'react'
import { NotebookPen } from 'lucide-react'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'

/**
 * Column-menu setting for date columns: which case-note types set this date
 * to the note's date (e.g. "Last Face-to-Face" follows Visit notes).
 */
export function NoteUpdatePicker({ value, onChange }: {
  value: string[]
  onChange: (types: string[]) => void
}): React.ReactElement {
  const { t } = useVocab()
  const activity = useActivityTypes()
  const [open, setOpen] = useState(false)
  // Active types, plus archived ones this column still follows
  const options = activity.all
    .filter(type => !type.is_archived || value.includes(type.key))
    .map(type => ({ value: type.key, label: type.is_archived ? `${type.label} (archived)` : type.label }))
  const summary = value.length === 0 ? 'Off' : value.map(k => activity.label(k)).join(', ')

  function toggle(type: string) {
    onChange(value.includes(type) ? value.filter(t => t !== type) : [...value, type])
  }

  return (
    <>
      <button type="button" aria-expanded={open}
        className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
        onClick={() => setOpen(v => !v)}>
        <NotebookPen className="w-4 h-4 text-blue-500" />
        <span className="flex-1 text-left">Update from {t('activity', { many: true })}</span>
        <span className="text-sm text-blue-600 dark:text-blue-400 truncate max-w-24">{summary}</span>
      </button>
      {open && (
        <fieldset className="px-3 pb-2">
          <legend className="text-sm text-slate-600 dark:text-slate-300 pb-1">
            When I log one of these, set this date to the day of the {t('activity')}:
          </legend>
          {options.map(o => (
            <label key={o.value} className="flex items-center gap-2 min-h-[44px] px-1 text-base text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" className="w-5 h-5" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
    </>
  )
}
