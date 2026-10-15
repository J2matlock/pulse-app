import React, { useEffect, useRef, useState } from 'react'
import {
  RotateCcw, FolderOpen, Play, Upload, Download, CheckCircle, Loader2, Info,
} from 'lucide-react'
import { useGridStore } from '../../stores/gridStore'
import { useUndoStore } from '../../stores/undoStore'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import toast from 'react-hot-toast'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { LoadingOverlay } from '../shared/LoadingSpinner'
import { parseDbTimestamp } from '../../../shared/dates'
import { MoveComputerWizard } from './MoveComputerWizard'
import { RestoreFromBackupForm } from '../shared/RestoreFromBackupForm'
import { useVocab } from '../../hooks/useVocab'
import { useBackupStatusStore } from '../../stores/backupStatusStore'
import { friendlyError } from '../../utils/friendlyError'
import { saveBackupArchive } from '../../utils/saveBackupArchive'

interface BackupPreviewData {
  gridCount: number
  rowCount: number
  /** When the backup was made (null when it can't be told) */
  madeAt: string | null
  appVersion: string | null
}

interface AutoBackupEntry {
  path: string
  filename: string
  timestamp: string
  sizeBytes: number
}

interface ScheduledConfig {
  enabled: boolean
  intervalHours: number
  destinationDir: string
  lastRunISO: string | null
  lastError?: string | null
  lastAttemptISO?: string | null
}

const LARGE_BACKUP_BYTES = 500 * 1024 * 1024

/** `dir` is `parent` or a folder under it (so "/data2" isn't inside "/data") */
function isInside(dir: string, parent: string): boolean {
  return dir === parent || (dir.startsWith(parent) && /^[\\/]/.test(dir.slice(parent.length)))
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

interface BackupSectionProps {
  saveSetting: (key: string, value: string) => Promise<void>
  /** Jump to another Settings section (the move wizard links to Security) */
  onGoToSection?: (section: 'security') => void
}

export function BackupSection({ saveSetting, onGoToSection }: BackupSectionProps): React.ReactElement {
  const { t } = useVocab(null)
  const [showMove, setShowMove] = useState(false)
  const [backupInfo, setBackupInfo] = useState<{ lastAuto: string | null; autoCount: number; lastAutoBackupFailed?: boolean; lastAutoBackupError?: string | null; dbSize?: number } | null>(null)
  const [autoBackups, setAutoBackups] = useState<AutoBackupEntry[]>([])
  const [scheduledConfig, setScheduledConfig] = useState<ScheduledConfig>({
    enabled: false, intervalHours: 24, destinationDir: '', lastRunISO: null
  })
  const [restoreTarget, setRestoreTarget] = useState<{ path: string; label: string } | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<{ safetyPath: string; otherPulse?: boolean } | null>(null)
  // A backup made by another Pulse, waiting for that Pulse's password or recovery key
  const [otherPulsePath, setOtherPulsePath] = useState<string | null>(null)
  const otherPulseTrapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(otherPulseTrapRef, otherPulsePath != null)
  const [runningBackup, setRunningBackup] = useState(false)
  const [runningScheduled, setRunningScheduled] = useState(false)
  // Reminders are on unless the user switched them off
  const [backupReminderEnabled, setBackupReminderEnabled] = useState(true)
  const [lastOffsiteISO, setLastOffsiteISO] = useState<string | null>(null)
  const [backupReminderDays, setBackupReminderDays] = useState(7)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [validatingDestination, setValidatingDestination] = useState(false)
  // The folder the database lives in: scheduled copies kept there defeat the point (E-11)
  const [dataDir, setDataDir] = useState<string | null>(null)
  const [backupPreview, setBackupPreview] = useState<BackupPreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const restoreResultTrapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(restoreResultTrapRef, restoreResult != null)

  // Load backup info and settings on mount
  useEffect(() => {
    async function load() {
      const res = await safeInvoke<{
        dbSize: number; totalClients: number; dbPath: string
        lastAutoBackup: string | null; autoBackupCount: number
        lastAutoBackupFailed?: boolean; lastAutoBackupError?: string | null
      }>(IPC.BACKUP_GET_INFO)
      if (res.ok) {
        setBackupInfo({ lastAuto: res.data.lastAutoBackup, autoCount: res.data.autoBackupCount, lastAutoBackupFailed: res.data.lastAutoBackupFailed, lastAutoBackupError: res.data.lastAutoBackupError, dbSize: res.data.dbSize })
        setDataDir(res.data.dbPath ? res.data.dbPath.replace(/[\\/][^\\/]+$/, '') : null)
      }
      const listRes = await safeInvoke<AutoBackupEntry[]>(IPC.BACKUP_AUTO_LIST)
      if (listRes.ok) setAutoBackups(listRes.data)
      const cfgRes = await safeInvoke<ScheduledConfig>(IPC.BACKUP_SCHEDULED_GET_CONFIG)
      if (cfgRes.ok) setScheduledConfig(cfgRes.data)
      await refreshOffsite()

      // Load reminder settings
      const settingsRes = await safeInvoke<Record<string, string>>(IPC.SETTINGS_GET_ALL)
      if (settingsRes.ok) {
        setBackupReminderEnabled(settingsRes.data.backup_reminder_enabled !== 'false')
        if (settingsRes.data.backup_reminder_days) setBackupReminderDays(Number(settingsRes.data.backup_reminder_days) || 7)
      }
    }
    load()
  }, [])

  async function refreshOffsite() {
    const statusRes = await safeInvoke(IPC.BACKUP_GET_STATUS)
    if (statusRes.ok) {
      setLastOffsiteISO(statusRes.data.lastOffsiteISO)
      useBackupStatusStore.setState({ status: statusRes.data, loadedAt: Date.now() })
    }
  }

  async function handleManualBackup() {
    setRunningBackup(true)
    try {
      const res = await saveBackupArchive()
      if (res.status === 'saved') {
        toast.success('Backup saved.')
        await refreshOffsite()
      } else if (res.status === 'failed') {
        toast.error(friendlyError(res.error, 'The backup couldn\'t be saved. Try again, or choose a different folder.'))
      }
    } finally {
      setRunningBackup(false)
    }
  }

  async function initiateRestore(path: string, label: string) {
    const verifyRes = await safeInvoke(IPC.BACKUP_VERIFY, path)
    if (verifyRes.ok && !verifyRes.data.valid && verifyRes.data.otherPulse) {
      setOtherPulsePath(path)
      return
    }
    if (!verifyRes.ok || !verifyRes.data.valid) {
      toast.error('Pulse can\'t open this file. It may be damaged, may not be a Pulse backup, or may have been made by an older Pulse on another computer (restore those on that computer).', { duration: 10000 })
      return
    }
    // Fetch preview info for the confirmation dialog
    setPreviewLoading(true)
    setBackupPreview(null)
    const previewRes = await safeInvoke<BackupPreviewData>(IPC.BACKUP_PREVIEW, path)
    if (previewRes.ok) {
      setBackupPreview(previewRes.data)
    }
    // If preview fails, we still allow restore — just without preview info
    setPreviewLoading(false)
    setRestoreTarget({ path, label })
  }

  async function executeRestore() {
    if (!restoreTarget) return
    const target = restoreTarget
    setRestoreTarget(null)
    setRestoring(true)
    try {
      const isPulseBak = target.path.endsWith('.pulse-backup')
      const channel = isPulseBak ? IPC.BACKUP_RESTORE_FILE : IPC.BACKUP_RESTORE_AUTO
      const res = await safeInvoke(channel, target.path)
      if (res.ok) {
        void useGridStore.getState().loadGridList()
        useUndoStore.getState().clear()
        setRestoreResult({ safetyPath: res.data.safetyPath })
      } else {
        // Main says why in plain words ("This file is damaged…"); your data is unchanged either way
        toast.error(friendlyError(res.error, 'Restore failed. Please try a different backup.'))
      }
    } catch {
      toast.error("We couldn't restore that backup — your data wasn't changed; try again")
    } finally {
      setRestoring(false)
    }
  }

  async function handleLoadBackupFile() {
    const dialogRes = await safeInvoke(IPC.APP_SHOW_FILE_DIALOG, {
      title: 'Select Backup File',
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!dialogRes.ok || dialogRes.data.canceled || !dialogRes.data.filePaths?.length) return
    const path = dialogRes.data.filePaths[0]!
    await initiateRestore(path, path.split(/[\\/]/).pop() ?? path)
  }

  /** The copies would sit next to the database (the default folder, or one inside the data folder) */
  const destinationBesideData = !scheduledConfig.destinationDir || (dataDir !== null && isInside(scheduledConfig.destinationDir, dataDir))

  async function handleScheduledDestinationChange(config: ScheduledConfig = scheduledConfig) {
    const dialogRes = await safeInvoke(IPC.APP_SHOW_FILE_DIALOG, {
      title: 'Where should the copies go? Pick a different drive or a network folder.',
      properties: ['openDirectory']
    })
    if (!dialogRes.ok || dialogRes.data.canceled || !dialogRes.data.filePaths?.length) return
    const dir = dialogRes.data.filePaths[0]!
    setValidationError(null)
    setValidatingDestination(true)
    const valRes = await safeInvoke<{ valid: boolean; error?: string }>(IPC.BACKUP_VALIDATE_DESTINATION, dir)
    if (!valRes.ok || !valRes.data.valid) {
      setValidationError(valRes.ok ? (valRes.data.error || 'This folder is not writable. Choose a different location.') : 'Could not validate this folder. Choose a different location.')
      setValidatingDestination(false)
      return
    }
    setValidatingDestination(false)
    saveScheduledConfig({ ...config, destinationDir: dir })
    setScheduledConfig(prev => ({ ...prev, destinationDir: dir }))
  }

  /** Turning the schedule on with the default folder asks where the copies should go straight away (E-11) */
  function toggleScheduled(enabled: boolean) {
    const next = { ...scheduledConfig, enabled }
    setScheduledConfig(next)
    saveScheduledConfig(next)
    if (enabled && destinationBesideData) void handleScheduledDestinationChange(next)
  }

  // Saved straight away: every change here is a single click, and a delayed
  // save was lost when the user switched tabs within half a second
  function saveScheduledConfig(config: ScheduledConfig) {
    void safeInvoke(IPC.BACKUP_SCHEDULED_SET_CONFIG, config).then(res => {
      if (!res.ok) toast.error('We couldn\'t save your backup settings. Try again.')
    })
  }

  function updateScheduledConfig(updates: Partial<ScheduledConfig>) {
    const next = { ...scheduledConfig, ...updates }
    setScheduledConfig(next)
    saveScheduledConfig(next)
  }

  async function handleRunScheduledNow() {
    if (runningScheduled) return
    setRunningScheduled(true)
    try {
      const runRes = await safeInvoke(IPC.BACKUP_SCHEDULED_RUN_NOW)
      if (runRes.ok && runRes.data.ran) {
        toast.success(`Backup saved to ${runRes.data.destPath ?? 'your backup folder'}.`)
        setScheduledConfig(prev => ({ ...prev, lastRunISO: runRes.data.lastRunISO ?? new Date().toISOString(), lastError: null }))
        await refreshOffsite()
      } else {
        const reason = runRes.ok ? (runRes.data.error ?? '') : runRes.error
        toast.error(`The backup didn't run. ${reason}`.trim())
        if (runRes.ok) setScheduledConfig(prev => ({ ...prev, lastError: reason || 'The backup couldn\'t be saved.' }))
      }
    } finally {
      setRunningScheduled(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex-1">Backup</h2>
        <button type="button" className="btn-compact-soft" onClick={() => setShowMove(true)}>Move to a new computer…</button>
      </div>
      <MoveComputerWizard open={showMove} onClose={() => setShowMove(false)} onGoToSecurity={onGoToSection ? () => onGoToSection('security') : undefined} />

      {/* The one safety action everyone needs, always visible */}
      <div className="rounded-lg border-2 border-slate-200 dark:border-slate-700 p-4 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[12rem]">
            <p className="text-base text-slate-700 dark:text-slate-300">
              Save a copy of everything to a USB drive or another folder.
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="last-offsite">
              {lastOffsiteISO
                ? `Last backup saved to another place: ${parseDbTimestamp(lastOffsiteISO).toLocaleString()}`
                : 'No backup saved to another place yet.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleManualBackup()}
            disabled={runningBackup}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
            style={{ minHeight: 44 }}
          >
            {runningBackup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {runningBackup ? 'Backing up…' : 'Back up now…'}
          </button>
        </div>
      </div>

      {/* Info box: 3-layer backup explanation */}
      <div className="flex items-start gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          Pulse protects your data with three backup layers: <strong>Auto-backup</strong> saves when you close the app, <strong>Scheduled backup</strong> runs on your chosen interval, and <strong>Back up now</strong> saves a copy wherever you choose.
        </p>
      </div>

      {/* Files live inside the database, so a big one makes every backup big */}
      {(backupInfo?.dbSize ?? 0) > LARGE_BACKUP_BYTES && (
        <p className="rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 text-base text-amber-900 dark:text-amber-100">
          Your data is {formatBytes(backupInfo!.dbSize!)}, so each backup needs that much room and takes longer. Removing files you no longer need (Settings → Data) makes backups smaller.
        </p>
      )}

      {/* Scheduled backups that keep failing would otherwise only show up in a log file */}
      {scheduledConfig.enabled && scheduledConfig.lastError && (
        <div role="alert" className="rounded-lg border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-4 py-3">
          <p className="text-base font-medium text-red-800 dark:text-red-200">
            {scheduledConfig.lastRunISO
              ? `Scheduled backup hasn't worked since ${parseDbTimestamp(scheduledConfig.lastRunISO).toLocaleString()}`
              : 'Scheduled backup hasn\'t worked yet'}
          </p>
          <p className="text-base text-red-700 dark:text-red-300 mt-0.5">{scheduledConfig.lastError}</p>
        </div>
      )}

      {/* Warning: last auto-backup failed */}
      {backupInfo?.lastAutoBackupFailed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 px-4 py-3">
          <span className="text-amber-700 dark:text-amber-400 text-lg mt-0.5">&#9888;</span>
          <div className="min-w-0">
            <p className="text-base font-medium text-amber-800 dark:text-amber-200">
              Your last auto-backup didn't complete
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
              {(backupInfo.lastAutoBackupError || "We don't know why").replace(/\.$/, '')}. Use "Back up now" above to make sure your data is safe.
            </p>
          </div>
        </div>
      )}

      {/* Panel 1: Auto-Backups */}
      <div className="space-y-3">
        <div>
          <p className="text-base font-medium text-slate-700 dark:text-slate-300">Auto-backups</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Automatically saves when you close the app. Keeps the latest copies plus one from each of the last 7 days and last 4 weeks.
          </p>
        </div>
        {autoBackups.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">
            No auto-backups yet — they appear here after you close and reopen the app.
          </p>
        ) : (
          <div
            className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden"
            style={{ maxHeight: 240, overflowY: 'auto' }}
          >
            {autoBackups.map((entry, i) => (
              <div
                key={entry.path}
                className={`flex items-center justify-between px-3 py-2 gap-3 ${i > 0 ? 'border-t border-slate-200 dark:border-slate-700' : ''} bg-white dark:bg-slate-800`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {new Date(entry.timestamp).toLocaleString()}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{formatBytes(entry.sizeBytes)}</p>
                </div>
                <button
                  onClick={() => void initiateRestore(entry.path, new Date(entry.timestamp).toLocaleString())}
                  className="btn-secondary flex items-center gap-1.5 flex-shrink-0 text-base"
                  style={{ minHeight: 44 }}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => void handleLoadBackupFile()}
          className="btn-secondary flex items-center gap-1.5 text-base"
          style={{ minHeight: 44 }}
        >
          <Upload className="w-3.5 h-3.5" />
          Restore from file…
        </button>
      </div>

      {/* Panel 2: Scheduled Backups */}
      <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <div>
          <p className="text-base font-medium text-slate-700 dark:text-slate-300">Scheduled backups</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Runs automatically at your chosen interval. Copies your database to a location you choose. Last 10 copies kept.
          </p>
        </div>

        {/* Enable toggle */}
        <label
          className="flex items-center gap-3 cursor-pointer select-none rounded-lg border border-slate-200 dark:border-slate-700 px-4 bg-white dark:bg-slate-800"
          style={{ minHeight: 44 }}
        >
          <input
            type="checkbox"
            checked={scheduledConfig.enabled}
            onChange={e => toggleScheduled(e.target.checked)}
            className="w-5 h-5 accent-blue-600 flex-shrink-0"
          />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Enable scheduled backups
          </span>
        </label>

        {scheduledConfig.enabled && (
          <div className="space-y-3 pl-1">
            {/* Interval */}
            <div className="space-y-1">
              <label htmlFor="settings-backup-freq" className="block text-base font-medium text-slate-600 dark:text-slate-400">Frequency</label>
              <select
                id="settings-backup-freq"
                className="input"
                style={{ minHeight: 44, fontSize: 15 }}
                value={scheduledConfig.intervalHours}
                onChange={e => updateScheduledConfig({ intervalHours: Number(e.target.value) })}
              >
                <option value={24}>Daily (every 24 hours)</option>
                <option value={72}>Every 3 days</option>
                <option value={168}>Weekly</option>
                <option value={12}>Every 12 hours</option>
              </select>
            </div>

            {/* Destination */}
            <div className="space-y-1">
              <label className="block text-base font-medium text-slate-600 dark:text-slate-400">Destination folder</label>
              <div className="flex items-center gap-2">
                <span
                  className="flex-1 text-sm font-mono text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-sm px-3 py-2 truncate"
                  title={scheduledConfig.destinationDir}
                >
                  {scheduledConfig.destinationDir || 'Default backup folder'}
                </span>
                <button
                  onClick={() => void handleScheduledDestinationChange()}
                  disabled={validatingDestination}
                  className="btn-secondary flex items-center gap-1.5 flex-shrink-0"
                  style={{ minHeight: 44 }}
                >
                  {validatingDestination ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FolderOpen className="w-4 h-4" />
                  )}
                  {validatingDestination ? 'Checking…' : 'Change…'}
                </button>
              </div>
              {validationError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-1">
                  {validationError}
                </p>
              )}
              {destinationBesideData && (
                <p role="status" className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-md px-3 py-2 mt-1">
                  These copies would go to the same folder as your data, so one failure takes both. Click "Change…" and pick a different drive or a network folder.
                </p>
              )}
            </div>

            {/* Last run + Run now */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {scheduledConfig.lastRunISO
                  ? `Last run: ${new Date(scheduledConfig.lastRunISO).toLocaleString()}`
                  : 'Never run'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleRunScheduledNow()}
                  disabled={runningScheduled}
                  className="btn-secondary flex items-center gap-1.5 disabled:opacity-50"
                  style={{ minHeight: 44 }}
                >
                  {runningScheduled ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {runningScheduled ? 'Running…' : 'Run now'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Panel 3: Backup Reminders */}
      <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <div>
          <p className="text-base font-medium text-slate-700 dark:text-slate-300">Backup reminders</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            After you unlock Pulse, get a reminder if you haven't saved a backup to a USB drive or another folder in a while.
          </p>
        </div>
        <label
          className="flex items-center gap-3 cursor-pointer select-none rounded-lg border border-slate-200 dark:border-slate-700 px-4 bg-white dark:bg-slate-800"
          style={{ minHeight: 44 }}
        >
          <input
            type="checkbox"
            checked={backupReminderEnabled}
            onChange={e => {
              setBackupReminderEnabled(e.target.checked)
              void saveSetting('backup_reminder_enabled', e.target.checked ? 'true' : 'false')
            }}
            className="w-5 h-5 accent-blue-600 flex-shrink-0"
          />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Enable backup reminders
          </span>
        </label>
        {backupReminderEnabled && (
          <div className="space-y-1 pl-1">
            <label htmlFor="settings-backup-reminder-days" className="block text-base font-medium text-slate-600 dark:text-slate-400">
              Remind after how many days without a backup?
            </label>
            <select
              id="settings-backup-reminder-days"
              className="input"
              style={{ minHeight: 44, fontSize: 15 }}
              value={backupReminderDays}
              onChange={e => {
                const d = Number(e.target.value)
                setBackupReminderDays(d)
                void saveSetting('backup_reminder_days', String(d))
              }}
            >
              <option value={3}>3 days</option>
              <option value={7}>7 days (default)</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
        )}
      </div>

      {/* Restore confirm dialog */}
      {restoreTarget && (
        <ConfirmDialog
          open
          variant="typed"
          title="Restore from backup?"
          message={`This will replace all your current data with the backup from "${restoreTarget.label}". Your current data will be saved as a safety backup first. This cannot be undone without the safety backup.\n\nType RESTORE to confirm.`}
          requiredPhrase="RESTORE"
          confirmLabel="Replace my data with this backup"
          destructive
          onConfirm={() => { setBackupPreview(null); void executeRestore() }}
          onCancel={() => { setBackupPreview(null); setRestoreTarget(null) }}
        >
          {backupPreview && (
            <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600 text-sm space-y-1">
              <p className="font-medium text-slate-700 dark:text-slate-300">Backup contents</p>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>{t('list', { many: true, cap: true })}</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{backupPreview.gridCount}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>{t('record', { many: true, cap: true })}</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{backupPreview.rowCount}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Backup made</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{backupPreview.madeAt ? parseDbTimestamp(backupPreview.madeAt).toLocaleString() : 'Unknown'}</span>
              </div>
              {backupPreview.appVersion && (
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Made by</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">Pulse {backupPreview.appVersion}</span>
                </div>
              )}
            </div>
          )}
          {previewLoading && (
            <div className="mb-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading backup details…
            </div>
          )}
        </ConfirmDialog>
      )}

      {/* Backup from another Pulse: unlock it with that Pulse's password or recovery key */}
      {otherPulsePath && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onKeyDown={e => { if (e.key === 'Escape') setOtherPulsePath(null) }}>
          <div ref={otherPulseTrapRef} role="dialog" aria-modal="true" aria-labelledby="other-pulse-title"
            className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-2xl max-w-lg w-full mx-4 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 id="other-pulse-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">This backup is from another Pulse</h3>
            <p className="text-base text-slate-600 dark:text-slate-300">
              It was made on another computer, or before Pulse was set up again here. Enter the password or recovery key it was made with to restore it.
              Your current data is saved as a safety copy first.
            </p>
            <RestoreFromBackupForm
              mode="replace"
              initialBackupPath={otherPulsePath}
              onCancel={() => setOtherPulsePath(null)}
              onRestored={info => {
                setOtherPulsePath(null)
                useUndoStore.getState().clear()
                setRestoreResult({ safetyPath: info.safetyPath ?? '', otherPulse: true })
              }}
            />
          </div>
        </div>
      )}

      {/* Restoring overlay */}
      {restoring && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-8 shadow-2xl">
            <LoadingOverlay label="Restoring backup…" />
          </div>
        </div>
      )}

      {/* Restore success dialog */}
      {restoreResult && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div ref={restoreResultTrapRef} className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-2xl max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Restore complete</h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Your data has been restored. A safety backup of your previous data was saved to:
            </p>
            <p className="text-sm font-mono bg-slate-100 dark:bg-slate-700 rounded-sm px-3 py-2 break-all text-slate-700 dark:text-slate-300">
              {restoreResult.safetyPath}
            </p>
            {restoreResult.otherPulse && (
              <p className="text-base text-slate-600 dark:text-slate-300">
                That safety copy opens with your old password. From now on, unlock Pulse with the new password you just chose.
              </p>
            )}
            <p className="text-base text-slate-600 dark:text-slate-300">
              Pulse needs to restart to show the restored data.
            </p>
            <div className="flex gap-2 pt-1">
              {/* The only choice: until a restart, the window still shows the old words, features and settings */}
              <button
                type="button"
                onClick={() => void safeInvoke(IPC.APP_RELAUNCH)}
                className="btn-primary flex-1"
                style={{ minHeight: 44 }}
                autoFocus
              >
                Restart now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
