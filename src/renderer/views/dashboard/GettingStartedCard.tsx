/**
 * "Getting started" (audit 2.9 / F-12, F-32): five first steps for a new
 * workspace that tick themselves off as they happen. Dismissed once for
 * good; a skipped recovery key can be put off for a week.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { localDateString } from '../../../shared/dates'
import { safeInvoke } from '../../utils/safeInvoke'
import { useVocab } from '../../hooks/useVocab'
import { snoozeUntil } from '../../hooks/useBackupReminder'

interface Progress {
  show: boolean
  record: boolean
  reminder: boolean
  note: boolean
  backup: boolean
  recoveryKey: boolean
  recoverySnoozedUntil: string | null
}


export function GettingStartedCard(): React.ReactElement | null {
  const { t } = useVocab(null)
  const navigate = useNavigate()
  const [p, setP] = useState<Progress | null>(null)

  const load = useCallback(async () => {
    const [gs, key, backup] = await Promise.all([
      safeInvoke(IPC.ONBOARDING_GETTING_STARTED),
      safeInvoke(IPC.AUTH_HAS_RECOVERY_KEY),
      safeInvoke(IPC.BACKUP_SCHEDULED_GET_CONFIG),
    ])
    if (!gs.ok) { setP(null); return }
    const backupOn = backup.ok && typeof backup.data === 'object' && backup.data !== null && (backup.data as { enabled?: unknown }).enabled === true
    setP({ ...gs.data, backup: backupOn, recoveryKey: key.ok && key.data === true })
  }, [])

  useEffect(() => { void load() }, [load])

  if (!p || !p.show) return null
  const recoverySnoozed = !!p.recoverySnoozedUntil && p.recoverySnoozedUntil > localDateString()
  const openList = `Open your ${t('list')}`
  const steps = [
    { done: p.record, label: `Add your first ${t('record')}`, action: openList, go: () => navigate('/grid') },
    { done: p.reminder, label: 'Put in a date that has a reminder, and see it change color as it comes due', action: openList, go: () => navigate('/grid') },
    { done: p.note, label: `Write your first ${t('activity')}`, action: openList, go: () => navigate('/grid') },
    { done: p.backup, label: 'Choose where backups go', action: 'Set up backups', go: () => navigate('/settings?tab=backup') },
    ...(recoverySnoozed && !p.recoveryKey ? [] : [{
      done: p.recoveryKey, label: 'Save a recovery key (1 minute). Without it, a forgotten password means losing your data.',
      action: 'Save a recovery key', go: () => navigate('/settings?tab=security'), later: true,
    }]),
  ]
  if (steps.every(s => s.done)) return null

  async function dismiss() {
    setP(null)
    await safeInvoke(IPC.SETTINGS_UPDATE, 'onboarding_getting_started_dismissed', '1')
  }
  async function later() {
    const until = snoozeUntil()
    setP(prev => prev && { ...prev, recoverySnoozedUntil: until })
    await safeInvoke(IPC.SETTINGS_UPDATE, 'onboarding_recovery_snooze_until', until)
  }

  return (
    <section aria-labelledby="getting-started-title" className="mb-6 p-5 rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
      <div className="flex items-start gap-3 mb-3">
        <h2 id="getting-started-title" className="flex-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Getting started</h2>
        <button type="button" onClick={() => void dismiss()} aria-label="Hide getting started"
          className="hit-44 p-2 rounded-sm text-slate-600 dark:text-slate-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      <ul className="space-y-2">
        {steps.map(s => (
          <li key={s.label} className="flex flex-wrap items-center gap-3" style={{ minHeight: 44 }}>
            {s.done
              ? <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" aria-hidden="true" />
              : <Circle className="w-5 h-5 text-slate-400 flex-shrink-0" aria-hidden="true" />}
            <span className={`flex-1 min-w-0 text-base ${s.done ? 'text-slate-500 dark:text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>
              {s.label}<span className="sr-only">{s.done ? ' (done)' : ''}</span>
            </span>
            {!s.done && (
              <span className="flex gap-2">
                {'later' in s && s.later && (
                  <button type="button" className="btn-compact-secondary" onClick={() => void later()}>Remind me in a week</button>
                )}
                <button type="button" className="btn-compact-secondary" onClick={s.go}>{s.action}</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
