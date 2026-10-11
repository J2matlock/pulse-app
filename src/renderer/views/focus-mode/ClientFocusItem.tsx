import React from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { FocusItem } from './types'
import { useVocab } from '../../hooks/useVocab'

export const ClientFocusItem = React.memo(function ClientFocusItem({ item, celebrating, onComplete, onNavigate }: {
  item: FocusItem
  celebrating: boolean
  onComplete: () => void
  onNavigate: () => void
}): React.ReactElement {
  const { t } = useVocab(item.gridId)
  const urgencyDot = item.urgency === 'overdue'
    ? 'bg-red-500'
    : item.urgency === 'today'
    ? 'bg-orange-400'
    : 'bg-yellow-400'

  const daysLabel = item.daysUntil < 0
    ? `${Math.abs(item.daysUntil)} day${Math.abs(item.daysUntil) === 1 ? '' : 's'} overdue`
    : item.daysUntil === 0
    ? 'Due today'
    : `${item.daysUntil} day${item.daysUntil === 1 ? '' : 's'} away`

  const daysColor = item.urgency === 'overdue'
    ? 'text-red-400'
    : item.urgency === 'today'
    ? 'text-orange-400'
    : 'text-yellow-400'

  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 ${celebrating ? 'celebrating' : ''}`}
      style={{ minHeight: 64 }}
    >
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${urgencyDot}`} />
      <div className="flex-1 min-w-0">
        <button onClick={onNavigate} title={item.clientName} className="hit-44 block max-w-full font-medium text-white truncate hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400 rounded-sm">{item.clientName}</button>
        <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
          {item.label}
          {item.subLabel && <span className="ml-2 text-slate-500">· {item.subLabel}</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-sm font-medium ${daysColor}`}>{daysLabel}</span>
          <span className="text-slate-600 text-sm">·</span>
          <span className="text-sm text-slate-500">{item.dueDateStr}</span>
        </div>
      </div>
      <button
        onClick={onComplete}
        disabled={celebrating}
        title={item.ruleKind === 'quota' ? `Open the ${t('record')} to set new dates and how many are allowed`
          : item.ruleKind === 'meter' ? 'Mark done: asks for the current reading' : undefined}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-base font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-green-400 disabled:opacity-50"
        style={{ minHeight: 44 }}
      >
        <CheckCircle2 className="w-4 h-4" />
        {item.ruleKind === 'quota' ? 'Renew…' : 'Done ✓'}
      </button>
    </div>
  )
})
