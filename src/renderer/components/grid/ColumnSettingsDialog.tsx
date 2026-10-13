import React, { useRef } from 'react'
import { Activity, Asterisk, CalendarDays, Columns3, Link2, List, Palette } from 'lucide-react'
import type { Column, ParsedAlertRule } from '../../../shared/types'
import { takesDeadlineRule } from '../../../shared/types'
import { canBeRequired } from '../../../shared/requiredFields'
import { canBeStage, stageConfigOf } from '../../../shared/stages'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useFeature } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { DoneChecklistPicker } from './DoneChecklistPicker'
import { NoteUpdatePicker } from './NoteUpdatePicker'
import { CalendarColumnSwitch } from './CalendarColumnSwitch'

export interface ColumnSettingsDialogProps {
  column: Column
  /** The column's parsed config */
  colConfig: Record<string, unknown> & { log_changes?: boolean; required?: boolean; date_only?: boolean; note_updates?: unknown; done_checklist_id?: number | null }
  /** A link column whose link type was found: its settings can open */
  hasLinkType: boolean
  currentAlertRule: ParsedAlertRule | undefined
  onClose: () => void
  onToggleLogChanges: () => void
  onToggleRequired: () => void
  onToggleDateOnly: () => void
  onOpenColorRules: () => void
  onOpenEditOptions: () => void
  onOpenStageSettings: () => void
  onOpenLinkSettings: () => void
  onNoteUpdatesChange: (types: string[]) => void
  onDoneChecklistChange: (templateId: number | null) => void
}

/** Column settings (G-21): required, choices, colors, changes in notes, stage, links, deadline extras */
export function ColumnSettingsDialog({
  column, colConfig, hasLinkType, currentAlertRule, onClose, onToggleLogChanges, onToggleRequired, onToggleDateOnly, onOpenColorRules,
  onOpenEditOptions, onOpenStageSettings, onOpenLinkSettings, onNoteUpdatesChange, onDoneChecklistChange,
}: ColumnSettingsDialogProps): React.ReactElement {
  const { t } = useVocab()
  const checklistsOn = useFeature('checklists')
  const stagesOn = useFeature('stages')
  // A modal: focus goes in, Tab stays in, Escape closes, focus comes back (AUDIT-047)
  const settingsRef = useRef<HTMLDivElement>(null)
  useFocusTrap(settingsRef, true, { onEscape: onClose })
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={`col-settings-${column.id}`}>
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div ref={settingsRef} className="relative w-full max-w-md max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4">
        <h2 id={`col-settings-${column.id}`} className="text-lg font-semibold text-slate-800 dark:text-slate-100 px-3 mb-2">“{column.name}” settings</h2>
        <div onClick={e => { if ((e.target as HTMLElement).closest('button[data-opens]')) onClose() }}>
        <button
          className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={onToggleLogChanges}
        >
          <Activity className="w-4 h-4" />
          <span className="flex-1 text-left">Log changes in timeline</span>
          <span className={`text-sm font-medium ${colConfig.log_changes ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {colConfig.log_changes ? 'On' : 'Off'}
          </span>
        </button>

        {canBeRequired(column.column_type) && (
            <button
                            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={onToggleRequired}
            title="Empty cells show 'Missing' and appear in the Missing information list"
          >
            <Asterisk className="w-4 h-4" />
            <span className="flex-1 text-left">Required column</span>
            <span className={`text-sm font-medium ${colConfig.required ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {colConfig.required ? 'On' : 'Off'}
            </span>
          </button>
        )}

        {/* A date with a rule says how it stands beside the date; some lists only want the date */}
        {column.column_type === 'date' && currentAlertRule && (
          <button
            type="button"
            role="switch"
            aria-checked={colConfig.date_only === true}
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={onToggleDateOnly}
            title="Hide the words beside the date, like “in 5 days”. The color stays, and the words show when you point at the cell."
          >
            <CalendarDays className="w-4 h-4" />
            <span className="flex-1 text-left">Show only the date</span>
            <span aria-hidden="true" className={`text-sm font-medium ${colConfig.date_only ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {colConfig.date_only ? 'On' : 'Off'}
            </span>
          </button>
        )}

        {/* Its deadlines on the Calendar, or not (the Calendar's "Which deadlines…" menu writes the same setting) */}
        {takesDeadlineRule(column.column_type) && currentAlertRule && <CalendarColumnSwitch columnId={column.id} />}

        <button
          data-opens
          className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={onOpenColorRules}
        >
          <Palette className="w-4 h-4" />
          Color rules for this column…
        </button>

        {/* Edit options — only for dropdown/status columns */}
        {(column.column_type === 'dropdown' || column.column_type === 'status') && (
          <button
          data-opens
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={onOpenEditOptions}
          >
            <List className="w-4 h-4" />
            Edit options…
          </button>
        )}

        {/* Stage (W06): one status or dropdown column per list drives the board */}
        {stagesOn && canBeStage(column.column_type) && (
          <button
          data-opens
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={onOpenStageSettings}
          >
            <Columns3 className="w-4 h-4" />
            {stageConfigOf(column) ? `${t('stage', { cap: true })} settings…` : `Use as the ${t('stage')}…`}
          </button>
        )}

        {/* Link columns (W04): names, how many, or remove the link */}
        {hasLinkType && (
          <button
          data-opens
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={onOpenLinkSettings}
          >
            <Link2 className="w-4 h-4" />
            Link settings…
          </button>
        )}


        {takesDeadlineRule(column.column_type) && (
          <div className="mt-2 border-t border-slate-200 dark:border-slate-700 pt-2">
            <NoteUpdatePicker
              value={Array.isArray(colConfig.note_updates) ? colConfig.note_updates : []}
              onChange={onNoteUpdatesChange}
            />
            {currentAlertRule && checklistsOn && (
              <DoneChecklistPicker value={colConfig.done_checklist_id ?? null} onChange={onDoneChecklistChange} />
            )}
          </div>
        )}
        </div>
        <div className="flex justify-end mt-4 px-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
