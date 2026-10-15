import React, { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useAlertStore, describeRuleUsage } from '../../stores/alertStore'
import type { ParsedAlertRule } from '../../../shared/types'

interface Props {
  rule: ParsedAlertRule | null
  onDone: () => void
}

/**
 * Deletes a deadline rule. A rule no column uses goes at once, with the Undo
 * toast (Q4). A rule columns use asks first and lists them, because those
 * columns stop being deadlines somewhere the user can't see from here (the
 * dependents rule); that delete unlinks them all at once and can be undone too.
 */
export function DeleteRuleConfirm({ rule, onDone }: Props): React.ReactElement {
  const usage = useAlertStore(s => s.usage)
  const uses = rule ? usage.filter(u => u.rule_id === rule.id) : []
  const deleteRule = useAlertStore(s => s.deleteRule)
  const loadUsage = useAlertStore(s => s.loadUsage)
  // The rule whose question is showing; null while its columns are being checked
  const [asking, setAsking] = useState<number | null>(null)
  // The caller's onDone is often a new function each render; only a new rule starts the check
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    setAsking(null)
    if (!rule) return
    let live = true
    void (async () => {
      // Columns may have changed since the rules were loaded
      await loadUsage()
      if (!live) return
      const usedBy = useAlertStore.getState().usage.some(u => u.rule_id === rule.id)
      if (usedBy) { setAsking(rule.id); return }
      await deleteRule(rule.id)
      if (live) onDoneRef.current()
    })()
    return () => { live = false }
  }, [rule, loadUsage, deleteRule])

  const shown = uses.slice(0, 6)
  return (
    <ConfirmDialog
      open={rule != null && asking === rule.id}
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
