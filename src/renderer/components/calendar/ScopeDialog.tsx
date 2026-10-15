import React from 'react'
import { Dialog } from '../ui/Dialog'
import { SecondaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'

/**
 * "Only this one / This and following / All" for a repeating appointment (W07 §3).
 * Moving one to another day can't apply to "All" (past ones stay put), so
 * `dateChanged` leaves that choice out.
 */
export function ScopeDialog({ verb, onChoose, onCancel, dateChanged = false }: {
  verb: 'Change' | 'Delete'; onChoose: (scope: 'one' | 'following' | 'all') => void; onCancel: () => void; dateChanged?: boolean
}): React.ReactElement {
  const { t } = useVocab(null)
  const choice = (scope: 'one' | 'following' | 'all', text: string, hint: string) => (
    <button type="button" onClick={() => onChoose(scope)}
      className="w-full text-left rounded-lg border-2 border-slate-200 dark:border-slate-600 px-3 py-2 hover:border-blue-400 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500" style={{ minHeight: 44 }}>
      <span className="block text-base font-medium text-slate-800 dark:text-slate-100">{text}</span>
      <span className="block text-sm text-slate-500 dark:text-slate-400">{hint}</span>
    </button>
  )
  return (
    <Dialog open onClose={onCancel} size="sm" title={<>{verb} a repeating {t('appointment')}</>}
      footer={<SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>}>
      <div className="space-y-2">
        {choice('one', 'Only this one', 'The others stay as they are.')}
        {choice('following', 'This and following', verb === 'Delete' ? 'The series ends before this one.' : 'From this one on, as a new series.')}
        {!dateChanged && choice('all', 'All', verb === 'Delete' ? 'Upcoming ones go; done ones stay.' : 'Upcoming ones change; past and done ones stay.')}
      </div>
    </Dialog>
  )
}
