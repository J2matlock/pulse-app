import React, { useId } from 'react'
import { BellOff, Plus } from 'lucide-react'
import type { Column, ParsedAlertRule } from '../../../shared/types'
import { ruleSummary } from '../../../shared/ruleSummary'
import { RuleColorKey } from '../alerts/RuleColorKey'
import { Dialog } from '../ui/Dialog'
import { SecondaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'

export interface ColumnRuleDialogProps {
  column: Column
  /** Every column of the list, to name the ones a rule reads */
  allColumns: Column[]
  currentAlertRule: ParsedAlertRule | undefined
  /** Rules that can work on this list's columns (the current one always included) */
  fittingRules: ParsedAlertRule[]
  /** Rules that read columns this list doesn't have, listed but not offered */
  otherListRules: ParsedAlertRule[]
  onSetRule: (ruleId: number | null) => void
  onNewRule: () => void
  onClose: () => void
}

/**
 * "Deadline rule…" for a date column (B-12): the rule it uses with its color key,
 * the other rules as a radio list, a new rule, or none. Changing or deleting a
 * rule itself lives in Settings → Deadlines & reminders, since a rule can be
 * shared by several columns.
 */
export function ColumnRuleDialog({
  column, allColumns, currentAlertRule, fittingRules, otherListRules, onSetRule, onNewRule, onClose,
}: ColumnRuleDialogProps): React.ReactElement {
  const { t } = useVocab()
  const titleId = useId()
  const columnName = (id: number) => allColumns.find(c => c.id === id)?.name
  const others = fittingRules.filter(r => r.id !== currentAlertRule?.id)

  return (
    <Dialog open onClose={onClose} title={<>Deadline rule for “{column.name}”</>} size="lg"
      footer={<SecondaryButton onClick={onClose}>Close</SecondaryButton>}>
      <div className="space-y-5">
        {currentAlertRule ? (
          <section aria-labelledby={`${titleId}-current`}>
            <h3 id={`${titleId}-current`} className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">This column uses</h3>
            <div className="rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3 space-y-2">
              <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{currentAlertRule.name}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">{ruleSummary(currentAlertRule, columnName)}</p>
              <RuleColorKey rule={currentAlertRule} compact shapes />
            </div>
            <button type="button"
              className="hit-44 mt-2 flex items-center gap-2 px-2 py-1.5 text-base text-slate-700 dark:text-slate-300 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={() => onSetRule(null)}>
              <BellOff className="w-4 h-4" />
              Remove from this column
            </button>
          </section>
        ) : (
          <p className="text-base text-slate-700 dark:text-slate-200">
            This column has no deadline rule, so its dates show without colors. Choose a rule and its cells turn color as each date comes close.
          </p>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
            {currentAlertRule ? 'Use a different rule' : 'Choose a rule'}
          </legend>
          {others.length === 0 && (
            <p className="px-1 py-1.5 text-base text-slate-500 dark:text-slate-400">
              {fittingRules.length === 0 ? 'No deadline rules yet. Make one below.' : 'No other rules yet. Make one below.'}
            </p>
          )}
          <div className="space-y-0.5">
            {others.map(rule => (
              <label key={rule.id} className="flex items-start gap-3 px-2 py-2 min-h-[44px] rounded-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700">
                <input type="radio" name={`${titleId}-rule`} className="mt-1 w-5 h-5 flex-shrink-0" checked={false}
                  onChange={() => onSetRule(rule.id)} />
                <span className="min-w-0">
                  <span className="block text-base text-slate-800 dark:text-slate-100">{rule.name}</span>
                  <span className="block text-sm text-slate-600 dark:text-slate-300">{ruleSummary(rule, columnName)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button type="button"
          className="hit-44 flex items-center gap-2 px-2 py-1.5 text-base text-blue-700 dark:text-blue-300 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={onNewRule}>
          <Plus className="w-4 h-4" />
          New rule…
        </button>

        {otherListRules.length > 0 && (
          <details>
            <summary className="hit-44 flex items-center px-1 py-1.5 text-base text-slate-600 dark:text-slate-300 cursor-pointer rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700">
              Rules from other {t('list', { many: true })} (won't work here)
            </summary>
            <ul className="pl-3">
              {otherListRules.map(rule => (
                <li key={rule.id} className="px-2 py-1.5 text-base text-slate-500 dark:text-slate-400 truncate" title={`This rule reads columns this ${t('list')} doesn't have`}>
                  {rule.name}
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-sm text-slate-500 dark:text-slate-400">
          To change or delete a rule itself, go to Settings → Deadlines &amp; reminders. A rule can be shared by several columns.
        </p>
      </div>
    </Dialog>
  )
}
