import React, { useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { useBackupStatusStore } from '../../stores/backupStatusStore'
import { MS_PER_DAY } from '../../../shared/constants'
import { parseDbTimestamp } from '../../../shared/dates'

const REFRESH_MS = 15 * 60 * 1000

function daysSince(iso: string): string {
  const n = Math.max(0, Math.floor((Date.now() - parseDbTimestamp(iso).getTime()) / MS_PER_DAY))
  return `${n} day${n === 1 ? '' : 's'}`
}

export interface BackupWarning { text: string; tone: 'red' | 'amber' }

/**
 * What to say, outside Settings, when backups aren't keeping a copy off this
 * computer; null while everything is fine. Keeps the status fresh while mounted.
 */
export function useBackupWarning(): BackupWarning | null {
  const status = useBackupStatusStore(s => s.status)
  const loadStatus = useBackupStatusStore(s => s.loadStatus)

  useEffect(() => {
    void loadStatus()
    const timer = setInterval(() => { void loadStatus() }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [loadStatus])

  if (!status) return null
  let text: string | null = null
  let tone: 'red' | 'amber' = 'amber'
  if (status.scheduled.overdue) {
    tone = 'red'
    text = status.scheduled.lastRunISO
      ? `Scheduled backup hasn't worked for ${daysSince(status.scheduled.lastRunISO)}`
      : 'Scheduled backup isn\'t working'
  } else if (status.offsiteOverdue) {
    text = status.lastOffsiteISO
      ? `Last backup to another place: ${daysSince(status.lastOffsiteISO)} ago`
      : 'No backup saved to another place yet'
  }
  return text ? { text, tone } : null
}

/** The warning as a link to Backup settings (the status bar puts any separator before it) */
export function BackupWarningButton({ warning }: { warning: BackupWarning }): React.ReactElement {
  const { text, tone } = warning
  const color = tone === 'red' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
  return (
      <button
        type="button"
        className={`hit-44 flex items-center gap-1.5 text-sm underline ${color}`}
        onClick={() => { window.location.hash = '#/settings?tab=backup' }}
        title="Open backup settings"
      >
        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{text}</span>
      </button>
  )
}

/** Shows when backups aren't keeping a copy off this computer. Quiet while everything is fine. */
export function BackupStatusChip(): React.ReactElement | null {
  const warning = useBackupWarning()
  return warning ? <BackupWarningButton warning={warning} /> : null
}
