import React, { useEffect } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useAlertStore, describeRuleUsage } from '../../stores/alertStore'
import type { ParsedAlertRule } from '../../../shared/types'

interface Props {
  rule: ParsedAlertRule | null
  onDone: () => void
}

/**
 * Asks before deleting a deadline rule, saying which columns use it. The
 * delete unlinks all of them at once and can be undone.
 */
export function DeleteRuleConfirm({ rule, onDone }: Props): React.ReactElement {
  const usage = useAlertStore(s => s.usage)
  const uses = rule ? usage.filter(u => u.rule_id === rule.id) : []
  const deleteRule = useAlertStore(s => s.deleteRule)
  const loadUsage = useAlertStore(s => s.loadUsage)
  // Columns may have changed since the rules were loaded
  useEffect(() => { if (rule) void loadUsage() }, [rule, loadUsage])
  const shown = uses.slice(0, 6)
  return (
    <ConfirmDialog
      open={rule != null}
      title={`Delete deadline rule "${rule?.name ?? ''}"?`}
      message={`${describeRuleUsage(uses)}${uses.length ? ' Those columns keep their dates, but they stop being deadlines.' : ''} You can undo this.`}
      confirmLabel="Delete rule"
      onConfirm={async () => {
        if (rule) await deleteRule(rule.id)
        onDone()
      }}
      onCancel={onDone}
    >
      {shown.length > 0 && (
        <ul className="mt-2 text-base text-slate-600 dark:text-slate-300 list-disc pl-5" aria-label="Columns that use this rule">
          {shown.map(u => <li key={u.column_id}>{u.column_name} <span className="text-slate-500 dark:text-slate-400">({u.grid_name})</span></li>)}
          {uses.length > shown.length && <li>and {uses.length - shown.length} more</li>}
        </ul>
      )}
    </ConfirmDialog>
  )
}
