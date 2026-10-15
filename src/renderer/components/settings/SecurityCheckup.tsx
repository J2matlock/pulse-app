import React, { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useSettingsStore } from '../../stores/settingsStore'
import { detectCloudSyncService } from '../../../shared/cloudSync'
import { SecuritySummaryDialog } from '../shared/SecuritySummaryDialog'
import { useFeature } from '../../hooks/useFeature'
import { formatBytes } from '../../../shared/attachments'
import { SecondaryButton } from '../ui/Button'

interface Check {
  ok: boolean
  /** The current state in words ("No recovery key yet"), never the name of the check */
  label: string
  /** What to do when not ok */
  fix?: string
  action?: { label: string; onClick: () => void }
}

/** Element ids of the controls a failing check points at (set in SecuritySection) */
export const CHECKUP_TARGETS = {
  recoveryKey: 'settings-recovery-key',
  autoLock: 'settings-auto-lock',
} as const

/** Scroll the Settings panel to a control and give it focus, so the fix is right under the mouse */
function scrollToControl(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const target = el.matches('button, input, select, textarea, a') ? el : el.querySelector<HTMLElement>('button, input, select, textarea')
  target?.focus({ preventScroll: true })
}

/**
 * Live version of the "recommended setup" checklist, so a worker can see at a
 * glance whether their setup is what their supervisor would expect.
 */
export function SecurityCheckup({ hasRecovery, recoveryUsed = false, onMakeRecoveryKey, onGoToBackup }: {
  hasRecovery: boolean | null
  /** The recovery key has unlocked Pulse once: someone has seen it, so suggest a new one */
  recoveryUsed?: boolean
  onMakeRecoveryKey?: () => void
  onGoToBackup?: () => void
}): React.ReactElement {
  const autoLockMinutes = useSettingsStore(s => s.autoLockMinutes)
  const [backup, setBackup] = useState<{ enabled: boolean; destinationDir: string; lastError?: string | null } | null>(null)
  const [dbPath, setDbPath] = useState<string | null>(null)
  const filesOn = useFeature('attachments')
  const [files, setFiles] = useState<{ bytes: number; limitBytes: number } | null>(null)
  const [showSummary, setShowSummary] = useState(false)

  useEffect(() => {
    void safeInvoke<{ enabled: boolean; destinationDir: string; lastError?: string | null }>(IPC.BACKUP_SCHEDULED_GET_CONFIG).then(r => { if (r.ok) setBackup(r.data) })
    void safeInvoke<{ dbPath: string }>(IPC.BACKUP_GET_INFO).then(r => { if (r.ok) setDbPath(r.data.dbPath) })
  }, [])
  useEffect(() => {
    if (!filesOn) return
    void safeInvoke<{ bytes: number; limitBytes: number }>(IPC.ATTACHMENT_USAGE).then(r => { if (r.ok) setFiles(r.data) })
  }, [filesOn])

  const dataDir = dbPath ? dbPath.replace(/[\\/][^\\/]+$/, '') : null
  const backupBesideData = !!(backup?.enabled && dataDir && backup.destinationDir.startsWith(dataDir))
  const cloud = dbPath ? detectCloudSyncService(dbPath) : null
  const backupFailing = !!(backup?.enabled && backup.lastError)

  const usedKey = hasRecovery === true && recoveryUsed
  const checks: Check[] = [
    usedKey ? {
      ok: false,
      label: 'Your recovery key was used',
      fix: 'Make a new one, so a lost password can be recovered again.',
      action: { label: 'Make a new recovery key', onClick: onMakeRecoveryKey ?? (() => scrollToControl(CHECKUP_TARGETS.recoveryKey)) },
    } : {
      ok: hasRecovery === true,
      label: hasRecovery === true ? 'Recovery key saved' : hasRecovery === null ? 'Checking for a recovery key…' : 'No recovery key yet',
      fix: 'Without one, a forgotten password means losing your data. Create it below and store it somewhere safe.',
      action: { label: 'Create one below', onClick: () => scrollToControl(CHECKUP_TARGETS.recoveryKey) },
    },
    {
      ok: autoLockMinutes <= 15,
      label: autoLockMinutes <= 15 ? `Auto-lock after ${autoLockMinutes} minutes` : `Auto-lock waits ${autoLockMinutes} minutes`,
      fix: 'Most organizations expect 15 minutes or less.',
      action: { label: 'Change it below', onClick: () => scrollToControl(CHECKUP_TARGETS.autoLock) },
    },
    {
      ok: !!backup?.enabled && !backupBesideData && !backupFailing,
      label: backupFailing
        ? 'Scheduled backups aren\'t working'
        : backup?.enabled ? (backupBesideData ? 'Scheduled backups go to the same folder as your data' : 'Scheduled backups are on') : 'Scheduled backups are off',
      fix: backupFailing
        ? `${backup!.lastError} Check the backup folder, then use "Run now" to test it.`
        : 'Back up to a different drive (a work network folder or an encrypted USB), so one failure can\'t take both.',
      action: onGoToBackup ? { label: 'Backup settings', onClick: onGoToBackup } : undefined,
    },
    {
      ok: !cloud,
      label: cloud ? `Your Pulse data folder is inside ${cloud}` : 'Data folder is not in a cloud folder',
      fix: cloud ? `Cloud sync can corrupt the database and copies your data off this computer. Move the Pulse folder out of ${cloud}.` : undefined,
    },
  ]
  // Files live inside the database, so a nearly full allowance means big, slow backups too
  if (filesOn && files && files.bytes > 0) {
    checks.push({
      ok: files.bytes < files.limitBytes * 0.9,
      label: `Files are using ${formatBytes(files.bytes)} of ${formatBytes(files.limitBytes)}`,
      fix: 'Remove files you no longer need and empty the files trash in Settings → Data, or raise the limit there.',
    })
  }
  const passed = checks.filter(c => c.ok).length

  return (
    <div className="rounded-lg border-2 border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" aria-hidden="true" />
        <p className="text-base font-semibold text-slate-800 dark:text-slate-100 flex-1">Security checkup: {passed} of {checks.length}</p>
        <SecondaryButton size="compact" onClick={() => setShowSummary(true)}>Security summary to share</SecondaryButton>
      </div>
      <ul className="space-y-2">
        {checks.map(c => (
          <li key={c.label} className="flex items-start gap-2">
            {c.ok
              ? <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" aria-label="Done" />
              : <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" aria-label="Needs attention" />}
            <div className="min-w-0">
              <p className="text-base text-slate-800 dark:text-slate-100">{c.label}</p>
              {!c.ok && c.fix && <p className="text-sm text-slate-600 dark:text-slate-300">{c.fix}</p>}
              {!c.ok && c.action && (
                <button type="button" className="hit-44 text-base text-blue-700 dark:text-blue-300 underline" onClick={c.action.onClick}>{c.action.label}</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <SecuritySummaryDialog open={showSummary} onClose={() => setShowSummary(false)} />
    </div>
  )
}
