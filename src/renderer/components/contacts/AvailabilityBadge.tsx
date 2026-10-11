import type { AvailabilityStatus } from '../../../shared/types'
import { MS_PER_DAY } from '../../../shared/constants'
import { parseDbTimestamp } from '../../../shared/dates'
import { AVAILABILITY_LABELS } from '../../../shared/availability'

const STATUS_CONFIG: Record<AvailabilityStatus, { label: string; bg: string; text: string }> = {
  accepting: { label: AVAILABILITY_LABELS.accepting, bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
  waitlist: { label: AVAILABILITY_LABELS.waitlist, bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300' },
  full: { label: AVAILABILITY_LABELS.full, bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
  unknown: { label: AVAILABILITY_LABELS.unknown, bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-500 dark:text-slate-400' },
}

interface Props {
  status: AvailabilityStatus
  checkedAt?: string | null
  compact?: boolean
}

function daysSince(dateStr: string): number {
  const then = parseDbTimestamp(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY)
}

export function AvailabilityBadge({ status, checkedAt, compact }: Props) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unknown

  let checkedLabel = ''
  let checkedColorClass = 'text-slate-500 dark:text-slate-400'

  if (checkedAt) {
    const days = daysSince(checkedAt)
    if (days === 0) checkedLabel = 'Checked today'
    else if (days === 1) checkedLabel = 'Checked yesterday'
    else checkedLabel = `Checked ${days}d ago`

    if (days >= 90) checkedColorClass = 'text-red-600 dark:text-red-400'
    else if (days >= 30) checkedColorClass = 'text-amber-500 dark:text-amber-400'
  }

  return (
    <div className="inline-flex flex-col gap-0.5">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
      {!compact && checkedAt && (
        <span className={`text-sm ${checkedColorClass}`}>{checkedLabel}</span>
      )}
    </div>
  )
}
