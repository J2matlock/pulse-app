import React from 'react'
import { Bell, BellOff, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ParsedAlertRule } from '../../../shared/types'
import { RuleColorKey } from '../alerts/RuleColorKey'
import { useVocab } from '../../hooks/useVocab'

export interface ColumnRulePickerProps {
  currentAlertRule: ParsedAlertRule | undefined
  currentAlertRuleId: number | null
  /** Any deadline rule exists at all */
  hasAnyRule: boolean
  /** Rules that can work on this list's columns (the current one always included) */
  fittingRules: ParsedAlertRule[]
  /** Rules that read columns this list doesn't have, listed but not offered */
  otherListRules: ParsedAlertRule[]
  onSetRule: (ruleId: number | null) => void
  onEditRule: (rule: ParsedAlertRule) => void
  onDeleteRule: (rule: ParsedAlertRule) => void
  onNewRule: () => void
}

/** The column menu's deadline rule list: pick, edit, delete or make a rule for this column */
export function ColumnRulePicker({
  currentAlertRule, currentAlertRuleId, hasAnyRule, fittingRules, otherListRules, onSetRule, onEditRule, onDeleteRule, onNewRule,
}: ColumnRulePickerProps): React.ReactElement {
  const { t } = useVocab()
  return (
        <div className="px-2 pb-2">
          {currentAlertRule && (
            <div className="px-2 py-1.5 mb-1 rounded-sm bg-slate-50 dark:bg-slate-900/40">
              <RuleColorKey rule={currentAlertRule} compact />
            </div>
          )}
          {currentAlertRule && (
            <button
              className="hit-44 flex items-center gap-2 w-full px-2 py-1.5 text-base text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-sm"
              onClick={() => onSetRule(null)}
            >
              <BellOff className="w-3.5 h-3.5" />
              Remove deadline rule
            </button>
          )}
          {!hasAnyRule && !currentAlertRule && (
            <p className="px-2 py-1.5 text-sm text-slate-500 dark:text-slate-400">
              No deadline rules yet.
            </p>
          )}
          {fittingRules.map(rule => (
            <div
              key={rule.id}
              className={`flex items-center gap-1 w-full rounded-sm ${
                rule.id === currentAlertRuleId
                  ? 'bg-blue-50 dark:bg-blue-900/40'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <button
                className={`hit-44 flex items-center gap-2 flex-1 px-2 py-1.5 text-base text-left min-w-0 ${
                  rule.id === currentAlertRuleId
                    ? 'text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
                onClick={() => onSetRule(rule.id)}
              >
                <Bell className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{rule.name}</span>
              </button>
              <button
                className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-blue-500 rounded-sm flex-shrink-0"
                title="Edit rule"
                aria-label="Edit rule"
                onClick={e => { e.stopPropagation(); onEditRule(rule) }}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-sm flex-shrink-0 mr-1"
                title="Delete rule"
                aria-label="Delete rule"
                onClick={e => {
                  e.stopPropagation()
                  onDeleteRule(rule)
                }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {otherListRules.length > 0 && (
            <details className="mt-1">
              <summary className="hit-44 flex items-center px-2 py-1.5 text-base text-slate-600 dark:text-slate-300 cursor-pointer rounded-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                Rules from other {t('list', { many: true })} (won't work here)
              </summary>
              <ul className="pl-2">
                {otherListRules.map(rule => (
                  <li key={rule.id} className="px-2 py-1.5 text-base text-slate-500 dark:text-slate-400 truncate" title={`This rule reads columns this ${t('list')} doesn't have`}>
                    {rule.name}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <hr className="my-1 border-slate-200 dark:border-slate-700" />
          <button
            className="hit-44 flex items-center gap-2 w-full px-2 py-1.5 text-base text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-sm"
            onClick={onNewRule}
          >
            <Plus className="w-3.5 h-3.5" />
            New deadline rule…
          </button>
        </div>
  )
}
