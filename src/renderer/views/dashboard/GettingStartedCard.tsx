/**
 * "Getting started" (audit 2.9 / F-12, F-32): five first steps for a new
 * workspace that tick themselves off as they happen. Dismissed once for
 * good; a skipped recovery key can be put off for a week. Once most steps
 * are done it shrinks to one line under the counts, so what's due stays on
 * the first screen (UX D-02).
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

interface Step { done: boolean; label: string; action: string; go: () => void; later?: boolean }

export interface GettingStarted {
  /** Nothing to show: never set up here, dismissed, or every step done */
  visible: boolean
  /** Most steps done: one line below the counts instead of the full card */
  compact: boolean
  steps: Step[]
  dismiss: () => Promise<void>
  later: () => Promise<void>
}

/** Three of the four first steps done: the card gets out of the way */
export const COMPACT_AFTER_DONE = 3

export function useGettingStarted(): GettingStarted {
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

  const dismiss = useCallback(async () => {
    setP(null)
    await safeInvoke(IPC.SETTINGS_UPDATE, 'onboarding_getting_started_dismissed', '1')
  }, [])
  const later = useCallback(async () => {
    const until = snoozeUntil()
    setP(prev => prev && { ...prev, recoverySnoozedUntil: until })
    await safeInvoke(IPC.SETTINGS_UPDATE, 'onboarding_recovery_snooze_until', until)
  }, [])

  if (!p || !p.show) return { visible: false, compact: false, steps: [], dismiss, later }
  const recoverySnoozed = !!p.recoverySnoozedUntil && p.recoverySnoozedUntil > localDateString()
  const openList = `Open your ${t('list')}`
  const steps: Step[] = [
    { done: p.record, label: `Add your first ${t('record')}`, action: openList, go: () => navigate('/grid') },
    { done: p.reminder, label: 'Add a date with a deadline rule and see it change color', action: openList, go: () => navigate('/grid') },
    { done: p.note, label: `Write your first ${t('activity')}`, action: openList, go: () => navigate('/grid') },
    { done: p.backup, label: 'Choose where backups go', action: 'Set up backups', go: () => navigate('/settings?tab=backup') },
    ...(recoverySnoozed && !p.recoveryKey ? [] : [{
      done: p.recoveryKey, label: 'Save a recovery key (1 minute). Without it, a forgotten password means losing your data.',
      action: 'Save a recovery key', go: () => navigate('/settings?tab=security'), later: true,
    }]),
  ]
  const doneCount = steps.filter(s => s.done).length
  return { visible: !steps.every(s => s.done), compact: doneCount >= COMPACT_AFTER_DONE, steps, dismiss, later }
}

export function GettingStartedCard({ state }: { state: GettingStarted }): React.ReactElement | null {
  const { visible, compact, steps, dismiss, later } = state
  if (!visible) return null

  const hideButton = (
    <button type="button" onClick={() => void dismiss()} aria-label="Hide getting started"
      className="hit-44 p-2 rounded-sm text-slate-600 dark:text-slate-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
      <X className="w-5 h-5" aria-hidden="true" />
    </button>
  )

  if (compact) {
    const left = steps.filter(s => !s.done)
    return (
      <section aria-labelledby="getting-started-title" className="mb-6 px-4 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="getting-started-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Getting started: {left.length} {left.length === 1 ? 'step' : 'steps'} left
        </h2>
        {left.map(s => (
          <button key={s.label} type="button" className="hit-44 text-base text-blue-700 dark:text-blue-300 underline hover:no-underline rounded-sm focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            style={{ minHeight: 44 }} onClick={s.go}>
            {s.action}
          </button>
        ))}
        <span className="ml-auto">{hideButton}</span>
      </section>
    )
  }

  return (
    <section aria-labelledby="getting-started-title" className="mb-6 p-6 rounded-lg bg-blue-50 dark:bg-blue-900/20">
      <div className="flex items-start gap-3 mb-3">
        <h2 id="getting-started-title" className="flex-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Getting started</h2>
        {hideButton}
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
                {s.later && (
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
