import React, { useEffect, useState } from 'react'
import { AlertTriangle, Download, RefreshCw } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { OpenDialogResult } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import toast from 'react-hot-toast'
import { noteUnencryptedExport } from '../../utils/exportNotice'
import { pulseEvents } from '../../events'
import { useGridStore } from '../../stores/gridStore'
import { RemoveSampleDataDialog } from '../shared/SampleDataBanner'
import { useVocab } from '../../hooks/useVocab'
import { FilesStorageSection } from './FilesStorageSection'
import { ImportWizard } from '../grid/ImportWizard'
import { useFeature } from '../../hooks/useFeature'
import { localDateString } from '../../../shared/dates'
import { HUMAN_SERVICES_VOCAB } from '../../../shared/vocab'

/** Add or remove the sample caseload (made-up clients for trying things out). */
function SampleDataControls(): React.ReactElement {
  const { t } = useVocab(null)
  // The sample list is written for social work; other workspaces try an example of their own kind instead
  const humanServices = t('record') === HUMAN_SERVICES_VOCAB.record.one
  const [hasSample, setHasSample] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    const refresh = () => void safeInvoke(IPC.SAMPLE_DATA_STATUS).then(r => setHasSample(r.ok && (r.data.gridId !== null || r.data.sampleRows > 0)))
    refresh()
    return pulseEvents.on('sample-data:changed', refresh)
  }, [])
  async function add() {
    setBusy(true)
    try {
      const res = await safeInvoke(IPC.SAMPLE_DATA_CREATE)
      if (!res.ok) { toast.error(res.error === 'READ_ONLY' ? 'Sample data is not available right now.' : `We couldn't add the sample ${t('list')}.`); return }
      await useGridStore.getState().loadGridList()
      pulseEvents.emit('sample-data:changed')
      toast.success(`Sample ${t('list')} added — find it in the sidebar.`)
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-700">
      <p className="text-base font-medium text-slate-700 dark:text-slate-300">Sample data</p>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('list', { cap: true, article: true })} of made-up {t('record', { many: true })} for trying features or training a coworker. It never mixes with your real {t('record', { many: true })}.
      </p>
      {hasSample === null ? null : hasSample ? (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(true)}>
          Remove sample data
        </button>
      ) : humanServices ? (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void add()}>
          Add sample {t('list')}
        </button>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => pulseEvents.emit('starters:open', { sample: true })}>
          See an example with sample data
        </button>
      )}
      <RemoveSampleDataDialog open={confirming} onClose={() => setConfirming(false)} />
    </div>
  )
}

export function DataSection(): React.ReactElement {
  const { t } = useVocab(null)
  const filesOn = useFeature('attachments')
  const [dbInfo, setDbInfo] = useState<{ path: string; size: string; clientCount: number } | null>(null)
  const [resetTyped, setResetTyped] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [pulseRegistered, setPulseRegistered] = useState<boolean | null>(null)
  const [platform, setPlatform] = useState<string>('')
  const [exportingAllCsv, setExportingAllCsv] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const grids = useGridStore(s => s.grids)
  const activeGridId = useGridStore(s => s.activeGridId)
  const [importGridId, setImportGridId] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    if (importGridId == null && grids.length > 0) setImportGridId(grids.some(g => g.id === activeGridId) ? activeGridId : grids[0]!.id)
  }, [grids, activeGridId, importGridId])

  async function backUpFirst() {
    setBackingUp(true)
    try {
      const saveRes = await safeInvoke(IPC.APP_SHOW_SAVE_DIALOG, {
        title: 'Save a backup before erasing',
        defaultPath: `pulse-backup-${localDateString()}.pulse-backup`,
        filters: [{ name: 'Pulse Backup', extensions: ['pulse-backup'] }],
      })
      if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return
      const res = await safeInvoke(IPC.BACKUP_MANUAL_CREATE, saveRes.data.filePath)
      if (res.ok) toast.success('Backup saved. Keep it somewhere safe.')
      else toast.error(res.error || 'The backup couldn\'t be saved. Try again, or choose a different folder.')
    } finally {
      setBackingUp(false)
    }
  }

  useEffect(() => {
    async function load() {
      const res = await safeInvoke<{
        dbSize: number; totalClients: number; dbPath: string
        lastAutoBackup: string | null; autoBackupCount: number
      }>(IPC.BACKUP_GET_INFO)
      if (res.ok) {
        const mb = (res.data.dbSize / (1024 * 1024)).toFixed(2)
        setDbInfo({ path: res.data.dbPath, size: `${mb} MB`, clientCount: res.data.totalClients })
      }

      const infoRes = await safeInvoke(IPC.APP_GET_INFO)
      if (infoRes.ok && infoRes.data.platform) setPlatform(infoRes.data.platform)
      const regRes = await safeInvoke(IPC.FILE_ASSOC_IS_REGISTERED)
      if (regRes.ok) setPulseRegistered(regRes.data)
    }
    load()
  }, [])

  // Clear sensitive data on unmount
  useEffect(() => {
    return () => {
      setResetPassword('')
    }
  }, [])

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Data</h2>

      {dbInfo && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400 flex-shrink-0">Database location</span>
            <span className="font-mono text-slate-700 dark:text-slate-300 text-sm text-right break-all"
              title={dbInfo.path}>{dbInfo.path}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Database size</span>
            <span className="text-slate-700 dark:text-slate-300">{dbInfo.size}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Total active {t('record', { many: true })}</span>
            <span className="text-slate-700 dark:text-slate-300">{dbInfo.clientCount}</span>
          </div>
        </div>
      )}

      {filesOn && <FilesStorageSection />}

      <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <div>
          <p className="text-base font-medium text-slate-700 dark:text-slate-300">Import &amp; export data</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Bring a spreadsheet into a {t('list')} here, or with <strong>Import</strong> above the {t('list')}. To save one {t('list')} as CSV or PDF, use <strong>Export</strong> there; to save every {t('list')} at once, use the button below.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Export All saves one file per {t('list')} (hidden columns too) and one with every {t('activity')}. Tasks, contacts and appointments aren't included.</p>
          {filesOn && <p className="text-sm text-slate-500 dark:text-slate-400">Files attached to {t('record', { many: true })} aren't included in CSV exports; open or save them from each profile.</p>}
        </div>
        {grids.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="settings-import-list" className="block text-base text-slate-700 dark:text-slate-300 mb-1">Import into</label>
              <select id="settings-import-list" className="input" style={{ minHeight: 44, fontSize: 15 }}
                value={importGridId ?? ''} onChange={e => setImportGridId(Number(e.target.value))}>
                {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <button type="button" className="btn-secondary" style={{ minHeight: 44 }} disabled={importGridId == null} onClick={() => setImporting(true)}>
              Import a spreadsheet…
            </button>
          </div>
        )}
        {importing && importGridId != null && (
          <ImportWizard open gridId={importGridId} onClose={() => setImporting(false)}
            onImported={() => {
              void useGridStore.getState().loadGridList()
              if (useGridStore.getState().activeGridId === importGridId) void useGridStore.getState().loadGrid(importGridId)
            }} />
        )}
        <button
          onClick={async () => {
            const dialogRes = await safeInvoke<OpenDialogResult>(IPC.APP_SHOW_FILE_DIALOG, {
              title: 'Choose Export Destination Folder',
              properties: ['openDirectory']
            })
            if (!dialogRes.ok || dialogRes.data.canceled || !dialogRes.data.filePaths?.length) return
            const dir = dialogRes.data.filePaths[0]!
            setExportingAllCsv(true)
            try {
              const res = await safeInvoke<{ exported: number; errors: string[]; notes?: number }>(IPC.EXPORT_ALL_CSV, dir)
              if (res.ok) {
                // errors is the list of failed grids (it used to be compared to 0 as if it
                // were a count, so failures were reported as success)
                const failed = res.data.errors.length
                if (failed > 0) {
                  toast.error(`Exported ${res.data.exported} ${t('list', { count: res.data.exported })}, but ${failed} failed: ${res.data.errors.join('; ')}`, { duration: 10000 })
                } else {
                  toast.success(`Exported ${res.data.exported} ${t('list', { count: res.data.exported })} and ${res.data.notes ?? 0} ${t('activity', { count: res.data.notes ?? 0 })} as CSV.`)
                  noteUnencryptedExport()
                }
              } else {
                toast.error('Export failed. Please try again.')
              }
            } catch {
              toast.error('Export failed. Please try again.')
            } finally {
              setExportingAllCsv(false)
            }
          }}
          disabled={exportingAllCsv}
          className="btn-secondary flex items-center gap-1.5 disabled:opacity-50"
          style={{ minHeight: 44 }}
        >
          <Download className="w-4 h-4" />
          {exportingAllCsv ? 'Exporting…' : 'Export everything as CSV…'}
        </button>
      </div>

      <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <p className="text-base font-medium text-slate-700 dark:text-slate-300">Cell history</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">Clean up old cell edit history to save space</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every cell edit is stored to allow future audit and undo capabilities. You can compact the history to free space.
        </p>
        <div className="flex items-center gap-3">
          <select
            id="history-retention"
            className="input"
            style={{ minHeight: 44, width: 'auto' }}
            defaultValue="12"
            onChange={e => {
              const el = e.target
              el.dataset.months = el.value
            }}
            data-months="12"
          >
            <option value="6">Keep 6 months</option>
            <option value="12">Keep 12 months</option>
            <option value="24">Keep 24 months</option>
            <option value="0">Delete all history</option>
          </select>
          <button
            className="btn-secondary"
            style={{ minHeight: 44, padding: '0 16px', fontSize: 15 }}
            onClick={async () => {
              const sel = document.getElementById('history-retention') as HTMLSelectElement | null
              const months = parseInt(sel?.value ?? '12', 10)
              const res = await safeInvoke<number>(IPC.CELL_HISTORY_COMPACT, months)
              if (res.ok) toast.success(`Compacted: ${res.data} records removed.`)
              else toast.error('History compaction failed. Please try again.')
            }}
          >
            Compact Now
          </button>
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <p className="text-base font-medium text-slate-700 dark:text-slate-300">Database integrity</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">Verify your database isn't corrupted</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Run a quick check to verify the database file is not corrupted.
        </p>
        <button
          className="btn-secondary"
          style={{ minHeight: 44, padding: '0 16px', fontSize: 15 }}
          onClick={async () => {
            const res = await safeInvoke<boolean>(IPC.APP_INTEGRITY_CHECK)
            if (res.ok && res.data) toast.success('Database integrity check passed.')
            else if (res.ok && !res.data) toast.error('Database integrity check FAILED. Consider restoring from backup.')
            else toast.error('Integrity check failed. Please try again.')
          }}
        >
          <RefreshCw className="w-4 h-4 inline mr-2" />
          Run Integrity Check
        </button>
      </div>

      {/* File association */}
      <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-700">
        <p className="text-base font-medium text-slate-700 dark:text-slate-300">
          File association
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Register .pulse files so you can double-click them to open in Pulse.
        </p>
        {platform === 'win32' && pulseRegistered !== null && (
          <button
            onClick={async () => {
              const shouldRegister = !pulseRegistered
              const res = await safeInvoke(IPC.FILE_ASSOC_REGISTER, shouldRegister)
              if (res.ok) {
                setPulseRegistered(shouldRegister)
                toast.success(shouldRegister ? '.pulse files registered.' : '.pulse files unregistered.')
              } else {
                toast.error('Could not update file association.')
              }
            }}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                       text-base text-slate-700 dark:text-slate-300
                       hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[44px]
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 transition-colors"
          >
            {pulseRegistered ? 'Unregister .pulse files' : 'Register .pulse files'}
          </button>
        )}
        {platform === 'linux' && (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">
            On Linux, .pulse file association is handled automatically for .deb installs.
            For AppImage, use AppImageLauncher for desktop integration.
          </p>
        )}
      </div>

      <SampleDataControls />

      <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-3 flex-1 min-w-0">
            <div>
              <p className="text-base font-medium text-red-700 dark:text-red-400">Danger zone</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Erase all data and start fresh — this cannot be undone</p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                Permanently deletes all data on this computer, including every {t('record')}, column, setting, and the automatic backups. Backups you saved somewhere else (a USB drive or another folder) are not deleted.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-base text-slate-700 dark:text-slate-300 flex-1 min-w-[12rem]">Not sure? Save a backup first, so you can get everything back.</p>
              <button type="button" className="btn-secondary" style={{ minHeight: 44 }} disabled={backingUp} onClick={() => void backUpFirst()}>
                {backingUp ? 'Backing up…' : 'Back up first…'}
              </button>
            </div>
            <div>
              <label htmlFor="settings-reset-confirm" className="block text-base font-medium text-red-700 dark:text-red-400 mb-1">
                Type <strong>RESET EVERYTHING</strong> to enable:
              </label>
              <input
                id="settings-reset-confirm"
                className="input w-full border-red-300 dark:border-red-700"
                style={{ minHeight: 44 }}
                value={resetTyped}
                onChange={e => setResetTyped(e.target.value)}
                placeholder="RESET EVERYTHING"
              />
            </div>
            <div>
              <label htmlFor="settings-reset-password" className="block text-base font-medium text-red-700 dark:text-red-400 mb-1">
                Enter your password to confirm:
              </label>
              <input
                id="settings-reset-password"
                type="password"
                className="input w-full border-red-300 dark:border-red-700"
                style={{ minHeight: 44 }}
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder="Password"
              />
            </div>
            <button
              disabled={resetTyped !== 'RESET EVERYTHING' || !resetPassword}
              onClick={async () => {
                const res = await safeInvoke<boolean>(IPC.APP_FACTORY_RESET, resetPassword)
                setResetPassword('')
                if (res.ok) {
                  // Nothing is left to show; start again at setup instead of leaving a broken window
                  toast.success('Everything was erased. Pulse is restarting.')
                  void safeInvoke(IPC.APP_RELAUNCH)
                } else {
                  toast.error(res.error || 'Reset failed. Please try again.')
                }
              }}
              className="btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed w-full"
              style={{ minHeight: 44 }}
            >
              Reset everything
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
